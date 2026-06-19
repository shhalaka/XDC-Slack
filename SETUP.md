# TXDC Assistant — Local Development Setup

This guide walks through spinning up the full TXDC stack locally for testing and development.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start (One Command)](#quick-start-one-command)
3. [Manual Step-by-Step](#manual-step-by-step)
   - [Environment Variables](#environment-variables)
   - [Start Docker Services](#start-docker-services)
   - [Initialize Geth Accounts](#initialize-geth-accounts)
   - [Seed Database](#seed-database)
   - [Start the App](#start-the-app)
4. [Verification Workflows](#verification-workflows)
   - [Health Check](#health-check)
   - [Register Users](#register-users)
   - [Balance Lookup](#balance-lookup)
   - [Transaction](#transaction)
   - [Transaction History](#transaction-history)
5. [Expected Outputs](#expected-outputs)
6. [Troubleshooting](#troubleshooting)
7. [Architecture Diagram](#architecture-diagram)

---

## Prerequisites

| Tool    | Version  | Check          |
|---------|----------|----------------|
| Node.js | >= 20.x  | `node --version` |
| npm     | >= 9.x   | `npm --version` |
| Docker  | >= 24.x  | `docker --version` |
| Docker Compose | >= 2.x | `docker compose version` |

Install dependencies:

```bash
npm install
```

---

## Quick Start (One Command)

```bash
npm run dev:up
```

This single command:
1. Starts PostgreSQL, Redis, and Geth dev node
2. Waits 3 seconds for services to initialize
3. Runs the seed script (creates `alice@txdc` and `bob@txdc`)
4. Prints "Done."

Then start the backend:

```bash
npm run start:dev
```

Finally, fund the test wallets from the Geth coinbase account (run this in a second terminal after Geth is ready):

```bash
docker compose exec geth-node /scripts/geth-init.sh
```

---

## Manual Step-by-Step

### 1. Environment Variables

Copy the default `.env` file:

```bash
cp .env.example .env
```

The included `.env` already has development-friendly defaults. Key values:

| Variable               | Dev Default        | Notes |
|------------------------|--------------------|-------|
| `NODE_ENV`             | `development`      | Enables TypeORM auto-sync + bypasses SlackSignatureGuard |
| `DB_HOST`              | `localhost`        | Points to docker-mapped port |
 | `RPC_URL`              | `http://localhost:8545`  | Points to local private Geth node (127.0.0.1:8545) |
| `RPC_CHAIN_ID`         | `123454321`            | Custom Clique PoA network (not 1337/8888) |
| `WALLET_ENCRYPTION_KEY` | *(empty)*         | Plaintext keys in dev mode |
| `SLACK_SIGNING_SECRET` | *(dummy)*          | Not validated in dev mode |

### 2. Start Docker Services

Start PostgreSQL, Redis, and the Geth private network node:

```bash
docker compose up -d postgres redis geth-node
```

Verify they are running:

```bash
docker compose ps
```

Expected output:
```
NAME                IMAGE                          STATUS
txdc-postgres       postgres:16-alpine             Up (healthy)
txdc-redis          redis:7-alpine                 Up (healthy)
txdc-geth           ethereum/client-go:v1.13.4     Up
```

The Geth container runs a custom entrypoint (`geth-entrypoint.sh`) that:
1. Initializes genesis from `scripts/genesis.json` (chain ID 123454321, Clique PoA)
2. Imports the known signer key (`0xf39Fd…92266`, Hardhat account #0)
3. Starts Geth with `--mine`, `--unlock`, and `--http.api eth,web3,net,personal`

### 3. Initialize Geth Accounts

The signer account is automatically funded via the genesis alloc (vast pre-funded balance). Run the init script to import a second dev key and fund it:

```bash
docker compose exec geth-node /scripts/geth-init.sh
```

Expected output:
```
Waiting for Geth RPC...
Geth ready after 2s (block: 42)
=== TXDC Private Network Info ===
Chain ID:          123454321
Signer:            0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Balance:           65536000000000000000.0 ETH
Block Number:      42
Net ID:            123454321

=== Creating test accounts ===
Bob imported & unlocked: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
Funded bob: 0x...

=== Accounts ===
  [0] 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266  65536000000000000000.0 ETH
  [1] 0x70997970C51812dc3A010C7d01b50e0d17dc79C8  10000.0 ETH
```

The known signer key (`0xac09…ff80`) is pre-funded with an astronomical amount via genesis alloc and can be used by the seed/funding scripts to fund any wallet.

### 4. Seed Database

Seed creates the test users `alice@txdc` and `bob@txdc` with random wallet keys and tries to fund them via Geth:

```bash
npm run seed
```

If Geth is reachable, the wallets are funded. If not, they remain unfunded (fund later with `npm run fund -- --all`).

Expected output:
```
=== TXDC Dev Seed ===

Connecting to PostgreSQL at localhost:5432...
Connected.

  alice@txdc: 0x...
  bob@txdc: 0x...

Persisting users...
  ✓ alice@txdc (id: ...)
  ✓ bob@txdc (id: ...)

Users seeded successfully.

Geth RPC reachable (chain ID: 123454321)
Dev account 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 has 65536000000000000000.0 ETH
  ✓ Funded alice@txdc with 1000 ETH (tx: 0x...)
  ✓ Funded bob@txdc with 500 ETH (tx: 0x...)

=== Seed complete ===

Accounts:
  alice@txdc           0x...  (1000 ETH)
  bob@txdc             0x...  (500 ETH)
```

### 5. Start the Backend

```bash
npm run start:dev
```

The app starts on `http://localhost:3000` with hot-reload.

Expected output:
```
[Nest] LOG [AppLogger] TXDC Assistant running on 0.0.0.0:3000
[Nest] LOG [AppLogger] Environment: development
```

Swagger docs are available at `http://localhost:3000/api/docs`.

> **Note:** In development mode, `NODE_ENV=development` causes:
> - TypeORM to auto-sync database schemas (no manual migrations needed)
> - SlackSignatureGuard to accept all requests (no HMAC verification)

---

## Verification Workflows

All workflows use `curl` to send Slack-style slash commands to the API. In development mode, the SlackSignatureGuard is bypassed, so no HMAC headers are required.

### Health Check

```bash
curl -s http://localhost:3000/api/v1/health | jq
```

### Register Users

Register Alice:

```bash
curl -s -X POST http://localhost:3000/api/v1/slack/commands \
  -H "Content-Type: application/json" \
  -d '{
    "command": "/txdc",
    "text": "register alice@txdc",
    "user_id": "U_ALICE_DEV",
    "user_name": "alice",
    "team_id": "T_DEV",
    "channel_id": "C_DEV",
    "response_url": "https://hooks.slack.com/test",
    "trigger_id": "trig_1"
  }' | jq
```

Register Bob:

```bash
curl -s -X POST http://localhost:3000/api/v1/slack/commands \
  -H "Content-Type: application/json" \
  -d '{
    "command": "/txdc",
    "text": "register bob@txdc",
    "user_id": "U_BOB_DEV",
    "user_name": "bob",
    "team_id": "T_DEV",
    "channel_id": "C_DEV",
    "response_url": "https://hooks.slack.com/test",
    "trigger_id": "trig_2"
  }' | jq
```

### Balance Lookup

```bash
curl -s -X POST http://localhost:3000/api/v1/slack/commands \
  -H "Content-Type: application/json" \
  -d '{
    "command": "/txdc",
    "text": "balance alice@txdc",
    "user_id": "U_ALICE_DEV",
    "user_name": "alice",
    "team_id": "T_DEV",
    "channel_id": "C_DEV",
    "response_url": "https://hooks.slack.com/test",
    "trigger_id": "trig_3"
  }' | jq
```

### Wallet Info

```bash
curl -s -X POST http://localhost:3000/api/v1/slack/commands \
  -H "Content-Type: application/json" \
  -d '{
    "command": "/txdc",
    "text": "wallet",
    "user_id": "U_ALICE_DEV",
    "user_name": "alice",
    "team_id": "T_DEV",
    "channel_id": "C_DEV",
    "response_url": "https://hooks.slack.com/test",
    "trigger_id": "trig_4"
  }' | jq
```

### Transaction (Send TXDC)

First check that the seed users exist in the database (the seed script created them). If they do, the "already registered" error confirms the DB has records. For a fresh send:

If the user is already registered (from the seed script), you'll get a "You are already registered" error. For testing the send flow when users already exist in the DB, you can register a new user:

```bash
curl -s -X POST http://localhost:3000/api/v1/slack/commands \
  -H "Content-Type: application/json" \
  -d '{
    "command": "/txdc",
    "text": "register carol@txdc",
    "user_id": "U_CAROL_DEV",
    "user_name": "carol",
    "team_id": "T_DEV",
    "channel_id": "C_DEV",
    "response_url": "https://hooks.slack.com/test",
    "trigger_id": "trig_5"
  }' | jq
```

Then send from carol to bob:

```bash
curl -s -X POST http://localhost:3000/api/v1/slack/commands \
  -H "Content-Type: application/json" \
  -d '{
    "command": "/txdc",
    "text": "send carol@txdc bob@txdc 10",
    "user_id": "U_CAROL_DEV",
    "user_name": "carol",
    "team_id": "T_DEV",
    "channel_id": "C_DEV",
    "response_url": "https://hooks.slack.com/test",
    "trigger_id": "trig_6"
  }' | jq
```

The send flow requires:
1. The sender is registered (yes, `carol@txdc` was just registered)
2. The receiver exists (`bob@txdc` exists from seed)
3. The sender has sufficient balance (carol's wallet needs ETH — may be 0 unless funded separately)

### Transaction History

```bash
curl -s -X POST http://localhost:3000/api/v1/slack/commands \
  -H "Content-Type: application/json" \
  -d '{
    "command": "/txdc",
    "text": "history alice@txdc",
    "user_id": "U_ALICE_DEV",
    "user_name": "alice",
    "team_id": "T_DEV",
    "channel_id": "C_DEV",
    "response_url": "https://hooks.slack.com/test",
    "trigger_id": "trig_7"
  }' | jq
```

---

## Expected Outputs

### Health Check
```json
{
  "status": "healthy",
  "uptime": 42,
  "timestamp": "2026-06-17T12:00:00.000Z",
  "version": "1.0.0"
}
```

### Register `alice@txdc` (success)
```json
{
  "response_type": "in_channel",
  "blocks": [
    { "type": "header", "text": { "type": "plain_text", "text": "🎉 Identity Registered!" } },
    { "type": "divider" },
    {
      "type": "section",
      "fields": [
        { "type": "mrkdwn", "text": "*TXDC Name:*\nalice@txdc" },
        { "type": "mrkdwn", "text": "*Wallet Address:*\n`0x...`" }
      ]
    }
  ]
}
```

### Duplicate Register (already seeded)
```json
{
  "response_type": "ephemeral",
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "⚠️ *Error:*\nYour Slack account is already linked to alice@txdc. Use /txdc update to change."
      }
    }
  ]
}
```

### Balance Check
```json
{
  "response_type": "ephemeral",
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "💰 *alice@txdc* balance: *1000.0* TXDC"
      }
    }
  ]
}
```

### Send Transaction (initiation)
```json
{
  "response_type": "ephemeral",
  "blocks": [
    { "type": "header", "text": { "type": "plain_text", "text": "⚠️ Confirm Transaction" } },
    { "type": "divider" },
    {
      "type": "section",
      "fields": [
        { "type": "mrkdwn", "text": "*From:*\ncarol@txdc" },
        { "type": "mrkdwn", "text": "*To:*\nbob@txdc" }
      ]
    },
    {
      "type": "section",
      "fields": [
        { "type": "mrkdwn", "text": "*Amount:*\n10 TXDC" },
        { "type": "mrkdwn", "text": "*Est. Gas:*\n0.00042 TXDC" }
      ]
    },
    {
      "type": "actions",
      "elements": [
        { "type": "button", "text": { "type": "plain_text", "text": "✅ Approve" }, "action_id": "tx_approve_<uuid>", "value": "<uuid>" },
        { "type": "button", "text": { "type": "plain_text", "text": "❌ Cancel" }, "action_id": "tx_cancel_<uuid>", "value": "<uuid>" }
      ]
    }
  ]
}
```

### History
```json
{
  "response_type": "ephemeral",
  "blocks": [
    { "type": "header", "text": { "type": "plain_text", "text": "📜 Transaction History: alice@txdc" } },
    { "type": "context", "elements": [{ "type": "mrkdwn", "text": "Showing 0 of 0 transactions" }] },
    { "type": "divider" },
    {
      "type": "section",
      "text": { "type": "mrkdwn", "text": "No transactions found." }
    }
  ]
}
```

---

## Troubleshooting

### PostgreSQL connection refused
```bash
# Ensure postgres is running
docker compose ps | grep postgres

# Check logs
docker compose logs postgres
```

### Geth not reachable
```bash
# Check Geth is running
docker compose ps | grep geth

# Test RPC
curl -s -X POST http://localhost:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# Expected: {"jsonrpc":"2.0","id":1,"result":"0x..."}
```

### Seed script fails ("Database already has N users")
```bash
# Clear and re-seed
docker compose exec postgres psql -U txdc -d txdc_assistant \
  -c "TRUNCATE users, audit_logs, transactions CASCADE;"
npm run seed
```

### Wallet funding fails (insufficient dev balance)
```bash
# Ensure geth-init has been run
docker compose exec geth-node /scripts/geth-init.sh
```

### TypeORM sync issues
```bash
# In dev mode, TypeORM auto-syncs. If entities changed, restart:
npm run start:dev
```

### Port conflicts
If ports 3000, 5432, 6379, or 8545 are already in use on your host:
```bash
# Change ports in docker-compose.yml or stop conflicting processes
sudo lsof -i :3000 -i :5432 -i :6379 -i :8545
```

### Slack tokens not configured
In development mode (`NODE_ENV=development`), the SlackSignatureGuard is bypassed. Dummy token values in `.env` are sufficient for local testing.

### Transaction confirm (approve/cancel) flow
The approve/cancel is designed for Slack interactive messages (Block Kit buttons). To trigger confirmation via curl:

```bash
# First initiate a send to get a transactionId
curl -s -X POST http://localhost:3000/api/v1/slack/interactions \
  -H "Content-Type: application/json" \
  -d '{
    "type": "block_actions",
    "user": { "id": "U_CAROL_DEV", "username": "carol" },
    "actions": [{ "action_id": "tx_approve_<transactionId>", "value": "<transactionId>" }],
    "container": { "channel_id": "C_DEV", "message_ts": "1234" },
    "payload": "{\"type\":\"block_actions\",\"user\":{\"id\":\"U_CAROL_DEV\"},\"actions\":[{\"action_id\":\"tx_approve_<transactionId>\",\"value\":\"<transactionId>\"}],\"container\":{\"channel_id\":\"C_DEV\",\"message_ts\":\"1234\"}}"
  }' | jq
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                       Your Terminal                             │
│  curl / Swagger UI                                              │
└─────────────────────────────┬───────────────────────────────────┘
                              │ HTTP POST /api/v1/slack/commands
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              TXDC Backend (NestJS) — localhost:3000             │
│                                                                 │
│  SlackController → SlackCommandHandler → Service Layer          │
│                                          ├── IdentityService    │
│                                          ├── WalletService      │
│                                          ├── TransactionSvc     │
│                                          └── BlockchainSvc      │
│                                              │                  │
│                                          JSON-RPC (ethers.js)   │
└──────┬──────────────────────────┬───────────────┬───────────────┘
       │                          │               │
       ▼                          ▼               ▼
┌──────────────┐    ┌────────────────────────┐  ┌────────────────┐
│  PostgreSQL   │    │  Private Geth Node     │  │    Redis       │
│  localhost:5432│    │  localhost:8545 (HTTP) │  │ localhost:6379 │
│               │    │  localhost:8546 (WS)   │  │                │
│  users        │    │                        │  │ (caching —     │
│  transactions │    │  Chain ID: 123454321   │  │  not required  │
│  audit_logs   │    │  Clique PoA (1s)       │  │  for basic ops)│
│               │    │  Signer: 0xf39Fd…92266 │  │                │
└──────────────┘    │  Pre-funded via genesis │  └────────────────┘
                    └────────────────────────┘
```

### Data Flow for `/txdc send alice@txdc bob@txdc 10`

```
1. curl → POST /api/v1/slack/commands  (body: { command, text, user_id, ... })
2. SlackSignatureGuard → checks NODE_ENV → bypasses in dev mode
3. SlackCommandHandler.handle() → parses "send alice@txdc bob@txdc 10"
4. TransactionService.initiate():
   a. Looks up sender slackId → User from DB
   b. Validates sender registration status
   c. Verifies sender owns `alice@txdc` identity
   d. Resolves `bob@txdc` via IdentityService (DB lookup)
   e. Parses amount via ethers.parseEther("10")
   f. Checks balance via BlockchainService → RPC call to Geth
   g. Estimates gas via BlockchainService → RPC eth_estimateGas
   h. Creates TransactionRecord in DB (status: pending_confirmation)
   i. Logs audit event
5. Returns Slack Block Kit message with Approve/Cancel buttons
```

---

## Files Modified/Added

| File | Purpose |
|------|---------|
| `.env` | Dev environment variables |
| `SETUP.md` | This guide (updated for private Geth network) |
| `docker-compose.yml` | Geth v1.13.4 with custom entrypoint, `--mine`, `--unlock`, `personal` API |
| `scripts/geth-entrypoint.sh` | One-shot genesis init + signer key import + Geth start |
| `scripts/geth-init.sh` | Attach to running Geth, import/fund test accounts |
| `scripts/genesis.json` | Clique PoA genesis with chain ID 123454321, pre-funded signer |
| `scripts/seed.ts` | Seeds alice/bob users + wallets to PostgreSQL |
| `scripts/fund-dev-accounts.ts` | Funds wallet addresses from known dev key |
| `scripts/real-tx-flow.ts` | End-to-end transaction flow against live Geth |
| `src/database/data-source.ts` | TypeORM DataSource for CLI migrations |
| `src/database/migrations/` | Migration directory |
| `package.json` | Added `seed`, `fund`, `migration:*`, `dev:up`, `dev:down` scripts |

---

## Known Blockers / Limitations

1. **Geth v1.13.4 pinned**: The custom genesis uses Clique PoA with `--mine` and `--unlock` flags. Geth v1.14+ removed these flags. Keep using `v1.13.4` until a migration path is chosen.

2. **No Slack real-time testing**: Without a real Slack workspace, the Block Kit interactive flow (Approve/Cancel buttons) must be tested via direct `curl` calls to the `/interactions` endpoint.

3. **Private keys in plaintext**: With `WALLET_ENCRYPTION_KEY` empty (dev default), private keys are stored as plaintext in the database. This is acceptable for local development only.

4. **Token contract calls**: If `TOKEN_ADDRESS` is set, the balance check calls an ERC-20 contract. In dev mode with no token deployed, leave `TOKEN_ADDRESS` empty to use native TXDC balance.

5. **Database clean restart**: `docker compose down -v` deletes all Docker volumes. After running it, PostgreSQL data is lost and must be re-seeded.

6. **Clique 1s period**: The genesis config sets `period: 1` (one block per second). This is aggressive for production but ideal for testing. Blocks are sealed immediately on demand.

---

## RPC Verification (Private Geth Network)

All JSON-RPC methods tested against the running Geth node (`http://127.0.0.1:8545`, chain ID 123454321):

### eth_chainId

```bash
curl -s -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
```

**Response:** `{"jsonrpc":"2.0","id":1,"result":"0x75bc371"}` (`0x75bc371` = 123454321)

### net_version

```bash
curl -s -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"net_version","params":[],"id":1}'
```

**Response:** `{"jsonrpc":"2.0","id":1,"result":"123454321"}`

### eth_blockNumber

```bash
curl -s -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

**Response (live):** `{"jsonrpc":"2.0","id":1,"result":"0x5a"}` (block 90) — increments ~1/s

### eth_getBalance

```bash
curl -s -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", "latest"],"id":1}'
```

**Response:** `{"jsonrpc":"2.0","id":1,"result":"0x314dc6448d9338c15b0a000000000000"}` (~1.15e59 ETH from genesis alloc)

### eth_sendRawTransaction

```bash
# First generate and sign locally (e.g., with ethers.js in scripts/real-tx-flow.ts)
# Then broadcast:
curl -s -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_sendRawTransaction","params":["0xf86e80843b9af23d8252089464723864a9b53a69cd6341a005566cabb2bd0fad881bc16d674ec800008080a0..."],"id":1}'
```

**Response:** `{"jsonrpc":"2.0","id":1,"result":"0x522944a6a458499ca817a395be12e56291fac41cd0f8b6726804af8f38b81ac9"}`

### eth_getTransactionReceipt

```bash
curl -s -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getTransactionReceipt","params":["0x522944a6a458499ca817a395be12e56291fac41cd0f8b6726804af8f38b81ac9"],"id":1}'
```

**Response (abbreviated):**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "blockHash": "0x24ec50a9bfaa7f7ad67f354bfc65270f5f7045e4f98f2ef00255162aa4ae7333",
    "blockNumber": "0x58",
    "from": "0x312059b2671fc07439cb0b7bcd38afd0ec2a2b2b",
    "gasUsed": "0x5208",
    "status": "0x1",
    "to": "0x64723864a9b53a69cd6341a005566cabb2bd0fad",
    "transactionHash": "0x522944a6a458499ca817a395be12e56291fac41cd0f8b6726804af8f38b81ac9",
    "transactionIndex": "0x0"
  }
}
```

### eth_gasPrice

```bash
curl -s -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_gasPrice","params":[],"id":1}'
```

**Response:** `{"jsonrpc":"2.0","id":1,"result":"0x3b9aca00"}` (1 Gwei)

### eth_estimateGas

```bash
curl -s -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_estimateGas","params":[{"from":"0x312059b2671fc07439cb0b7bcd38afd0ec2a2b2b","to":"0x64723864a9b53a69cd6341a005566cabb2bd0fad","value":"0x8ac7230489e80000"}],"id":1}'
```

**Response:** `{"jsonrpc":"2.0","id":1,"result":"0x5208"}` (21000 gas — standard ETH transfer)

### eth_getTransactionByHash

```bash
curl -s -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getTransactionByHash","params":["0x522944a6a458499ca817a395be12e56291fac41cd0f8b6726804af8f38b81ac9"],"id":1}'
```

### eth_getTransactionCount

```bash
curl -s -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getTransactionCount","params":["0x312059b2671fc07439cb0b7bcd38afd0ec2a2b2b","latest"],"id":1}'
```

### eth_getBlockByNumber

```bash
curl -s -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getBlockByNumber","params":["0x58",false],"id":1}'
```

---

## On-Chain vs Off-Chain Data Visibility

| Data | Visibility | Where | Example |
|------|-----------|-------|---------|
| **Full transaction (sender, receiver, value, nonce, gas)** | Public | On-chain (Geth) — every node sees it | `eth_getTransactionByHash` shows `from`, `to`, `value`, `gas`, `nonce` |
| **Transaction status (success/fail, gas used)** | Public | On-chain — block receipt | `eth_getTransactionReceipt` shows `status`, `gasUsed`, `blockNumber` |
| **Account balance** | Public | On-chain — computed from state | `eth_getBalance` returns any address's current balance |
| **Wallet private key** | **Private** | Off-chain — PostgreSQL `wallets.encrypted_private_key` | Only accessible via app DB query with encryption key |
| **User identity (email ↔ wallet mapping)** | **Private** | Off-chain — PostgreSQL `users` + `identities` | `alice@txdc` → wallet address mapping is app-internal |
| **Transaction metadata (memo, category, audit log)** | **Private** | Off-chain — PostgreSQL `transactions` + `audit_logs` | The app enriches on-chain hashes with business context |
| **Block producer** | Public | On-chain — Clique signer recovered from block | `eth_getBlockByNumber` → `miner` field (empty in Clique, but signer recoverable from `extraData`) |

**Key insight:** The on-chain data is a *public ledge* — anyone with RPC access can see all transactions and balances. The off-chain app database adds *private context*: who sent it (email), why (memo), and the audit trail. Private keys never touch the chain.

---

## IdentityRegistry Smart Contract

The `IdentityRegistry.sol` contract provides ENS-style on-chain name resolution for TXDC identities. It is deployed to the private Geth network and acts as a fallback resolution layer when a name is not found in the local database.

### Deployed Contract

| Property | Value |
|----------|-------|
| **Contract** | `IdentityRegistry.sol` |
| **Address** | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |
| **Deploy Block** | 1997 |
| **Compiler** | solc 0.8.15 (EVM: paris) |
| **Deployer** | `0xf39Fd…92266` (known signer key) |
| **Gas Used** | 986,412 |

### Contract Functions

| Function | Signature | Access | Description |
|----------|-----------|--------|-------------|
| `register` | `register(string name)` | Public (payable, 0.01 ETH) | Register a name to `msg.sender` |
| `registerByRegistrar` | `registerByRegistrar(string name, address owner)` | Registrar only | Backend registers a name for a user |
| `resolve` | `resolve(string name)` / `resolve(bytes32 nameHash)` | Anyone (view) | Name → address lookup |
| `reverseResolve` | `reverseResolve(address addr)` | Anyone (view) | Address → name lookup |
| `transfer` | `transfer(string name, address newOwner)` | Owner or Registrar | Transfer name to new address |
| `revoke` | `revoke(string name)` | Owner | Remove a name from registry |
| `isRegistered` | `isRegistered(string name)` | Anyone (view) | Check if name exists |
| `ownerOfName` | `ownerOfName(string name)` | Anyone (view) | Same as resolve |
| `setRegistrar` | `setRegistrar(address newRegistrar)` | Contract owner | Change registrar address |
| `withdrawFees` | `withdrawFees()` | Contract owner | Withdraw accumulated registration fees |

### Resolution Flow

```
IdentityService.resolve("alice@txdc")
  ↓
PostgreSQL lookup (users.txdc_name)
  ↓
If found in DB → return wallet_address
  ↓
If NOT found → IdentityResolver.resolve("alice@txdc")
                  ↓
              RPC call to IdentityRegistry contract
                  ↓
              eth_call → resolve("alice")  [name stripped of @txdc]
                  ↓
              Returns owner address or null
```

### Registrar Account

The backend uses a designated registrar account to register names on-chain after a successful DB registration. This avoids requiring users to sign on-chain transactions themselves.

| Property | Value |
|----------|-------|
| **Registrar Address** | `0xf39Fd…92266` (same as deployer/signer) |
| **Registrar Key Env** | `IDENTITY_REGISTRY_REGISTRAR_KEY` |

### Deployment

Compile and deploy the contract:

```bash
# Compile (EVM paris, compatible with Geth v1.13.4)
node -e "
const fs = require('fs');
const solc = require('solc');
const input = {
  language: 'Solidity',
  sources: { 'IdentityRegistry.sol': { content: fs.readFileSync('contracts/IdentityRegistry.sol', 'utf8') } },
  settings: { optimizer: { enabled: true }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
const c = output.contracts['IdentityRegistry.sol'].IdentityRegistry;
fs.mkdirSync('contracts/build', { recursive: true });
fs.writeFileSync('contracts/build/IdentityRegistry.abi', JSON.stringify(c.abi, null, 2));
fs.writeFileSync('contracts/build/IdentityRegistry.bin', c.evm.bytecode.object);
console.log('Compiled: ' + c.evm.bytecode.object.length + ' hex chars');
"

# Deploy
npx ts-node --project tsconfig.json scripts/deploy-identity-registry.ts
```

### Verify On-Chain

```bash
# Resolve an unregistered name (should return 0x000...)
curl -s -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "method":"eth_call",
    "params":[{"to":"0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0","data":"0x..."}, "latest"],
    "id":1
  }'
```

### Gas Costs (measured on private Geth, 1 Gwei gas price)

| Operation | Gas Used | Est. Cost (1 Gwei) |
|-----------|----------|-------------------|
| **Deploy contract** | 986,412 | 0.000986 TXDC |
| **registerByRegistrar** (first name, cold storage) | 116,890 | 0.000117 TXDC |
| **registerByRegistrar** (subsequent, warm storage) | ~33,000–45,000 | 0.000033–0.000045 TXDC |
| **transfer** | ~28,000 | 0.000028 TXDC |
| **resolve** (view) | 0 (eth_call, no gas) | 0 |
| **reverseResolve** (view) | 0 (eth_call, no gas) | 0 |

The first registration costs more because it writes to cold contract storage (initial SSTORE). Subsequent registrations are cheaper because the contract's storage slots are already warm. View functions (`resolve`, `reverseResolve`) cost nothing in gas — they use `eth_call` which is evaluated locally by the node.

Gas costs are low because the contract is simple (no loops, minimal storage). Most of the cost is in SSTORE operations for the name → address mapping.

### Security Considerations

1. **Registrar key is powerful**: The `registerByRegistrar` and `transfer` functions are restricted to the registrar. If the registrar key is leaked, an attacker can register arbitrary names or transfer existing names to themselves. **Store securely** — in production, use a dedicated hardware-backed key or multisig.

2. **No on-chain fee for registrar registrations**: `registerByRegistrar` does not require the `REGISTRATION_FEE` (0.01 ETH). Only public `register()` requires the fee. This is intentional — the backend already validates identity via Slack OAuth.

3. **No name expiration**: Names are registered forever. There is no renewal mechanism. This is acceptable for a private dev network but would require an expiry/grace period in production.

4. **Reverse resolution stores name strings**: The contract stores the full name string for each registration (`_names[nameHash]`). This is needed for `reverseResolve` but increases storage costs and may leak name patterns.

5. **Overloaded functions**: `resolve()`, `ownerOfName()`, and `isRegistered()` each have two overloads (`string` and `bytes32`). The ethers.js `Interface` requires explicit function signatures like `resolve(string)` to disambiguate.

### Limitations

1. **No bulk operations**: Each name registration is a separate transaction. There is no batch register method.

2. **No name renewal/expiry**: Once registered, names exist forever. There's no mechanism to reclaim unused names.

3. **No subdomains**: Unlike ENS, this contract does not support subdomain delegation.

4. **String storage for reverse resolution**: The `_names` mapping stores full name strings in contract storage, which is expensive and could be replaced with event-based resolution for large registries.

5. **Registrar is single point of failure**: Only one address can act as registrar. In production, consider a multisig or DAO-based registrar.

6. **Write operations fail silently in app code**: If `identityResolver.register()` throws during `IdentityService.register()`, the on-chain registration is skipped but the DB registration still succeeds. The user gets their identity but it's not on-chain. An admin would need to call `registerByRegistrar` manually.

### Data Flow: Full Identity Resolution

```
               ┌──────────────────┐
               │  Slack Command   │
               │  /txdc send      │
               └────────┬─────────┘
                        │
                        ▼
               ┌──────────────────┐
               │ IdentityService  │
               │ .resolve()       │
               └────────┬─────────┘
                        │
              ┌─────────┴──────────┐
              ▼                    ▼
     ┌──────────────┐    ┌──────────────────┐
     │  PostgreSQL   │    │ IdentityResolver │
     │  users table  │    │ .resolve()       │
     │  (Phase 1)    │    │                  │
     │               │    │ RpcClient        │
     │  alice@txdc   │    │ .callContract()  │
     │  → 0x1234...  │    │                  │
     └───────────────┘    │ IdentityRegistry │
                          │ (contract)       │
                          │ resolve("alice") │
                          └──────────────────┘
```

---

## Script Reference

| Script | Command | Description |
|--------|---------|-------------|
| `dev:up` | `npm run dev:up` | Start infra + seed (all-in-one) |
| `seed` | `npm run seed` | Seed alice/bob users and wallets |
| `fund` | `npm run fund -- --all` | Fund all wallet addresses from dev key |
| `fund` | `npm run fund -- <addr>` | Fund a specific address |
| `dev:down` | `npm run dev:down` | Stop and delete all containers + volumes |
| `docker:logs` | `npm run docker:logs` | Tail logs from all containers |
| `docker:init-geth` | `npm run docker:init-geth` | Run Geth init script |
| `migration:run` | `npm run migration:run` | Run pending TypeORM migrations |
| `migration:generate` | `npm run migration:generate -- src/database/migrations/MigrationName` | Generate a migration from entity changes |
| `start:dev` | `npm run start:dev` | Start NestJS with hot-reload |
| `test` | `npm test` | Run unit + integration tests |
| `test:e2e` | `npm run test:e2e` | Run end-to-end tests |
| `real-tx-flow` | `npx ts-node --project tsconfig.json scripts/real-tx-flow.ts` | Full on-chain transaction pipeline (fund → sign → broadcast → receipt) |
| `contract:compile` | `npm run contract:compile` | Compile IdentityRegistry.sol (EVM paris) |
| `contract:deploy` | `npm run contract:deploy` | Compile + deploy IdentityRegistry to private Geth |
