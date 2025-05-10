import { ethers } from 'ethers';

// Define an interface for the parameters to make the function signature cleaner
interface GaslessApprovalParams {
  signer: ethers.Wallet;
  tokenContract: ethers.Contract;
  forwarder: ethers.Contract;
  relayer: ethers.Contract;
  spender: string;
  amount: ethers.BigNumberish;
  deadlineMinutes?: number;
}

export async function createGaslessApproval({
  signer,
  tokenContract,
  forwarder,
  relayer,
  spender,
  amount,
  deadlineMinutes = 5,
}: GaslessApprovalParams): Promise<{
  success: boolean;
  error: Error | null
}> {
  try {
    // 1. Get necessary domain data from token contract
    const owner = await signer.getAddress();
    const deadline = Math.floor(Date.now() / 1000) + deadlineMinutes * 60;
    const nonce = await tokenContract.nonces(owner);
    const { name, version, chainId, verifyingContract } = await tokenContract.eip712Domain();

    // 2. Create domain separator and data type
    const domain = {
      name,
      version,
      chainId,
      verifyingContract,
    };

    const types = {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    };

    // 3. Create the message to sign
    const message = {
      owner,
      spender,
      value: amount,
      nonce,
      deadline,
    };

    // 4. Sign the typed data
    const signature = await signer.signTypedData(domain, types, message);
    const { v, r, s } = ethers.Signature.from(signature);

    // 5. Create meta transaction request
    const metaTx = await createMetaTxRequest(
      signer,
      await forwarder.getAddress(),
      forwarder.interface,
      await tokenContract.getAddress(),
      tokenContract.interface,
      'permit',
      [owner, spender, amount, deadline, v, r, s]
    );

    // 6. Submit the request through the relayer
    const tx = await relayer.relayApprove(metaTx);
    const receipt = await tx.wait();

    // 7. Return the transaction receipt
    return {
      success: true,
      error: null
    };
  } catch (error) {
    console.error('Gasless approval failed:', error);
    return {
      success: false,
      error: new Error((error as Error).message || 'Unknown error during gasless approval'),
    };
  }
}

/**
 * creates a meta-transaction request that can be sent to the relayer
 * @param signer - 
 * @param forwarderAddress - address of the ERC2771Forwarder contract
 * @param forwarderAbi - ABI of the forwarder contract
 * @param targetAddress - address of the contract to call (e.g., token contract)
 * @param targetAbi - ABI of the target contract
 * @param functionName - name of the function to call
 * @param args - arguments for the function
 * @returns the request object ready to send to the relayer
 */
export async function createMetaTxRequest(
    signer: ethers.Signer,
    forwarderAddress: string,
    forwarderAbi: any,
    targetAddress: string,
    targetAbi: any,
    functionName: string,
    args: any[]
) {
    // Create contract instances
    const provider = signer.provider;
    const forwarder = new ethers.Contract(forwarderAddress, forwarderAbi, provider);
    const target = new ethers.Contract(targetAddress, targetAbi, provider);
    
    
    // Encode function data
    const data = target.interface.encodeFunctionData(functionName, args);
    const userAddress = await signer.getAddress();
    
    
    // Get domain data for EIP-712 signing
    const { name, version, chainId, verifyingContract } = await forwarder.eip712Domain();
    
    const domain = { 
        name, 
        version, 
        chainId: BigInt(chainId), 
        verifyingContract 
    };
    
    const types = {
        ForwardRequest: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "gas", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint48" },
            { name: "data", type: "bytes" },
        ],
    };
    
    // Create request object
    const currentTime = Math.floor(Date.now() / 1000);
    const oneHourInSeconds = 60 * 60;
    const nonce = await forwarder.nonces(userAddress);
    
    const request = {
        from: userAddress,
        to: targetAddress,
        value: 0n,
        gas: 1000000n,
        nonce: nonce,
        deadline: currentTime + oneHourInSeconds,
        data,
    };
    
    // Sign the request using EIP-712
    const signature = await signer.signTypedData(domain, types, request);
    
    return {
        from: request.from,
        to: request.to,
        value: request.value,
        gas: request.gas,
        nonce: request.nonce,
        deadline: request.deadline,
        data: request.data,
        signature
    };
}

/**
 * Sends a meta-transaction request to the relayer API
 * @param request The signed meta-transaction request
 * @returns The response from the relayer
 */
export async function sendMetaTxToRelayer(request: any) {
    const response = await fetch('/api/wallet/relay', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ request }),
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to send transaction');
    }

    return await response.json();
}


export async function buildGaslessApprovalMessage({
  userAddress,
  spender,
  amount,
  tokenContract,
  forwarderContract,
  deadlineMinutes = 5,
}: {
  userAddress: string;
  spender: string;
  amount: ethers.BigNumberish;
  tokenContract: ethers.Contract;
  forwarderContract: ethers.Contract;
  deadlineMinutes?: number;
}) {
  // 1. Get nonce and deadline
  const nonce = await tokenContract.nonces(userAddress);
  const deadline = Math.floor(Date.now() / 1000) + deadlineMinutes * 60;

  // 2. Get EIP-712 domain from forwarder
  const { name, version, chainId, verifyingContract } = await forwarderContract.eip712Domain();
  const domain = {
    name,
    version,
    chainId: Number(chainId),
    verifyingContract,
  };

  // 3. Types for EIP-712
  const types = {
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  // 4. Message to sign
  const message = {
    owner: userAddress,
    spender,
    value: amount.toString(),
    nonce: nonce.toString(),
    deadline: deadline.toString(),
  };

  return { domain, types, message };
}

export async function buildPermitMessage({
  userAddress,
  spender,
  amount,
  tokenContract,
  deadlineMinutes = 5,
}: {
  userAddress: string;
  spender: string;
  amount: ethers.BigNumberish;
  tokenContract: ethers.Contract;
  deadlineMinutes?: number;
}) {
  const nonce = await tokenContract.nonces(userAddress);
  const deadline = Math.floor(Date.now() / 1000) + deadlineMinutes * 60;
  const { name, version, chainId, verifyingContract } = await tokenContract.eip712Domain();
  
  const domain = {
    name,
    version,
    chainId: Number(chainId),
    verifyingContract 
  };

  const types = {
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  const message = {
    owner: userAddress,
    spender,
    value: amount.toString(),
    nonce: nonce.toString(),
    deadline: deadline.toString(),
  };

  return { domain, types, message };
}