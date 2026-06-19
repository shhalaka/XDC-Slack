#!/bin/sh
# Creates test accounts on the TXDC private network.
#
# Usage:
#   docker compose exec geth-node /scripts/geth-init.sh
# Or runs automatically via the geth-init service.

set -e

GETH_RPC="http://localhost:8545"
GETH_ATTACH="geth attach $GETH_RPC"
RETRIES=30
WAIT_SEC=2

echo "Waiting for Geth RPC..."
for i in $(seq 1 $RETRIES); do
  if $GETH_ATTACH --exec 'eth.blockNumber' >/dev/null 2>&1; then
    BLOCK_NUM=$($GETH_ATTACH --exec 'eth.blockNumber' 2>/dev/null)
    echo "Geth ready after ${i}s (block: $BLOCK_NUM)"
    break
  fi
  if [ "$i" -eq "$RETRIES" ]; then
    echo "Geth did not become ready — exiting"
    exit 1
  fi
  sleep "$WAIT_SEC"
done

echo ""
echo "=== TXDC Private Network Info ==="
$GETH_ATTACH --exec '
  console.log("Chain ID:          " + admin.nodeInfo.protocols.eth.config.chainId);
  console.log("Signer:            " + eth.coinbase);
  console.log("Balance:           " + web3.fromWei(eth.getBalance(eth.coinbase), "ether") + " ETH");
  console.log("Block Number:      " + eth.blockNumber);
  console.log("Net ID:            " + net.version);
'

echo ""
echo "=== Creating test accounts ==="
$GETH_ATTACH --exec '
  // Hardhat well-known accounts (unlocked by default)
  var aliceKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  var bobKey   = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

  var aliceAddr = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
  var bobAddr   = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

  // Import bob key (alice is already the signer)
  try {
    personal.importRawKey(bobKey, "txdc-dev");
    personal.unlockAccount(bobAddr, "txdc-dev", 0);
    console.log("Bob imported & unlocked: " + bobAddr);
  } catch (e) {
    console.log("Bob import: " + e);
  }

  // Fund bob from coinbase (alice is already funded via genesis alloc)
  var bobBal = eth.getBalance(bobAddr);
  if (bobBal < web3.toWei("1000", "ether")) {
    var tx = eth.sendTransaction({
      from: eth.coinbase,
      to: bobAddr,
      value: web3.toWei("10000", "ether")
    });
    console.log("Funded bob: " + tx);
  } else {
    console.log("Bob already funded: " + web3.fromWei(bobBal, "ether") + " ETH");
  }

  // Fund the app's test wallet addresses from seed script
  // (seed.ts generates random wallets and stores them in DB)
'

echo ""
echo "=== Accounts ==="
$GETH_ATTACH --exec '
  var accts = eth.accounts;
  for (var i = 0; i < accts.length; i++) {
    console.log("  [" + i + "] " + accts[i] + "  " + web3.fromWei(eth.getBalance(accts[i]), "ether") + " ETH");
  }
'

echo ""
echo "Geth init complete."
echo ""
echo "Known dev key (for funding wallets from seed script):"
echo "  Private key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
echo "  Address:     0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
echo "  (This is the Clique signer — pre-funded via genesis, auto-unlocked)"
