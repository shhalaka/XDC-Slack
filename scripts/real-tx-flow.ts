/**
 * Real Transaction Flow — TXDC ↔ Private Geth Network
 *
 * Exercises the complete on-chain transaction pipeline:
 * 1. Connect to Geth
 * 2. Create wallets
 * 3. Fund via signer
 * 4. Sign & broadcast
 * 5. Track receipt
 *
 * Usage:
 *   npx ts-node --project tsconfig.json scripts/real-tx-flow.ts
 */

import { ethers } from 'ethers';

const RPC_URL = 'http://127.0.0.1:8545';
const CHAIN_ID = 123454321;
const SIGNER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const SIGNER_ADDR = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

// Connect the signer as a Wallet (not via provider.getSigner) for reliability
function getSigner(provider: ethers.JsonRpcProvider): ethers.Wallet {
  return new ethers.Wallet(SIGNER_KEY, provider);
}

async function main() {
  console.log('══════════════════════════════════════════════════');
  console.log('  TXDC → Private Geth — Real Transaction Flow');
  console.log('══════════════════════════════════════════════════');
  console.log();

  // ─── 1. Connect ─────────────────────────────────────────────
  console.log('┌─ Step 1: Connect to Geth');
  console.log(`│  RPC: ${RPC_URL}`);
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  const netVersion = await provider.send('net_version', []);
  const chainIdHex = await provider.send('eth_chainId', []);
  const blockNumber = await provider.send('eth_blockNumber', []);
  console.log(`│  net_version:          ${netVersion}`);
  console.log(`│  eth_chainId:          ${parseInt(chainIdHex, 16)}  (0x${BigInt(chainIdHex).toString(16)})`);
  console.log(`│  eth_blockNumber:      ${parseInt(blockNumber, 16)}`);
  console.log('└');
  console.log();

  // ─── 2. Check Signer Balance ─────────────────────────────────
  console.log('┌─ Step 2: Signer account');
  console.log(`│  Address:  ${SIGNER_ADDR}`);

  const signerBalance = await provider.getBalance(SIGNER_ADDR);
  const signerNonce = await provider.getTransactionCount(SIGNER_ADDR);
  console.log(`│  Balance:  ${ethers.formatEther(signerBalance)} ETH`);
  console.log(`│  Nonce:    ${signerNonce}`);
  console.log('└');
  console.log();

  // ─── 3. Generate Alice Wallet (app-side) ─────────────────────
  console.log('┌─ Step 3: Generate wallet (same as WalletManager)');
  const aliceWallet = ethers.Wallet.createRandom();
  const aliceAddr = aliceWallet.address;
  console.log(`│  Address:      ${aliceAddr}`);
  console.log(`│  Private Key:  ${aliceWallet.privateKey.slice(0, 20)}...`);
  console.log('│');
  console.log('│  RPC: eth_getBalance');
  const aliceBal = await provider.getBalance(aliceAddr);
  console.log(`│  Balance: ${ethers.formatEther(aliceBal)} ETH`);
  console.log('└');
  console.log();

  // ─── 4. Fund Alice from Signer ───────────────────────────────
  console.log('┌─ Step 4: Fund wallet from signer');
  console.log('│  RPC: eth_sendTransaction');
  console.log(`│  From:    ${SIGNER_ADDR}`);
  console.log(`│  To:      ${aliceAddr}`);
  console.log(`│  Value:   100.0 ETH`);

  const signer = getSigner(provider);

  const fundTx = await signer.sendTransaction({
    to: aliceAddr,
    value: ethers.parseEther('100.0'),
  });

  console.log(`│  TX Hash: ${fundTx.hash}`);
  console.log('│  Waiting for receipt...');
  const fundReceipt = await fundTx.wait();
  console.log(`│  Block:   ${fundReceipt!.blockNumber}`);
  console.log(`│  Gas Used: ${fundReceipt!.gasUsed.toString()}`);
  console.log(`│  Status:  ${fundReceipt!.status === 1 ? '✅ Success' : '❌ Failed'}`);
  console.log('└');
  console.log();

  // ─── 5. Check Alice's Balance After Funding ──────────────────
  console.log('┌─ Step 5: Verify balance after funding');
  console.log('│  RPC: eth_getBalance');

  const aliceBalAfter = await provider.getBalance(aliceAddr);
  console.log(`│  ${aliceAddr}`);
  console.log(`│  Balance: ${ethers.formatEther(aliceBalAfter)} ETH`);
  console.log('└');
  console.log();

  // ─── 6. Generate Bob Wallet ──────────────────────────────────
  console.log('┌─ Step 6: Generate Bob wallet');
  const bobWallet = ethers.Wallet.createRandom();
  const bobAddr = bobWallet.address;

  // Fund Bob too
  const fundBobTx = await signer.sendTransaction({
    to: bobAddr,
    value: ethers.parseEther('50.0'),
  });
  await fundBobTx.wait();
  const bobBal = await provider.getBalance(bobAddr);
  console.log(`│  ${bobAddr}: ${ethers.formatEther(bobBal)} ETH`);
  console.log('└');
  console.log();

  // ─── 7. Sign & Broadcast Transaction (app flow) ──────────────
  console.log('┌─ Step 7: Sign & broadcast (TransactionService flow)');
  console.log('│');
  console.log('│  RPC: eth_getTransactionCount (for nonce)');
  const aliceNonce = await provider.getTransactionCount(aliceAddr);
  console.log(`│  Alice nonce: ${aliceNonce}`);
  console.log('│');
  console.log('│  RPC: eth_gasPrice');
  const gasPrice = await provider.send('eth_gasPrice', []);
  const gasPriceGwei = parseInt(gasPrice, 16) / 1e9;
  console.log(`│  Gas Price: ${gasPriceGwei.toFixed(2)} Gwei`);
  console.log('│');
  console.log('│  RPC: eth_chainId');
  const chainId = parseInt(await provider.send('eth_chainId', []), 16);
  console.log(`│  Chain ID: ${chainId}`);
  console.log('│');
  console.log('│  RPC: eth_estimateGas');
  const gasLimit = await provider.send('eth_estimateGas', [
    { from: aliceAddr, to: bobAddr, value: '0x' + ethers.parseEther('10.0').toString(16) },
  ]);
  console.log(`│  Gas Limit: ${parseInt(gasLimit, 16)}`);
  console.log('│');
  console.log('│  Signing locally (WalletManager.signTransaction)');
  const signedTx = await aliceWallet.signTransaction({
    to: bobAddr,
    value: ethers.parseEther('10.0'),
    gasLimit: BigInt(gasLimit),
    gasPrice: BigInt(gasPrice),
    nonce: aliceNonce,
    chainId: chainId,
    type: 0,
  });
  console.log(`│  Signed TX: ${signedTx.slice(0, 50)}...`);
  console.log('│');
  console.log('│  RPC: eth_sendRawTransaction');
  const txHash = await provider.send('eth_sendRawTransaction', [signedTx]);
  console.log(`│  TX Hash:  ${txHash}`);
  console.log('│  Waiting for receipt...');

  // Poll for receipt
  let receipt = null;
  for (let i = 0; i < 30; i++) {
    receipt = await provider.send('eth_getTransactionReceipt', [txHash]);
    if (receipt) break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (!receipt) {
    console.log('│  ❌ Receipt not found after 30s');
    console.log('└');
    return;
  }

  console.log('│');
  console.log('│  RPC: eth_getTransactionReceipt');
  console.log(`│  Block:       ${parseInt(receipt.blockNumber, 16)}`);
  console.log(`│  Gas Used:    ${parseInt(receipt.gasUsed, 16)}`);
  console.log(`│  Status:      ${receipt.status === '0x1' ? '✅ Success' : '❌ Failed'}`);
  console.log(`│  Cumulative:  ${parseInt(receipt.cumulativeGasUsed, 16)}`);
  console.log(`│  From:        ${receipt.from}`);
  console.log(`│  To:          ${receipt.to}`);
  console.log('└');
  console.log();

  // ─── 8. Get Transaction Details ──────────────────────────────
  console.log('┌─ Step 8: Transaction details');
  console.log('│  RPC: eth_getTransactionByHash');
  const txDetails = await provider.send('eth_getTransactionByHash', [txHash]);
  console.log(`│  Hash:        ${txDetails.hash}`);
  console.log(`│  Block:       ${parseInt(txDetails.blockNumber, 16)}`);
  console.log(`│  From:        ${txDetails.from}`);
  console.log(`│  To:          ${txDetails.to}`);
  console.log(`│  Value:       ${ethers.formatEther(txDetails.value)} ETH`);
  console.log(`│  Gas Limit:   ${parseInt(txDetails.gas, 16)}`);
  console.log(`│  Gas Price:   ${parseInt(txDetails.gasPrice, 16)} wei`);
  console.log(`│  Nonce:       ${parseInt(txDetails.nonce, 16)}`);
  console.log(`│  Input:       ${txDetails.input === '0x' ? '(none)' : txDetails.input.slice(0, 50) + '...'}`);
  console.log('└');
  console.log();

  // ─── 9. Get Block Info ───────────────────────────────────────
  console.log('┌─ Step 9: Block containing the transaction');
  console.log('│  RPC: eth_getBlockByNumber');
  const block = await provider.send('eth_getBlockByNumber', [receipt.blockNumber, false]);
  console.log(`│  Block:       ${parseInt(block.number, 16)}`);
  console.log(`│  Hash:        ${block.hash}`);
  console.log(`│  Timestamp:   ${new Date(parseInt(block.timestamp, 16) * 1000).toISOString()}`);
  console.log(`│  Tx Count:    ${block.transactions.length}`);
  console.log(`│  Miner:       ${block.miner}`);
  console.log('└');
  console.log();

  // ─── 10. Final Balances ──────────────────────────────────────
  console.log('┌─ Step 10: Final balances');
  const finalAlice = await provider.getBalance(aliceAddr);
  const finalBob = await provider.getBalance(bobAddr);
  const gasCost = BigInt(gasLimit) * BigInt(gasPrice);
  const expectedAlice = ethers.parseEther('100.0') - ethers.parseEther('10.0') - gasCost;
  console.log(`│  Alice: ${ethers.formatEther(finalAlice)} ETH  (tx cost: ${ethers.formatEther(gasCost)} ETH in gas)`);
  console.log(`│  Bob:   ${ethers.formatEther(finalBob)} ETH`);
  console.log('└');
  console.log();

  // ─── Summary ─────────────────────────────────────────────────
  console.log('══════════════════════════════════════════════════');
  console.log('  Transaction Summary');
  console.log('══════════════════════════════════════════════════');
  console.log(`  Chain ID:     ${chainId}`);
  console.log(`  Block:        ${parseInt(receipt.blockNumber, 16)}`);
  console.log(`  TX Hash:      ${txHash}`);
  console.log(`  From:         ${aliceAddr}`);
  console.log(`  To:           ${bobAddr}`);
  console.log(`  Value:        10.0 TXDC`);
  console.log(`  Gas Used:     ${parseInt(receipt.gasUsed, 16)}`);
  console.log(`  Gas Price:    ${gasPriceGwei.toFixed(2)} Gwei`);
  console.log(`  Gas Cost:     ${ethers.formatEther(gasCost)} ETH`);
  console.log(`  Status:       ${receipt.status === '0x1' ? '✅ Confirmed' : '❌ Failed'}`);
  console.log(`  Timestamp:    ${new Date(parseInt(block.timestamp, 16) * 1000).toISOString()}`);
  console.log('══════════════════════════════════════════════════');
}

main().catch((err) => {
  console.error('Flow failed:', err);
  process.exit(1);
});
