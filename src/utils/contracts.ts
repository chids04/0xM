import { ethers } from "ethers";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";


// Helper to load ABI from env path
function loadABI(abiEnvVar: string) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const projectRoot = join(__dirname, "../../blockchain");
  const abiPath = process.env[abiEnvVar] || import.meta.env[abiEnvVar];
  if (!abiPath) throw new Error(`Missing ABI env var: ${abiEnvVar}`);
  return JSON.parse(readFileSync(join(projectRoot, abiPath), "utf8")).abi;
}

// Load addresses from env
const trackerAddress = process.env.MILESTONE_TRACKER_ADDRESS || import.meta.env.MILESTONE_TRACKER_ADDRESS;
const tokenAddress = process.env.MST_TOKEN_ADDRESS || import.meta.env.MST_TOKEN_ADDRESS;
const relayerAddress = process.env.MILESTONE_RELAYER_ADDRESS || import.meta.env.MILESTONE_RELAYER_ADDRESS;
const forwarderAddress = process.env.FORWARDER_ADDRESS || import.meta.env.FORWARDER_ADDRESS;
const nftContractAddress = process.env.MILESTONE_NFT_ADDRESS || import.meta.env.MILESTONE_NFT_ADDRESS;

// Load ABIs
const trackerABI = loadABI("MILESTONE_TRACKER_ABI");
const tokenABI = loadABI("MST_TOKEN_ABI");
const relayerABI = loadABI("MILESTONE_RELAYER_ABI");
const forwarderABI = loadABI("FORWARDER_ABI");
const nftABI = loadABI("MILESTONE_NFT_ABI");

// Provider and admin wallet
export const provider = new ethers.JsonRpcProvider(
  process.env.ETHEREUM_RPC_URL || import.meta.env.ETHEREUM_RPC_URL || "http://localhost:8545"
);

const adminPriv = process.env.ADMIN_PRIV_KEY || import.meta.env.ADMIN_PRIV_KEY;
if (!adminPriv) throw new Error("Missing admin private key");
export const adminWallet = new ethers.Wallet(adminPriv, provider);

// Contract instances
export const trackerContract = new ethers.Contract(trackerAddress, trackerABI, provider);
export const tokenContract = new ethers.Contract(tokenAddress, tokenABI, provider);
export const relayerContract = new ethers.Contract(relayerAddress, relayerABI, adminWallet);
export const forwarderContract = new ethers.Contract(forwarderAddress, forwarderABI, provider);
export const nftContract = new ethers.Contract(nftContractAddress, nftABI, provider);