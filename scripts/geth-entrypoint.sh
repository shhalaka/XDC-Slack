#!/bin/sh
# Geth entrypoint for the TXDC private network (custom genesis).
#
# Run ONCE on first start:
#   1. Initializes genesis (chain ID: 123454321)
#   2. Imports the known dev signer key
#
# Then starts Geth with Clique PoA mining enabled.

set -e

DATADIR="/root/.ethereum"
GENESIS="/scripts/genesis.json"
PASSFILE="/tmp/geth-password"
KEYFILE="/tmp/dev-key.prv"

# Known signer private key (Hardhat/Anvil account #0)
SIGNER_KEY="ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
SIGNER_ADDR="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

# Step 1: Init genesis (only if fresh datadir)
if [ ! -f "$DATADIR/geth/chaindata/CURRENT" ]; then
  echo "=== Initializing genesis (chain ID: 123454321) ==="
  geth init --datadir "$DATADIR" "$GENESIS"

  # Write the private key to a temp file
  echo -n "$SIGNER_KEY" > "$KEYFILE"
  echo "" > "$PASSFILE"

  # Import the signer key into the keystore
  echo "=== Importing signer key ==="
  geth account import --datadir "$DATADIR" --password "$PASSFILE" "$KEYFILE"
  rm -f "$KEYFILE"

  echo "Genesis init complete. Signer: $SIGNER_ADDR"
else
  echo "Chain data exists — skipping genesis init."
  echo "" > "$PASSFILE"
fi

# Step 2: Start Geth with Clique PoA mining
echo ""
echo "=== Starting TXDC Private Network ==="
echo "Chain ID: 123454321  |  Signer: $SIGNER_ADDR"
echo ""

exec geth \
  --datadir "$DATADIR" \
  --networkid 123454321 \
  --http \
  --http.addr 0.0.0.0 \
  --http.port 8545 \
  --http.api eth,web3,net,personal \
  --http.corsdomain '*' \
  --ws \
  --ws.addr 0.0.0.0 \
  --ws.port 8546 \
  --ws.api eth,web3,net \
  --ws.origins '*' \
  --mine \
  --miner.etherbase "$SIGNER_ADDR" \
  --unlock "$SIGNER_ADDR" \
  --password "$PASSFILE" \
  --allow-insecure-unlock \
  --miner.gaslimit 12000000 \
  --gcmode archive
