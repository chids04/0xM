const { exec, spawn } = require('child_process');
const os = require('os');

function isIpfsRunning() {
  return new Promise((resolve, reject) => {
    // Try `ipfs id` — if it succeeds, IPFS is running
    exec('ipfs id', (error, stdout, stderr) => {
      if (error) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

async function startIpfs() {
  const running = await isIpfsRunning();

  if (running) {
    console.log('IPFS daemon is already running.');
    return;
  }

  console.log('Starting IPFS daemon...');

  const ipfsProcess = spawn('ipfs', ['daemon'], {
    detached: true, 
    stdio: 'ignore' 
  });

  ipfsProcess.unref(); 

  console.log('IPFS daemon started.');
}

startIpfs().catch((error) => {
  console.error('Error starting IPFS:', error);
  process.exit(1);
});
