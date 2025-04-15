import { ethers } from 'ethers';
import { createMetaTxRequest } from './CreateMetaTx';

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