import type { APIRoute } from "astro";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

// Helper to load ABI from env path
function loadABI(abiEnvVar: string) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const projectRoot = join(__dirname, "../../../blockchain");
  const abiPath = process.env[abiEnvVar] || import.meta.env[abiEnvVar];
  if (!abiPath) throw new Error(`Missing ABI env var: ${abiEnvVar}`);
  return JSON.parse(readFileSync(join(projectRoot, abiPath), "utf8")).abi;
}

// Map contract keys to their env variable names
const CONTRACTS = {
  tracker: {
    address: process.env.MILESTONE_TRACKER_ADDRESS || import.meta.env.MILESTONE_TRACKER_ADDRESS,
    abiEnv: "MILESTONE_TRACKER_ABI",
  },
  token: {
    address: process.env.MST_TOKEN_ADDRESS || import.meta.env.MST_TOKEN_ADDRESS,
    abiEnv: "MST_TOKEN_ABI",
  },
  relayer: {
    address: process.env.MILESTONE_RELAYER_ADDRESS || import.meta.env.MILESTONE_RELAYER_ADDRESS,
    abiEnv: "MILESTONE_RELAYER_ABI",
  },
  forwarder: {
    address: process.env.FORWARDER_ADDRESS || import.meta.env.FORWARDER_ADDRESS,
    abiEnv: "FORWARDER_ABI",
  },
  // Add more contracts as needed
};

export const GET: APIRoute = async ({ url }) => {
  const contractKey = url.searchParams.get("contract");
  if (!contractKey || !CONTRACTS[contractKey]) {
    return new Response(
      JSON.stringify({ error: "Invalid or missing contract parameter" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { address, abiEnv } = CONTRACTS[contractKey];
  if (!address) {
    return new Response(
      JSON.stringify({ error: "Contract address not set" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let abi;
  try {
    abi = loadABI(abiEnv);
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: "ABI file not found", details: e.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ address, abi }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};