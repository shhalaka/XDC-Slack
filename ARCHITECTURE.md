# TXDC Assistant — Architecture Document

> Version 1.0.0 | Slack Blockchain Payment Layer
>
> Human-readable payments (`alice@txdc` → `bob@txdc`) on a private Ethereum-compatible blockchain,
> with Slack as the user interface.

---

## Table of Contents

1. [Project Structure](#1-project-structure)
2. [Data Flow Architecture](#2-data-flow-architecture)
3. [Slack Message → Blockchain Transaction](#3-slack-message--blockchain-transaction)
4. [Identity Resolution Flow](#4-identity-resolution-flow)
5. [Private Key Storage & Signing](#5-private-key-storage--signing)
6. [Security Assumptions](#6-security-assumptions)
7. [Database Schema](#7-database-schema)

---

## 1. Project Structure

```
/home/shalaka/XDC-UPI/
├── src/
│   ├── main.ts                          # NestJS bootstrap, global pipes, middleware
│   ├── app.module.ts                    # Root module wiring all features
│   │
│   ├── config/
│   │   ├── configuration.ts             # Centralized env-to-config mapping
│   │   └── swagger.config.ts            # OpenAPI docs setup (dev only)
│   │
│   ├── common/
│   │   ├── guards/
│   │   │   └── slack-signature.guard.ts # HMAC-SHA256 request verification
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts # Unified error response shape
│   │   └── interceptors/
│   │       └── transform.interceptor.ts # Wraps all responses in { success, data, timestamp }
│   │
│   ├── modules/
│   │   │
│   │   ├── slack/                       # ── Slack Integration Layer ──
│   │   │   ├── slack.module.ts          # Module declaration
│   │   │   ├── slack.controller.ts      # HTTP endpoints: /commands, /interactions, /events, /oauth
│   │   │   ├── slack.service.ts         # Slack WebClient + Block Kit builders (rich UI)
│   │   │   └── slack.commands.ts        # Slash command router → delegates to domain services
│   │   │
│   │   ├── identity/                    # ── Identity Management ──
│   │   │   ├── identity.module.ts
│   │   │   ├── identity.service.ts      # CRUD for @txdc identities, validation, duplicate checks
│   │   │   └── identity.resolver.ts     # Phase 2: on-chain ENS-style resolution via RPC
│   │   │
│   │   ├── wallet/                      # ── Wallet Management ──
│   │   │   ├── wallet.module.ts
│   │   │   ├── wallet.service.ts        # Balance queries, wallet info aggregation
│   │   │   └── wallet.manager.ts        # Key generation, AES-256-GCM encrypt/decrypt, tx signing
│   │   │
│   │   ├── transaction/                 # ── Transaction Processing ──
│   │   │   ├── transaction.module.ts
│   │   │   └── transaction.service.ts   # Initiate → confirm → sign → broadcast → track
│   │   │
│   │   └── blockchain/                  # ── Blockchain Abstraction ──
│   │       ├── blockchain.module.ts
│   │       ├── blockchain.service.ts    # High-level: balance, gas estimates, status checks
│   │       └── rpc-client.ts           # Low-level: JSON-RPC with multi-node failover + retry
│   │
│   ├── database/                        # ── Data Layer ──
│   │   ├── database.module.ts
│   │   └── entities/
│   │       ├── user.entity.ts           # users table
│   │       ├── transaction-record.entity.ts  # transactions table
│   │       └── audit-log.entity.ts      # audit_logs table
│   │
│   ├── security/                        # ── Security ──
│   │   ├── crypto.service.ts            # Node.js crypto (AES-256-GCM)
│   │   └── rate-limiter.ts             # In-memory per-key rate limiter
│   │
│   └── monitoring/                      # ── Observability ──
│       ├── monitoring.module.ts
│       ├── health.controller.ts         # /health, /readiness, /liveness
│       └── logger.ts                    # Winston structured logger
│
├── contracts/
│   └── IdentityRegistry.sol            # Phase 2: ENS-style on-chain name → address registry
│
├── tests/
│   ├── unit/                            # Isolated module tests (mocked deps)
│   │   ├── identity.service.spec.ts
│   │   └── blockchain.service.spec.ts
│   ├── integration/                     # Real DB / RPC tests (empty — TBD)
│   └── e2e/                             # Full flow tests
│       └── transaction-flow.spec.ts
│
├── scripts/
│   ├── init-db.sql                      # PostgreSQL schema + indexes + triggers
│   └── geth-init.sh                     # Geth dev node account funding
│
├── Dockerfile                           # Multi-stage: builder → production
├── docker-compose.yml                   # app + postgres + redis + geth
├── .env.example                         # All config keys with documentation
├── package.json
├── tsconfig.json
└── nest-cli.json
```

### Module Dependency Graph

```
AppModule
 ├── ConfigModule (global)
 ├── ThrottlerModule (rate limiting)
 ├── TypeOrmModule (PostgreSQL)
 ├── ScheduleModule (cron tasks)
 │
 ├── DatabaseModule
 │    └── exports: UserRepository, TransactionRepository, AuditLogRepository
 │
 ├── BlockchainModule (global)
 │    └── exports: BlockchainService, RpcClient
 │
 ├── IdentityModule
 │    ├── imports: DatabaseModule
 │    └── depends on: BlockchainModule (for RpcClient in IdentityResolver)
 │
 ├── WalletModule
 │    ├── imports: DatabaseModule
 │    └── depends on: BlockchainModule (balance queries)
 │
 ├── TransactionModule
 │    ├── imports: DatabaseModule
 │    └── depends on: BlockchainModule, IdentityModule, WalletModule
 │
 ├── SlackModule
 │    └── depends on: IdentityModule, WalletModule, TransactionModule
 │
 └── MonitoringModule
      └── (no internal deps)
```

---

## 2. Data Flow Architecture

### Layer Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         SLACK LAYER                                  │
│                                                                     │
│  User types /txdc send alice@txdc bob@txdc 10                      │
│       │                                                             │
│       ▼                                                             │
│  Slack Slash Command HTTP POST → /api/v1/slack/commands             │
│       │                                                             │
│       ▼                                                             │
│  SlackSignatureGuard (HMAC-SHA256 verification)                     │
│       │                                                             │
│       ▼                                                             │
│  ThrottlerGuard (rate limit check)                                  │
└───────┼─────────────────────────────────────────────────────────────┘
        │
┌───────▼─────────────────────────────────────────────────────────────┐
│                        API / SERVICE LAYER                           │
│                                                                     │
│  SlackController.handleSlashCommand()                               │
│       │                                                             │
│       ▼                                                             │
│  SlackCommandHandler.handle()  ──  command router                   │
│       │                                                             │
│       ├── "register"    → IdentityService.register()                │
│       ├── "wallet"      → WalletService.getWalletInfo()             │
│       ├── "balance"     → WalletService.getBalanceByIdentity()      │
│       ├── "send"        → TransactionService.initiate()             │
│       ├── "transaction" → TransactionService.getTransaction()       │
│       └── "history"     → TransactionService.getHistory()           │
│                                                                     │
│  Each service method:                                               │
│       │                                                             │
│       ├── Validates input (class-validator, custom logic)           │
│       ├── Queries PostgreSQL via TypeORM repositories               │
│       ├── Calls BlockchainService for on-chain data                 │
│       ├── Writes to AuditLog for every action                       │
│       └── Returns structured data → SlackService builds Block Kit   │
└───────┼─────────────────────────────────────────────────────────────┘
        │
┌───────▼─────────────────────────────────────────────────────────────┐
│                      BLOCKCHAIN LAYER                                │
│                                                                     │
│  BlockchainService                                                  │
│       │                                                             │
│       ▼                                                             │
│  RpcClient.call<T>(method, params)                                  │
│       │                                                             │
│       ├── Tries primary node: rpcUrl                                │
│       ├── On failure → tries fallbackUrls[0..N]                     │
│       ├── On all fail → retry up to retryCount times                │
│       │                                                             │
│       ▼                                                             │
│  Geth JSON-RPC (HTTP)                                               │
│       │                                                             │
│       ├── eth_getBalance                                            │
│       ├── eth_sendRawTransaction                                    │
│       ├── eth_getTransactionReceipt                                 │
│       ├── eth_getTransactionByHash                                  │
│       ├── eth_estimateGas                                           │
│       ├── eth_getTransactionCount (nonce)                           │
│       ├── eth_gasPrice                                              │
│       ├── eth_blockNumber                                           │
│       ├── eth_chainId                                               │
│       └── eth_call (contract queries)                               │
└───────┼─────────────────────────────────────────────────────────────┘
        │
┌───────▼─────────────────────────────────────────────────────────────┐
│                      DATA LAYER                                      │
│                                                                     │
│  ┌────────────────────┐   ┌────────────────────┐                    │
│  │    PostgreSQL       │   │      Redis         │                    │
│  │                    │   │                    │                    │
│  │  ┌─ users         │   │  Rate limit state   │                    │
│  │  ├─ transactions  │   │  Session cache      │                    │
│  │  ├─ audit_logs   │   │  Job queue           │                    │
│  │  └─ migrations   │   │                    │                    │
│  └────────────────────┘   └────────────────────┘                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Slack Message → Blockchain Transaction

### Complete Trace: `/txdc send alice@txdc bob@txdc 10`

```
Step 1: SLACK USER INPUT
─────────────────────
  User types in any Slack channel:
    /txdc send alice@txdc bob@txdc 10

  Slack sends HTTP POST to:
    POST /api/v1/slack/commands
    Headers: x-slack-signature, x-slack-request-timestamp
    Body (URL-encoded):
      command=/txdc
      text=send alice@txdc bob@txdc 10
      user_id=U_ALICE_SLACK_ID
      user_name=alice
      team_id=T_WORKSPACE_ID
      channel_id=C_GENERAL

Step 2: REQUEST VERIFICATION
─────────────────────────
  SlackSignatureGuard:
    1. Reads x-slack-signature and x-slack-request-timestamp
    2. Verifies timestamp is within 5 minutes
    3. Computes HMAC-SHA256("v0:{timestamp}:{rawBody}", signingSecret)
    4. Timing-safe compare against x-slack-signature
    5. Rejects with 401 if mismatch

  ThrottlerGuard (NestJS built-in):
    1. Checks per-IP / per-user rate
    2. Default: 30 requests per 60s window
    3. Returns 429 if exceeded

Step 3: COMMAND ROUTING
─────────────────────
  SlackController.handleSlashCommand(body)
    → SlackCommandHandler.handle(payload)

  SlackCommandHandler parses args:
    args = ["send", "alice@txdc", "bob@txdc", "10"]
    subcommand = "send"

  Routes to: this.handleSend(payload, args)
    senderIdentity   = "alice@txdc"
    receiverIdentity = "bob@txdc"
    amount           = "10"

Step 4: TRANSACTION INITIATION
────────────────────────────
  TransactionService.initiate({
    slackId: "U_ALICE_SLACK_ID",
    senderIdentity: "alice@txdc",
    receiverIdentity: "bob@txdc",
    amount: "10"
  })

  ┌─ 4a. SENDER VERIFICATION
  │   UserRepository.findOne({ slackId: "U_ALICE_SLACK_ID" })
  │   → Verifies user exists, status = active
  │   → Verifies user.txdcName === "alice@txdc" (ownership)
  │   → Rejects if user is senderIdentity impostor

  ├─ 4b. RECEIVER RESOLUTION
  │   IdentityService.resolve("bob@txdc")
  │   → UserRepository.findOne({ txdcName: "bob@txdc" })
  │   → If not found, fallback to IdentityResolver.resolve("bob@txdc")
  │     → RpcClient eth_call on IdentityRegistry contract
  │   → Rejects if neither DB nor on-chain has the identity

  ├─ 4c. AMOUNT VALIDATION
  │   ethers.parseEther("10") → 10000000000000000000n
  │   → Rejects if amount ≤ 0

  ├─ 4d. BALANCE CHECK
  │   BlockchainService.getBalance(sender.walletAddress)
  │   → RpcClient: eth_getBalance("0xSENDER...", "latest")
  │   → Compare balanceWei ≥ amount
  │   → Rejects with "Insufficient balance" if insufficient

  ├─ 4e. GAS ESTIMATION
  │   BlockchainService.estimateGas(from, to, value)
  │     → RpcClient: eth_estimateGas({ from, to, value })
  │     → RpcClient: eth_gasPrice()
  │   → Verifies balance covers amount + gasCost

  └─ 4f. PERSIST + AUDIT
      TransactionRecord.create({
        senderIdentity, receiverIdentity,
        senderAddress, receiverAddress,
        amount: "10", gasLimit, gasPrice,
        status: "pending_confirmation"
      })
      AuditLog.save({ action: "transaction.initiated", ... })

  Returns: { transactionId, requiresConfirmation: true, estimatedGas }

Step 5: SLACK RESPONSE (CONFIRMATION UI)
──────────────────────────────────────
  SlackService.buildTransactionConfirmBlocks(
    "alice@txdc", "bob@txdc",
    "10", "TXDC",
    estimatedGas, transactionId
  )

  Slack renders Block Kit:
    ┌─────────────────────────────────────┐
    │  ⚠️ Confirm Transaction              │
    │                                     │
    │  From: alice@txdc                   │
    │  To:   bob@txdc                     │
    │  Amount: 10 TXDC                    │
    │  Est. Gas: 0.000042 TXDC            │
    │                                     │
    │  [✅ Approve]    [❌ Cancel]        │
    └─────────────────────────────────────┘

Step 6: USER CONFIRMATION
────────────────────────
  User clicks [✅ Approve]

  Slack sends HTTP POST:
    POST /api/v1/slack/interactions
    Body: payload={ type: "block_actions",
                    actions: [{ action_id: "tx_approve_<uuid>",
                                value: "<transactionId>" }],
                    user: { id: "U_ALICE_SLACK_ID" } }

Step 7: TRANSACTION CONFIRMATION
──────────────────────────────
  TransactionService.confirm({
    transactionId,
    slackId: "U_ALICE_SLACK_ID",
    approved: true
  })

  ┌─ 7a. VERIFY OWNERSHIP
  │   Load TransactionRecord + senderUser relation
  │   → Must match slackId
  │   → Must be in "pending_confirmation" status

  ├─ 7b. DECRYPT KEY
  │   WalletManager.decryptPrivateKey(
  │     user.encryptedPrivateKey
  │   )
  │   → CryptoJS.AES.decrypt(ciphertext, encryptionKey)
  │   → Returns raw hex private key (in memory only)

  ├─ 7c. BUILD TRANSACTION
  │   RpcClient: eth_getTransactionCount(senderAddress, "pending")
  │     → Returns nonce (e.g., 5)
  │   {chainId} = BlockchainService.getChainId()
  │
  │   unsignedTx = {
  │     to: receiverAddress,
  │     value: ethers.parseEther("10"),
  │     gasLimit: BigInt(gasLimit),
  │     gasPrice: BigInt(gasPrice),
  │     nonce: 5,
  │     chainId: 8888,
  │     type: 0  // legacy tx
  │   }

  ├─ 7d. SIGN TRANSACTION
  │   wallet = new ethers.Wallet(privateKey)
  │   signedTx = wallet.signTransaction(unsignedTx)
  │   → Private key in memory, garbage collected after

  ├─ 7e. BROADCAST
  │   RpcClient: eth_sendRawTransaction(signedTx)
  │   → Returns txHash: "0x52b0..."
  │
  │   TransactionRecord update:
  │     txHash = "0x52b0...",
  │     signedTransaction = "...",
  │     nonce = 5,
  │     status = "pending"

  ├─ 7f. AUDIT
  │   AuditLog.save({ action: "transaction.confirmed", ... })

  └─ 7g. RETURN
      Returns { txHash: "0x52b0...", status: "broadcast" }

Step 8: SLACK RESPONSE (RESULT)
─────────────────────────────
  SlackService.buildTransactionResultBlocks(
    "alice@txdc", "bob@txdc",
    "10", "TXDC",
    "0x52b0...",
    "broadcast"
  )

  Slack updates the original message:
    ┌─────────────────────────────────────┐
    │  ✅ Transaction Successful           │
    │                                     │
    │  From: alice@txdc                   │
    │  To:   bob@txdc                     │
    │  Amount: 10 TXDC                    │
    │  Status: ✅ Broadcasted             │
    │  Hash: 0x52b0...                    │
    └─────────────────────────────────────┘

Step 9: BACKGROUND CONFIRMATION TRACKING
──────────────────────────────────────
  (Future: cron job or tx subscription)
  Polls eth_getTransactionReceipt(hash) every ~5s
  → When receipt.status === "0x1": mark confirmed
  → When receipt.status === "0x0": mark failed
  → Updates TransactionRecord + notifies user via DM
```

---

## 4. Identity Resolution Flow

```
                   ┌──────────────────────┐
                   │  "alice@txdc"         │
                   └──────────┬───────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  TXDC_NAME_REGEX              │
              │  /^[a-z0-9][a-z0-9-_.]{2,31}  │
              │         @txdc$/               │
              └───────────────────────────────┘
              Invalid format → 400 Bad Request
                              │
                              ▼
              ┌───────────────────────────────┐
              │  Phase 1: Database Lookup     │
              │  UserRepository.findOne({      │
              │    txdcName: "alice@txdc"      │
              │  })                             │
              └───────────────────────────────┘
              │                        │
              Found                    Not Found
              │                        │
              ▼                        ▼
     ┌──────────────────┐   ┌───────────────────────────────┐
     │ Return address    │   │  Phase 2: On-Chain Lookup    │
     │ from row          │   │  (if IdentityRegistry        │
     │                   │   │   address is configured)     │
     │                   │   └───────────────┬───────────────┘
     │                   │                   │
     │                   │        ┌──────────────────────────┐
     │                   │        │  eth_call({               │
     │                   │        │    to: registryAddress,   │
     │                   │        │    data: resolve(         │
     │                   │        │     keccak256("alice")    │
     │                   │        │    )                      │
     │                   │        │  })                       │
     │                   │        └──────────────────────────┘
     │                   │                   │
     │                   │        Found ─────┤─────── Not Found
     │                   │        │          │         │
     │                   │        ▼          ▼         ▼
     │                   │   Return     Return     Return null
     │                   │   address    null       (not found)
     ▼                   ▼
  ┌──────────────────────────────────────────────┐
  │  IdentityInfo {                               │
  │    slackId, txdcName, walletAddress,          │
  │    role, status, createdAt                    │
  │  }                                            │
  └──────────────────────────────────────────────┘
```

### Resolution Priority

```
1. Database (PostgreSQL users table)
   └─ Fastest, always canonical for Phase 1
   └─ Requires identity to be registered via /txdc register

2. On-chain (IdentityRegistry contract via eth_call)
   └─ Fallback for Phase 2 when registry is deployed
   └─ Allows external wallets to register identities
   └─ Requires populated IdentityRegistry.sol on the network

3. Failure
   └─ Returns null → caller handles "Identity not found" error
```

### Name Validation Rules

| Rule | Regex / Check | Example |
|------|--------------|---------|
| Must end with `@txdc` | Literal suffix | `alice@txdc` ✅, `alice@eth` ❌ |
| Length 3–32 chars (before @) | `{2,31}` before `@` | `ab@txdc` ❌ (too short) |
| Lowercase only | `[a-z0-9]` | `Alice@txdc` ❌ |
| Allowed special chars | `-`, `_`, `.` | `alice_wallet@txdc` ✅ |
| Must start with alphanumeric | `[a-z0-9]` at pos 0 | `-alice@txdc` ❌ |

---

## 5. Private Key Storage & Signing

### Key Hierarchy

```
                         ┌─────────────────────┐
                         │  RNG Seed (OS random) │
                         └──────────┬──────────┘
                                    ▼
                         ┌─────────────────────┐
                         │  ethers.Wallet       │
                         │  .createRandom()     │
                         ├─────────────────────┤
                         │  address: 0x...     │
                         │  privateKey: 0x...  │
                         │  publicKey: 0x...   │
                         └──────────┬──────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
                    ▼                               ▼
        ┌─────────────────────┐         ┌─────────────────────┐
        │  Address (public)    │         │  Private Key         │
        │  Stored in plaintext │         │  (never stored raw)  │
        │  in users table      │         └──────────┬──────────┘
        └─────────────────────┘                    │
                                                   ▼
                                        ┌─────────────────────┐
                                        │  WalletManager       │
                                        │  .encryptPrivateKey  │
                                        │                     │
                                        │  crypto-js           │
                                        │  AES.encrypt(        │
                                        │    privateKey,       │
                                        │    encryptionKey     │
                                        │  )                   │
                                        ├─────────────────────┤
                                        │  Output: base64 AES  │
                                        │  ciphertext          │
                                        └──────────┬──────────┘
                                                   │
                                                   ▼
                                        ┌─────────────────────┐
                                        │  PostgreSQL          │
                                        │  users              │
                                        │  .encrypted_key     │
                                        │  (column-level       │
                                        │   encrypted)         │
                                        └─────────────────────┘
```

### Signing Flow (at transaction time)

```
Confirm Transaction Request
           │
           ▼
    ┌──────────────────┐
    │ Load user row     │
    │ from DB           │
    └───────┬──────────┘
            │
            ▼
    ┌──────────────────┐
    │ Read encrypted    │
    │ private key       │
    │ from column       │
    └───────┬──────────┘
            │
            ▼
    ┌───────────────────────────────┐
    │ WalletManager.decryptPrivateKey│
    │ AES.decrypt(ciphertext, key)   │
    │ → raw hex private key in mem  │
    └───────┬───────────────────────┘
            │
            ▼
    ┌──────────────────┐
    │ new ethers.Wallet │
    │ (privateKey)      │
    └───────┬──────────┘
            │
            ▼
    ┌──────────────────────────────────┐
    │ Build unsigned tx:               │
    │ { to, value, gasLimit,           │
    │   gasPrice, nonce, chainId }     │
    └───────┬──────────────────────────┘
            │
            ▼
    ┌──────────────────┐
    │ wallet.signTx()  │
    │ → RLP-encoded    │
    │   signed tx hex  │
    └───────┬──────────┘
            │
            ▼
    ┌──────────────────┐
    │ Clear privateKey │
    │ from memory      │
    │ (let it GC)      │
    └───────┬──────────┘
            │
            ▼
    ┌────────────────────────────┐
    │ eth_sendRawTransaction(    │
    │   signedTxHex              │
    │ )                          │
    │ → txHash                   │
    └────────────────────────────┘
```

### Security Properties

| Property | Mechanism |
|----------|-----------|
| **At rest** | AES-256-GCM encryption with random IV and auth tag |
| **In transit** | Not transmitted — decrypted only in process memory |
| **In use** | Exists as JS string, no explicit zeroing (V8 GC dependent) |
| **Key separation** | `WALLET_ENCRYPTION_KEY` is separate from all other secrets |
| **Production hardening** | Replace with AWS KMS `Encrypt`/`Decrypt` API calls; key never leaves KMS |
| **HSM future** | Replace `WalletManager.signTransaction` with call to signing service over gRPC |

### What the Encryption Key IS and IS NOT

| Role | Value |
|------|-------|
| **Is** | A symmetric AES-256 key used to encrypt private keys before DB storage |
| **Is** | Read from `WALLET_ENCRYPTION_KEY` env var at startup |
| **Is not** | A blockchain private key — it cannot sign transactions alone |
| **Is not** | Stored in the database — it lives only in the application's config |
| **Is not** | The user's Slack token or any authentication credential |

### Threat Model (Key Storage)

| Threat | Mitigation |
|--------|-----------|
| DB compromised, encrypted keys leaked | Attacker cannot decrypt without `WALLET_ENCRYPTION_KEY` |
| App server compromised, env read | Attacker gets encryption key but still needs DB access |
| Both DB and env compromised | Attacker can decrypt all keys. **Requires HSM/KMS for true security** |
| Memory dump of running process | Private key exists in plaintext only during signing window (~100ms) |
| Side-channel via error messages | Key-related errors are caught and logged generically |

---

## 6. Security Assumptions

### Trust Boundaries

```
         Slack                     TXDC Backend                    Blockchain
   ┌─────────────┐          ┌────────────────────┐          ┌────────────────┐
   │             │   TLS    │                    │   TLS    │                │
   │ Slack User  │─────────▶│  API Gateway       │─────────▶│  Geth Node     │
   │             │          │  (NestJS Server)   │          │  (JSON-RPC)    │
   └─────────────┘          │                    │          └────────────────┘
                            │  ┌──────────────┐  │
                            │  │ Service Layer │  │
                            │  └──────┬───────┘  │
                            │         │          │
                            │  ┌──────▼───────┐  │
                            │  │  PostgreSQL   │  │
                            │  └──────────────┘  │
                            └────────────────────┘
```

### Assumptions

```
ASSUMPTION 1: Slack Request Integrity
─────────────────────────────────────
  We assume Slack's HMAC-SHA256 signing provides proof of origin.
  SlackSignatureGuard verifies every request.
  Compromise of SLACK_SIGNING_SECRET = total loss of request authentication.

  Risk: MEDIUM
  Mitigation: Rotate signing secret regularly. Restrict to workspace-level tokens.

ASSUMPTION 2: Geth RPC Node Honesty
───────────────────────────────────────
  We assume the configured RPC endpoints return accurate blockchain state.
  A malicious RPC node could:
    - Report fake balances (allow overspending)
    - Reject valid transactions (denial of service)
    - Front-run transactions (MEV)
    - Return fake receipt statuses

  Risk: HIGH
  Mitigation:
    - Run your own Geth node (do not use public RPC for production)
    - Use multiple independent nodes and compare results
    - Validate transaction inclusion via multiple block explorers
    - Eventually: light client verification

ASSUMPTION 3: Encrypted Key Security
─────────────────────────────────────
  We assume WALLET_ENCRYPTION_KEY is stored securely and never logged.
  Current implementation uses AES-256-GCM with a single static key.

  Risk: HIGH for production
  Mitigation:
    - Phase 1 (current): Encrypted at rest, single env var. Acceptable for low-value / testnet.
    - Phase 2: AWS KMS / HashiCorp Vault with automatic key rotation.
    - Phase 3: HSM-backed signing where private key never enters application memory.

ASSUMPTION 4: No Transaction Replay
─────────────────────────────────────
  We assume chainId is correctly configured and enforced.
  All signed transactions include chainId to prevent cross-chain replay.

  Risk: LOW (with correct config)
  Mitigation: chainId validated before every signing operation.

ASSUMPTION 5: User Slack Account Security
──────────────────────────────────────────
  We assume the Slack user who initiated /txdc register is the legitimate owner.
  There is no additional KYC or MFA beyond Slack's own authentication.

  Risk: MEDIUM
  Mitigation:
    - Support workspace-level admin approval for registrations
    - OAuth re-verification for high-value transactions (>threshold)
    - Rate limits and daily caps limit blast radius

ASSUMPTION 6: Database Integrity
─────────────────────────────────
  We assume PostgreSQL is configured with:
    - Encryption at rest (AWS RDS encryption or similar)
    - Encryption in transit (TLS between app and DB)
    - Proper network isolation (private subnet, security groups)

  Risk: LOW (with proper infra)
  Mitigation: Documented in deployment playbook.

ASSUMPTION 7: No Race Conditions on Nonce
───────────────────────────────────────────
  We assume no concurrent transactions for the same wallet.
  The nonce is fetched with "pending" block tag, but concurrent
  signing requests could use the same nonce.

  Risk: MEDIUM (for MVP)
  Mitigation:
    - MVP: Single-process design avoids most races.
    - Production: Distributed lock (Redis) per-wallet during signing.
    - Future: Nonce management service with atomic increment.
```

### Rate Limits & Abuse Prevention

| Limit | Scope | Value | Enforcement |
|-------|-------|-------|-------------|
| API requests | Per IP | 30/60s | NestJS ThrottlerGuard |
| Daily transactions | Per user | 100/day | Application check in TransactionService |
| Daily volume | Per user | 1000 TXDC/day | Application check in TransactionService |
| Command frequency | Per user | 10/60s per endpoint | ThrottlerGuard on SlackController |
| Identity registrations | Per Slack ID | 1 (unique) | Database UNIQUE constraint |

### Audit Events (every action is logged)

| Event | Data Logged |
|-------|-------------|
| `user.registered` | slackId, txdcName, walletAddress |
| `user.updated` | Changed fields (old → new) |
| `transaction.initiated` | from, to, amount, gasEstimate |
| `transaction.confirmed` | transactionId, txHash |
| `transaction.failed` | transactionId, error stack |
| `transaction.rejected` | transactionId, reason |
| `balance.checked` | identity queried |
| `rate_limit.hit` | key, limit exceeded |
| `slash_command.executed` | command text, user |

---

## 7. Database Schema

### Entity-Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                          users                                   │
├─────────────────────────────────────────────────────────────────┤
│  PK  id                     UUID                                 │
│  UK  slack_id               VARCHAR(255)     ← Slack user ID     │
│      slack_team_id          VARCHAR(255)     ← Workspace ID      │
│  UK  txdc_name              VARCHAR(63)      ← "alice@txdc"      │
│  UK  wallet_address         VARCHAR(42)      ← "0x..."           │
│      encrypted_private_key  TEXT             ← AES-GCM ciphertext│
│      role                   ENUM(user|admin|whitelisted)         │
│      registration_status    ENUM(pending|active|suspended|revoked)│
│      daily_volume_used      DECIMAL(36,18)   ← 24h rolling       │
│      daily_transaction_count INTEGER          ← 24h rolling       │
│      last_transaction_at    TIMESTAMPTZ                          │
│      daily_limit_reset_at   TIMESTAMPTZ                          │
│      metadata               JSONB                                │
│      created_at             TIMESTAMPTZ                          │
│      updated_at             TIMESTAMPTZ                          │
└────────────────────────────────┬────────────────────────────────┘
                                 │
           ┌─────────────────────┼─────────────────────┐
           │                     │                     │
           ▼                     ▼                     ▼
┌──────────────────┐  ┌──────────────────┐  ┌────────────────────┐
│   transactions    │  │   transactions   │  │    audit_logs      │
│ (sender_user_id)  │  │ (receiver_user_id)│ │                    │
├──────────────────┤  ├──────────────────┤  ├────────────────────┤
│ FK sender_user_id│  │ FK receiver_     │  │ PK  id    UUID     │
│    → users.id    │  │    user_id       │  │     action VARCHAR  │
│ FK receiver_     │  │    → users.id    │  │     slack_id        │
│    user_id       │  │                  │  │     entity_type     │
│    → users.id    │  │                  │  │     entity_id       │
└──────────────────┘  └──────────────────┘  │     details JSONB   │
                                            │     success BOOL    │
                                            │     error_message   │
                                            │     latency_ms      │
                                            │     created_at      │
                                            └────────────────────┘
```

### Table: `users`

```sql
CREATE TABLE users (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slack_id              VARCHAR(255) UNIQUE NOT NULL,
    slack_team_id         VARCHAR(255),
    txdc_name             VARCHAR(63) UNIQUE NOT NULL,
    wallet_address        VARCHAR(42) UNIQUE NOT NULL,
    encrypted_private_key TEXT,
    role                  VARCHAR(20) DEFAULT 'user'
                          CHECK (role IN ('user','admin','whitelisted')),
    registration_status   VARCHAR(20) DEFAULT 'active'
                          CHECK (registration_status IN ('pending','active','suspended','revoked')),
    daily_volume_used     DECIMAL(36,18) DEFAULT '0',
    daily_transaction_count INTEGER DEFAULT 0,
    last_transaction_at   TIMESTAMPTZ,
    daily_limit_reset_at  TIMESTAMPTZ,
    metadata              JSONB,
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Lookup indexes
CREATE INDEX idx_users_slack_id    ON users(slack_id);
CREATE INDEX idx_users_txdc_name   ON users(txdc_name);
CREATE INDEX idx_users_wallet_addr ON users(wallet_address);
CREATE INDEX idx_users_status      ON users(registration_status);
```

**Index Strategy:**

| Index | Type | Why |
|-------|------|-----|
| `slack_id` | Unique B-tree | O(1) lookup on every command (identify sender) |
| `txdc_name` | Unique B-tree | O(1) identity resolution |
| `wallet_address` | Unique B-tree | O(1) reverse lookup (transaction tracking) |
| `registration_status` | B-tree | Filter active users for queries, admin scans |

**Row Size Estimate:** ~800 bytes per row (without metadata). ~250k rows/page at 8KB page size.

### Table: `transactions`

```sql
CREATE TABLE transactions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tx_hash               VARCHAR(66) UNIQUE,           -- blockchain tx hash, null before broadcast
    sender_identity       VARCHAR(63) NOT NULL,          -- "alice@txdc" (denormalized for history)
    receiver_identity     VARCHAR(63) NOT NULL,          -- "bob@txdc"
    sender_address        VARCHAR(42) NOT NULL,          -- blockchain address
    receiver_address      VARCHAR(42) NOT NULL,
    amount                DECIMAL(36,18) NOT NULL,
    gas_limit             BIGINT,
    gas_price             VARCHAR(66),                   -- hex wei
    gas_used              BIGINT,
    nonce                 INTEGER,
    block_number          BIGINT,
    block_timestamp       BIGINT,
    status                VARCHAR(30) DEFAULT 'pending_confirmation'
                          CHECK (status IN ('pending','pending_confirmation','confirmed','failed','rejected')),
    type                  VARCHAR(20) DEFAULT 'transfer'
                          CHECK (type IN ('transfer','deposit','withdrawal')),
    error_message         TEXT,
    raw_transaction       TEXT,                           -- before signing
    signed_transaction    TEXT,                           -- signed RLP hex
    confirmation_blocks   INTEGER DEFAULT 0,
    required_confirmations INTEGER DEFAULT 12,
    metadata              JSONB,
    sender_user_id        UUID REFERENCES users(id),
    receiver_user_id      UUID REFERENCES users(id),
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tx_hash    ON transactions(tx_hash);
CREATE INDEX idx_tx_sender  ON transactions(sender_identity);
CREATE INDEX idx_tx_receiver ON transactions(receiver_identity);
CREATE INDEX idx_tx_status  ON transactions(status);
CREATE INDEX idx_tx_created  ON transactions(created_at DESC);
```

**Index Strategy:**

| Index | Type | Why |
|-------|------|-----|
| `tx_hash` | Unique B-tree | `/txdc transaction <hash>` lookup |
| `sender_identity` | B-tree | `/txdc history <name>` outgoing filter |
| `receiver_identity` | B-tree | `/txdc history <name>` incoming filter |
| `status` | B-tree | Background job scans for pending→confirm |
| `created_at DESC` | B-tree | History queries sorted by time |

**Composite query pattern** (history):
```sql
SELECT * FROM transactions
WHERE sender_identity = 'alice@txdc'
   OR receiver_identity = 'alice@txdc'
ORDER BY created_at DESC
LIMIT 20 OFFSET 0;
```
Covered by individual B-tree indexes on `sender_identity` and `receiver_identity` (BitmapOr scan in PostgreSQL).

**Row Size Estimate:** ~1 KB per row (with signed tx blob). ~8 rows/page.

### Table: `audit_logs`

```sql
CREATE TABLE audit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action          VARCHAR(63) NOT NULL,
    slack_id        VARCHAR(255),
    entity_type     VARCHAR(63),
    entity_id       VARCHAR(255),
    details         JSONB,
    ip_address      VARCHAR(45),
    user_agent      TEXT,
    success         BOOLEAN DEFAULT true,
    error_message   TEXT,
    latency_ms      INTEGER,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_action   ON audit_logs(action);
CREATE INDEX idx_audit_slack_id ON audit_logs(slack_id);
CREATE INDEX idx_audit_created   ON audit_logs(created_at DESC);
```

**Index Strategy:**

| Index | Type | Why |
|-------|------|-----|
| `action` | B-tree | Aggregate analytics ("how many registrations?") |
| `slack_id` | B-tree | Per-user audit trail |
| `created_at DESC` | B-tree | Time-ordered queries, retention cleanup |

**Retention:** Unbounded in MVP. Production should implement:
- Partition by month
- `DELETE` after 90 days or move to cold storage (S3 Glacier)
- `pg_cron` job for automated cleanup

### Triggers

```sql
-- Auto-update updated_at on row modification
CREATE TRIGGER set_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_transactions_updated_at
    BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

```sql
-- Daily limit reset (called by cron every hour)
CREATE OR REPLACE FUNCTION reset_daily_limits()
RETURNS void AS $$
BEGIN
    UPDATE users
    SET daily_volume_used = '0',
        daily_transaction_count = 0,
        daily_limit_reset_at = NOW()
    WHERE daily_limit_reset_at IS NULL
       OR daily_limit_reset_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;
```

### Migration Strategy

```bash
# Generate migration from entity changes
npx typeorm migration:generate src/database/migrations/InitialSchema

# Run pending migrations
npx typeorm migration:run

# Revert last migration
npx typeorm migration:revert
```

For MVP, `synchronize: true` is acceptable in development. Production must use explicit migrations with `synchronize: false`.

---

## Appendix: Key Configuration

| Variable | Purpose | Source |
|----------|---------|--------|
| `SLACK_SIGNING_SECRET` | HMAC key for request verification | Slack App Dashboard |
| `SLACK_BOT_TOKEN` | `xoxb-*` bot token for WebClient | Slack App Dashboard |
| `RPC_URL` | Primary Geth JSON-RPC endpoint | Infrastructure |
| `RPC_FALLBACK_URLS` | Comma-separated failover nodes | Infrastructure |
| `WALLET_ENCRYPTION_KEY` | AES-256 key for private key encryption | Admin secret store |
| `IDENTITY_REGISTRY_ADDRESS` | ENS-style contract address (Phase 2) | Post-deployment |
| `DAILY_TRANSACTION_LIMIT` | Max transactions per user per day | Operational policy |
| `RATE_LIMIT_MAX_REQUESTS` | Max API requests per window | Operational policy |

---

*End of Architecture Document. For deployment instructions, see [README.md](./README.md).*
