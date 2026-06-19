/* eslint-disable @typescript-eslint/no-explicit-any */
import * as fs from 'fs';
import * as path from 'path';
import { ethers } from 'ethers';

const RPC_URL = 'http://127.0.0.1:8545';
const SIGNER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ENV_PATH = path.resolve(__dirname, '..', '.env');

function loadBytecode(): string {
  const binPath = path.resolve(__dirname, '..', 'contracts', 'build', 'IdentityRegistry.bin');
  return fs.readFileSync(binPath, 'utf8').trim();
}

function loadAbi(): string {
  const abiPath = path.resolve(__dirname, '..', 'contracts', 'build', 'IdentityRegistry.abi');
  return fs.readFileSync(abiPath, 'utf8');
}

function updateEnv(contractAddress: string, deployedBlock: number): void {
  let env = fs.readFileSync(ENV_PATH, 'utf8');

  const addrLine = `IDENTITY_REGISTRY_ADDRESS=${contractAddress}`;
  const blockLine = `IDENTITY_REGISTRY_DEPLOYED_BLOCK=${deployedBlock}`;

  if (env.includes('IDENTITY_REGISTRY_ADDRESS=')) {
    env = env.replace(/IDENTITY_REGISTRY_ADDRESS=.*/, addrLine);
  } else {
    env += `\n${addrLine}`;
  }

  if (env.includes('IDENTITY_REGISTRY_DEPLOYED_BLOCK=')) {
    env = env.replace(/IDENTITY_REGISTRY_DEPLOYED_BLOCK=.*/, blockLine);
  } else {
    env += `\n${blockLine}`;
  }

  fs.writeFileSync(ENV_PATH, env);
  console.log(`  Updated .env → IDENTITY_REGISTRY_ADDRESS=${contractAddress}`);
  console.log(`  Updated .env → IDENTITY_REGISTRY_DEPLOYED_BLOCK=${deployedBlock}`);
}

async function main() {
  console.log('══════════════════════════════════════════════════');
  console.log('  IdentityRegistry Deployment');
  console.log('══════════════════════════════════════════════════');
  console.log();

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(SIGNER_KEY, provider);
  const deployerAddr = wallet.address;

  const network = await provider.getNetwork();
  console.log(`  Network:       ${network.name} (chainId: ${network.chainId})`);
  console.log(`  Deployer:      ${deployerAddr}`);

  const deployerBal = await provider.getBalance(deployerAddr);
  console.log(`  Deployer bal:  ${ethers.formatEther(deployerBal)} ETH`);
  console.log();

  const bytecode = loadBytecode();
  const abi = JSON.parse(loadAbi());
  console.log(`  Bytecode       ${bytecode.length} hex chars (${Math.round(bytecode.length / 2)} bytes)`);

  const factory = new ethers.ContractFactory(abi, bytecode, wallet);

  console.log('  Deploying...');
  const contract: any = await factory.deploy();
  const receipt = await contract.deploymentTransaction().wait();

  const contractAddress = await contract.getAddress();
  const deployBlock = receipt.blockNumber;

  console.log(`  Contract:      ${contractAddress}`);
  console.log(`  Block:         ${deployBlock}`);
  console.log(`  Gas used:      ${receipt.gasUsed.toString()}`);
  console.log();

  const owner: string = await contract.contractOwner();
  const registrar: string = await contract.registrar();
  const minLen: bigint = await contract.MIN_NAME_LENGTH();
  const maxLen: bigint = await contract.MAX_NAME_LENGTH();
  const fee: bigint = await contract.REGISTRATION_FEE();

  console.log(`  Owner:         ${owner}`);
  console.log(`  Registrar:     ${registrar}`);
  console.log(`  Min name len:  ${minLen.toString()}`);
  console.log(`  Max name len:  ${maxLen.toString()}`);
  console.log(`  Fee:           ${ethers.formatEther(fee)} ETH`);
  console.log();

  updateEnv(contractAddress, deployBlock);

  const testHash = ethers.keccak256(ethers.toUtf8Bytes('test'));
  const zeroAddr: string = await contract['resolve(bytes32)'](testHash);
  console.log(`  Resolve(bytes32) check: ${zeroAddr}  (expect 0x0000...)`);

  const zeroAddr2: string = await contract['resolve(string)']('nobody');
  console.log(`  Resolve(string) check: ${zeroAddr2}  (expect 0x0000...)`);

  console.log();
  console.log('══════════════════════════════════════════════════');
  console.log('  Deployment complete');
  console.log('══════════════════════════════════════════════════');
}

main().catch((err) => {
  console.error('Deployment failed:', err);
  process.exit(1);
});
