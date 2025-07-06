# 0xM - Blockchain-Powered Milestone Tracking Application

0xM is a full-stack web3 application that combines blockchain technology with a modern web interface to create, track, verify, and share personal and professional milestones. The platform allows users to create verifiable milestones that are stored on the blockchain, mint them as NFTs, and share them with friends or collaborators.

## 🚀 Project Overview

0xM leverages blockchain technology to provide immutable proof of milestone achievement. Key features include:

- **Blockchain-Verified Milestones**: Create personal or group milestones that are stored on the blockchain
- **NFT Minting**: Turn verified milestones into NFTs that can be displayed or transferred
- **Cryptographic Verification**: Ensure the integrity of milestones through cryptographic verification
- **Decentralized Storage**: Store milestone data and images on IPFS for decentralization
- **Social Features**: Tag friends, collaborate on milestones, and build your achievement network
- **Custom Wallet Integration**: Seamlessly interact with Ethereum-compatible blockchains
- **Token Economy**: Use MST tokens to interact with the platform's features


## 📁 Project Structure

```text
/
├── blockchain/contracts        # Smart contract code 
│
├── src/                        # Application source code
│   ├── assets/                 # Images and static files
│   ├── pages/                  # Astro pages
│   │   ├── api/                # API endpoints
│   │   └── *.astro             # Page components
│
```

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `node scripts/start-ipfs.js` | Start local IPFS node for development         |

## 🌐 Implementation Details

### Smart Contracts
The blockchain folder contains Solidity smart contracts that handle:
- Milestone creation and verification
- NFT minting of verified milestones
- Token operations for platform economy
- Gas abstraction for better UX

### Frontend Application
The src folder contains the web application built with Astro and React that provides:
- User authentication and profile management
- Milestone creation with IPFS image storage
- Social features for collaborative milestones
- NFT gallery and transfer capabilities
- Wallet integration for blockchain interactions

### API and Backend
The application uses Firebase and custom API endpoints to:
- Store user data securely
- Handle blockchain transaction creation
- Manage IPFS interactions
- Process payments in MST tokens

## 📊 Dependencies
- IPFS https://github.com/ipfs/kubo



