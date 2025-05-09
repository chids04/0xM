import { ethers } from "ethers";

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