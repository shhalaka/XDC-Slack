/**
 * Development seed script.
 *
 * Creates test users (alice@txdc, bob@txdc) with random wallet keys,
 * persists them to PostgreSQL, and optionally funds the wallets via
 * the dev Geth node.
 *
 * Usage:
 *   npx ts-node --project tsconfig.json scripts/seed.ts
 *
 * Prerequisites:
 *   - Docker containers running: postgres, geth-node (optional for funding)
 *   - .env file with DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_DATABASE
 */

import { ethers } from 'ethers';
import { DataSource } from 'typeorm';
import { User, UserRole, RegistrationStatus } from '../src/database/entities/user.entity';
import { TransactionRecord } from '../src/database/entities/transaction-record.entity';
import { AuditLog, AuditAction } from '../src/database/entities/audit-log.entity';

// ─── Configuration ─────────────────────────────────────────────

const DB_CONFIG = {
  type: 'postgres' as const,
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'txdc',
  password: process.env.DB_PASSWORD || 'txdc_secret',
  database: process.env.DB_DATABASE || 'txdc_assistant',
  entities: [User, TransactionRecord, AuditLog],
  synchronize: false, // tables must already exist (auto-synced in dev mode)
};

const RPC_URL = process.env.RPC_URL || 'http://localhost:8545';
const CHAIN_ID = parseInt(process.env.RPC_CHAIN_ID || '8888', 10);

// Known dev private key (coinbase on geth --dev; funded by geth-init.sh)
const DEV_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

// ─── Seed Data ─────────────────────────────────────────────────

interface SeedUser {
  slackId: string;
  slackTeamId: string;
  txdcName: string;
  balance: string; // ETH to fund
}

const SEED_USERS: SeedUser[] = [
  {
    slackId: 'U_ALICE_DEV',
    slackTeamId: 'T_DEV',
    txdcName: 'alice@txdc',
    balance: '1000',
  },
  {
    slackId: 'U_BOB_DEV',
    slackTeamId: 'T_DEV',
    txdcName: 'bob@txdc',
    balance: '500',
  },
];

// ─── Helpers ───────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Main ──────────────────────────────────────────────────────

async function main() {
  console.log('=== TXDC Dev Seed ===\n');

  // 1. Connect to PostgreSQL
  console.log(`Connecting to PostgreSQL at ${DB_CONFIG.host}:${DB_CONFIG.port}...`);
  const ds = new DataSource(DB_CONFIG);
  await ds.initialize();
  console.log('Connected.\n');

  const userRepo = ds.getRepository(User);
  const auditRepo = ds.getRepository(AuditLog);

  // 2. Check if already seeded
  const existing = await userRepo.count();
  if (existing > 0) {
    console.log(`Database already has ${existing} user(s). Skipping seed to avoid duplicates.`);
    console.log('To re-seed, truncate tables first:\n  TRUNCATE users, audit_logs, transactions CASCADE;');
    await ds.destroy();
    return;
  }

  // 3. Generate wallets for each seed user
  const wallets = SEED_USERS.map((u) => {
    const w = ethers.Wallet.createRandom();
    console.log(`  ${u.txdcName}: ${w.address}`);
    return { ...u, wallet: w };
  });

  // 4. Insert users into PostgreSQL
  console.log('\nPersisting users...');
  for (const entry of wallets) {
    const user = userRepo.create({
      slackId: entry.slackId,
      slackTeamId: entry.slackTeamId,
      txdcName: entry.txdcName,
      walletAddress: entry.wallet.address,
      encryptedPrivateKey: entry.wallet.privateKey, // stored in plaintext for dev
      role: UserRole.USER,
      registrationStatus: RegistrationStatus.ACTIVE,
    });

    const saved = await userRepo.save(user);

    await auditRepo.save({
      action: AuditAction.USER_REGISTERED,
      slackId: entry.slackId,
      entityType: 'user',
      entityId: saved.id,
      details: { txdcName: entry.txdcName, walletAddress: entry.wallet.address, seeded: true },
      success: true,
    });

    console.log(`  ✓ ${entry.txdcName} (id: ${saved.id})`);
  }

  console.log('\nUsers seeded successfully.\n');

  // 5. Fund wallets via Geth RPC (optional)
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  let funded = false;

  try {
    const netId = (await provider.send('eth_chainId', [])).toString();
    console.log(`Geth RPC reachable at ${RPC_URL} (chain ID: ${parseInt(netId, 16)})`);

    // Check if the dev account has funds
    const devSigner = new ethers.Wallet(DEV_PRIVATE_KEY, provider);
    const devBalance = await provider.getBalance(devSigner.address);
    const devBalanceEth = parseFloat(ethers.formatEther(devBalance));

    if (devBalanceEth < 10) {
      console.log(`Dev account has only ${devBalanceEth.toFixed(2)} ETH — insufficient for funding.`);
      console.log('Run the geth-init script first:\n  docker compose exec geth-node /scripts/geth-init.sh');
    } else {
      console.log(`Dev account ${devSigner.address} has ${devBalanceEth.toFixed(2)} ETH`);

      for (const entry of wallets) {
        const balance = await provider.getBalance(entry.wallet.address);
        const balanceEth = parseFloat(ethers.formatEther(balance));

        if (balanceEth >= parseFloat(entry.balance)) {
          console.log(`  ${entry.txdcName} already has ${balanceEth} ETH — skipping`);
          continue;
        }

        const tx = await devSigner.sendTransaction({
          to: entry.wallet.address,
          value: ethers.parseEther(entry.balance),
        });
        await tx.wait();
        console.log(`  ✓ Funded ${entry.txdcName} with ${entry.balance} ETH (tx: ${tx.hash})`);
        funded = true;
      }
    }
  } catch (err) {
    console.log(`Geth not reachable at ${RPC_URL}: ${(err as Error).message}`);
    console.log('Skipping wallet funding. Wallets will have 0 balance.');
    console.log('To fund later, start Geth and run:\n  npx ts-node scripts/fund-dev-accounts.ts');
  }

  await ds.destroy();

  console.log('\n=== Seed complete ===');
  console.log(`\nAccounts:`);
  for (const w of wallets) {
    const bal = funded ? `${w.balance} ETH` : 'unfunded';
    console.log(`  ${w.txdcName.padEnd(20)} ${w.wallet.address}  (${bal})`);
  }

  console.log('\nNext steps:');
  console.log('  1. Start the app:   npm run start:dev');
  console.log('  2. Test via curl:   See SETUP.md for examples');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
