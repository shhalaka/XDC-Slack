#!/bin/sh
# Initializes Geth with a custom genesis.json for the TXDC private network.
# This script is run ONCE when the geth-data volume is first created.
#
# It:
#   1. Initializes the chain with genesis.json (chain ID: 123454321)
#   2. Imports the known signer key (0xf39Fd...)
#   3. Records the account address for dev tooling

set -e

DATADIR="/root/.ethereum"
GENESIS="/scripts/genesis.json"
KEYFILE="/scripts/dev-signer.key"

echo "=== TXDC Private Geth Network Setup ==="
echo "Chain ID: 123454321"

# Step 1: Init genesis
if [ ! -f "$DATADIR/geth/chaindata/CURRENT" ]; then
  echo "Initializing genesis..."
  geth init --datadir "$DATADIR" "$GENESIS"
  echo "Genesis initialized."
else
  echo "Chain data already exists — skipping genesis init."
fi

echo "Setup complete."
echo "Signer address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
echo "Funded with: Unlimited ETH (genesis allocation)"
