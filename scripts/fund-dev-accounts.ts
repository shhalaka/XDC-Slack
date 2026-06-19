/**
 * Funds dev wallet addresses from the known dev private key.
 *
 * This script connects to the local Geth dev node and sends ETH
 * to the wallet addresses listed in the arguments (or reads from
 * the database if no arguments are given).
 *
 * Usage:
 *   npx ts-node scripts/fund-dev-accounts.ts <address1> [address2 ...]
 *   npx ts-node scripts/fund-dev-accounts.ts --all
 *
 * The --all flag reads all wallet addresses from the database.
 */

import { ethers } from 'ethers';
import { DataSource } from 'typeorm';
import { User } from '../src/database/entities/user.entity';

const RPC_URL = process.env.RPC_URL || 'http://localhost:8545';
const DEV_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const FUND_AMOUNT_ETH = '1000';

async function fundAddresses(addresses: string[]) {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(DEV_PRIVATE_KEY, provider);

  const devBalance = await provider.getBalance(signer.address);
  console.log(`Dev account: ${signer.address}`);
  console.log(`Balance: ${ethers.formatEther(devBalance)} ETH\n`);

  for (const addr of addresses) {
    if (!ethers.isAddress(addr)) {
      console.warn(`  ✗ Invalid address: ${addr}`);
      continue;
    }

    const bal = await provider.getBalance(addr);
    const balEth = parseFloat(ethers.formatEther(bal));
    console.log(`  ${addr}  balance: ${balEth.toFixed(4)} ETH`);

    if (balEth > 1) {
      console.log(`    → already funded, skipping`);
      continue;
    }

    const tx = await signer.sendTransaction({
      to: addr,
      value: ethers.parseEther(FUND_AMOUNT_ETH),
    });
    await tx.wait();
    console.log(`    → funded with ${FUND_AMOUNT_ETH} ETH (tx: ${tx.hash})`);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage:');
    console.log('  npx ts-node scripts/fund-dev-accounts.ts <addr1> [addr2 ...]');
    console.log('  npx ts-node scripts/fund-dev-accounts.ts --all');
    return;
  }

  let addresses: string[];

  if (args.includes('--all')) {
    // Read all wallet addresses from the database
    const ds = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USERNAME || 'txdc',
      password: process.env.DB_PASSWORD || 'txdc_secret',
      database: process.env.DB_DATABASE || 'txdc_assistant',
      entities: [User],
      synchronize: false,
    });

    await ds.initialize();
    const users = await ds.getRepository(User).find({ select: ['walletAddress'] });
    await ds.destroy();

    addresses = users.map((u) => u.walletAddress).filter(Boolean);
    if (addresses.length === 0) {
      console.log('No users found in database.');
      return;
    }
    console.log(`Found ${addresses.length} wallet(s) in database.\n`);
  } else {
    addresses = args;
  }

  await fundAddresses(addresses);
}

main().catch((err) => {
  console.error('Funding failed:', err);
  process.exit(1);
});
