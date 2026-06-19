# TXDC Assistant — Complete Guide

> **This guide explains the entire project in plain language.**
> Use it to onboard new team members, understand the architecture, or prepare presentations.

---

## Table of Contents

1. [What Does This System Do?](#1-what-does-this-system-do)
2. [The Big Picture — Architecture Overview](#2-the-big-picture--architecture-overview)
3. [Core Concepts Explained](#3-core-concepts-explained)
   - [Slack as the User Interface](#31-slack-as-the-user-interface)
   - [Identity Names vs Wallet Addresses](#32-identity-names-vs-wallet-addresses)
   - [The Two-Step Transaction Flow](#33-the-two-step-transaction-flow)
   - [How the Blockchain Connection Works](#34-how-the-blockchain-connection-works)
   - [Wallet Key Management](#35-wallet-key-management)
   - [Nonce Management — Why It Matters](#36-nonce-management--why-it-matters)
   - [The On-Chain Name Registry](#37-the-on-chain-name-registry)
4. [Database Design](#4-database-design)
5. [How the Code is Organized](#5-how-the-code-is-organized)
6. [Testing Strategy](#6-testing-strategy)
7. [Security Architecture](#7-security-architecture)
8. [What's Missing — Limitations & Next Steps](#8-whats-missing--limitations--next-steps)

---

## 1. What Does This System Do?

TXDC Assistant is a **Slack bot that lets people send cryptocurrency using simple names** instead of complicated addresses.

### The Problem It Solves

Normally, sending cryptocurrency looks like this:

```
Send 10 ETH to 0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18
```

That address is 42 characters of hexadecimal gibberish. One wrong character and the money is gone forever.

With TXDC Assistant, it becomes:

```
/txdc send alice@txdc bob@txdc 10
```

The system knows that `alice@txdc` maps to one wallet address and `bob@txdc` maps to another, and it handles all the complexity in between.

### Who Is It For?

- **Private blockchain networks** (company-internal chains or consortium networks)
- **Teams using Slack** who want to send payments/tokens to each other
- **Non-technical users** who shouldn't need to understand blockchain addresses

### High-Level Flow

```
User types a Slack command
         │
         ▼
TXDC Backend validates everything
(check identity, check balance, estimate fees)
         │
         ▼
Slack shows Approve/Cancel buttons
         │
         ▼
User clicks Approve
         │
         ▼
Backend signs the transaction and broadcasts to the blockchain
         │
         ▼
Background job waits for confirmation (every 12 seconds)
         │
         ▼
User sees "Transaction confirmed!" in Slack
```

---

## 2. The Big Picture — Architecture Overview

### What Runs Where

```
┌─────────────────────────────────────────────────────────────────┐
│                        Slack Workspace                          │
│  You type: /txdc send alice@txdc bob@txdc 10                    │
│  You see:  Rich buttons, status updates, transaction history     │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                     TXDC Backend (NestJS)                        │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Slack Integration Layer                                     │ │
│  │  • Verifies requests are really from Slack (HMAC signature)  │ │
│  │  • Parses commands, routes to the right handler              │ │
│  │  • Builds pretty Slack messages (Block Kit)                  │ │
│  └──────────────────────────┬──────────────────────────────────┘ │
│                             │                                    │
│  ┌──────────────────────────▼──────────────────────────────────┐ │
│  │  Business Logic Layer                                       │ │
│  │  • Identity Service — register/resolve @txdc names          │ │
│  │  • Wallet Service — check balances, generate wallets        │ │
│  │  • Transaction Service — send, confirm, track transactions  │ │
│  └──────────────────────────┬──────────────────────────────────┘ │
│                             │                                    │
│  ┌──────────────────────────▼──────────────────────────────────┐ │
│  │  Blockchain Layer                                           │ │
│  │  • RPC Client — talks to the blockchain node via JSON-RPC   │ │
│  │  • Supports multiple nodes with automatic failover          │ │
│  │  • Retries failed requests up to 3 times                    │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────┬───────────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
    ┌──────────┐    ┌────────────┐    ┌──────────┐
    │PostgreSQL│    │Geth Node   │    │  Redis   │
    │(identity,│    │(blockchain)│    │(nonces,  │
    │  tx log) │    │            │    │  limits) │
    └──────────┘    └────────────┘    └──────────┘
```

### The Technology Stack

| Technology | What It's Used For |
|------------|-------------------|
| **NestJS** (Node.js framework) | The backend server — organizes code into modules, handles dependency injection |
| **TypeORM** (database ORM) | Talks to PostgreSQL — lets us use TypeScript objects instead of raw SQL |
| **PostgreSQL** | Stores user identities, transaction records, audit logs |
| **Redis** | Tracks transaction nonces, will be used for rate limiting |
| **ethers.js** (library) | Signs transactions, encodes/decodes contract data, manages wallet keys |
| **Geth** (Go Ethereum) | The actual blockchain node — validates and mines transactions |
| **Slack Web API** | Sends messages, updates messages, shows buttons |
| **ioredis** | Redis client library |

### Module Dependency Map

```
AppModule (root — wires everything together)
├── SecretsModule          [global] — safe access to private keys
├── NonceModule            [global] — tracks transaction nonces
├── BlockchainModule       [global] — talks to the blockchain
├── IdentityModule                — manages @txdc identities
├── WalletModule                  — manages wallets and keys
├── TransactionModule             — sends and tracks transactions
│   └── depends on: IdentityModule, WalletModule
└── SlackModule                   — handles Slack commands
    └── depends on: IdentityModule, WalletModule, TransactionModule
```

**"Global" modules** are available everywhere without needing to import them explicitly. Think of them as utilities that many parts of the app need.

---

## 3. Core Concepts Explained

### 3.1 Slack as the User Interface

Instead of building a website or mobile app, this system uses **Slack messages as the UI**.

#### Slash Commands

Users type `/txdc <command>` in any Slack channel. The Slack app sends this to our backend as an HTTP request.

**Every command goes through:**
1. **SlackSignatureGuard** — Verifies the request actually came from Slack (uses HMAC-SHA256 signing)
2. **ThrottlerGuard** — Rate limits (max 10 commands per 60 seconds per user)
3. **Command Router** — Parses the subcommand (`register`, `send`, etc.) and calls the right handler

#### Block Kit — Building Messages Like LEGO

Slack's **Block Kit** is like LEGO for messages. You can build rich messages with text sections, buttons, tables, and dividers. The `SlackService` class has methods like `buildTransactionConfirmBlocks()` that assemble these blocks. Each method returns an array of block objects that Slack renders into the user's chat.

#### Interactive Message Flow

When a user clicks "Approve" on a transaction:
1. Slack sends a POST to `/api/v1/slack/interactions`
2. The controller finds the transaction ID from the button's `action_id` (e.g., `tx_approve_a1b2c3`)
3. It calls `TransactionService.confirm()` with the transaction ID
4. The original Slack message is **updated in-place** to show the result — the user never leaves Slack

### 3.2 Identity Names vs Wallet Addresses

#### The Core Mapping

| Slack User | @txdc Name | Wallet Address |
|-----------|-----------|----------------|
| `U_ALICE` | `alice@txdc` | `0x1234...7890` |
| `U_BOB` | `bob@txdc` | `0xabcd...ef01` |

When Alice sends to `bob@txdc`, the system looks up Bob's wallet address and sends the money there.

#### Two Layers of Storage

**Primary: PostgreSQL database** — fast, always available, supports complex queries.

**Fallback: IdentityRegistry smart contract (on the blockchain)** — used when a name isn't in the database. Makes identity portable even if the database is wiped.

The resolution order is: **Check database first → If not found, check the blockchain**.

#### Name Rules

Names must follow: `[a-z0-9][a-z0-9-_.]{2,31}@txdc`

Plain English:
- Start with a letter or number
- Only lowercase letters, numbers, hyphens, underscores, dots
- 3 to 32 characters before the `@txdc`
- Must end with `@txdc`

### 3.3 The Two-Step Transaction Flow

Sending money is intentionally a **two-step process** to prevent accidents.

#### Step 1: Initiate

The user runs `/txdc send alice@txdc bob@txdc 10`. The system does a **soft check**:
- Are both users registered?
- Does Alice own the name `alice@txdc`?
- Does Alice have enough balance (amount + gas fees)?

If everything looks good, a transaction record is created with status `pending_confirmation` and the user sees Approve/Cancel buttons.

**No money has moved yet.** Nothing has been signed.

#### Step 2: Confirm

The user clicks **Approve**. Now the system does the real work:
1. **Decrypts Alice's private key** from the database
2. **Gets the next available nonce** (prevents replay attacks)
3. **Builds and signs the transaction** (creates a cryptographically signed message)
4. **Broadcasts it to the blockchain** via `eth_sendRawTransaction`
5. **Updates the record** to status `pending`

If the user clicks **Cancel**, the transaction is marked `rejected` — done.

#### After Confirmation — Background Polling

A **cron job** runs every 12 seconds and checks all pending transactions:
- Confirmed by blockchain? → increment confirmation count
- After 12 confirmations? → mark as `confirmed` ✓
- Failed on-chain? → mark as `failed` ✗
- Pending >10 minutes? → mark as `failed` (dropped from network)

### 3.4 How the Blockchain Connection Works

The system connects to a **private Geth blockchain** (Ethereum-compatible).

#### Two Layers

**Layer 1: RpcClient** — speaks raw JSON-RPC to the blockchain node. Supports multiple nodes with automatic failover. Retries failed requests up to 3 times with backoff.

**Layer 2: BlockchainService** — formats results (converts Wei to Ether), combines multiple RPC calls into single operations, understands ERC-20 tokens.

#### Retry Logic (Simplified)

```
Try node 1 → if fails, try node 2 → if fails, try node 3
If all fail, wait 1 second, try again
If all fail again, wait 2 seconds, try again
If all fail a third time → throw error
```

This handles temporary outages and network blips.

### 3.5 Wallet Key Management

#### Key Generation

Every user gets a cryptographic wallet when they register. Keys are generated using the operating system's secure random number generator — the same one used by SSH and TLS. These keys are **truly random and practically impossible to guess**.

#### Key Storage

1. User registers → wallet is generated
2. Private key is encrypted with AES-256 using the `WALLET_ENCRYPTION_KEY`
3. The encrypted key is stored in the `users` table

**In development mode**, if no `WALLET_ENCRYPTION_KEY` is set, keys are stored in plaintext. A warning is logged at startup.

#### Key Decryption for Signing

When signing a transaction:
1. Read encrypted key from database
2. Decrypt in memory (only during signing, not before or after)
3. Create temporary `ethers.Wallet`, sign the transaction
4. The wallet and decrypted key are garbage collected by Node.js

### 3.6 Nonce Management — Why It Matters

#### What Is a Nonce?

Every Ethereum transaction has a **nonce** — a counter starting at 0 for each wallet, incrementing by 1 per transaction. If Alice sent 5 transactions, the next nonce is 5.

#### Why Track It?

Without tracking, two simultaneous transactions could use the same nonce. The blockchain accepts the first and rejects the second.

With the NonceManager:
1. Transaction A asks for a nonce → gets 5, stores "next is 6"
2. Transaction B asks for a nonce → gets 6, stores "next is 7"
3. Both succeed with different nonces

#### How It Works

```
nextNonce(address) {
  onChainNonce = check blockchain for current count
  storedNonce = check Redis for what we've used
  baseNonce = max(onChainNonce, storedNonce)  // safest option
  store "next = baseNonce + 1" in Redis
  return baseNonce
}
```

**If Redis is down**, the system falls back to an in-memory map. This works for a single instance but resets on restart.

### 3.7 The On-Chain Name Registry

`IdentityRegistry.sol` is a smart contract deployed on the private blockchain — a **mini ENS (Ethereum Name Service)**.

#### Why On-Chain Names?

- **Decentralization**: Anyone can resolve names without asking the database
- **Persistence**: Names survive database wipes
- **Composability**: Other smart contracts can use the registry

#### How the Contract Works

The contract maintains two lookups:
- Name → Address (forward resolution): "alice" → `0x1234...`
- Address → Name (reverse resolution): `0x1234...` → "alice"

Names are stored as hashes (`keccak256`) for gas efficiency.

#### Registrar Pattern

A privileged account (the "registrar") can register names without paying fees. This is important because:
- The backend already authenticates users via Slack OAuth
- Users shouldn't pay blockchain gas fees for registration
- The registrar key is controlled by the backend

The public can also register names by paying 0.01 ETH (self-service).

---

## 4. Database Design

### The Three Tables

#### `users` — Who's who

| Column | What It Means |
|--------|---------------|
| `id` (UUID) | Internal identifier |
| `slack_id` | Slack's identifier for this user |
| `txdc_name` | Their @txdc name (alice@txdc) |
| `wallet_address` | Their blockchain address |
| `encrypted_private_key` | Their wallet key, encrypted |
| `role` | user, admin, or whitelisted |
| `registration_status` | active, suspended, or revoked |

#### `transactions` — Money movements

| Column | What It Means |
|--------|---------------|
| `id` (UUID) | Internal identifier |
| `tx_hash` | Blockchain transaction hash (once broadcast) |
| `sender_identity` | Who sent it (alice@txdc) |
| `receiver_identity` | Who received it (bob@txdc) |
| `amount` | How much was sent |
| `status` | pending → pending_confirmation → confirmed/failed |

#### `audit_logs` — Who did what when

Every action (register, send, approve, fail) is logged with: what happened, who did it, timestamp, and whether it succeeded.

### How Tables Connect

- A user can be the **sender** of many transactions
- A user can be the **receiver** of many transactions
- Audit logs reference users by `slack_id` (no formal foreign key)

### Enums (Dropdown Values)

- **TransactionStatus**: pending, pending_confirmation, confirmed, failed, rejected
- **TransactionType**: transfer, deposit, withdrawal
- **UserRole**: user, admin, whitelisted
- **RegistrationStatus**: pending, active, suspended, revoked

### Migrations

Database changes are version-controlled through migration files. Currently there's one migration (`InitialSchema`) that creates all tables with correct columns, indexes, and foreign keys. This ensures every developer has the same database structure.

---

## 5. How the Code is Organized

```
src/
├── main.ts                         # Server entry point
├── app.module.ts                   # Master module — wires everything
│
├── config/                         # Environment configuration
├── modules/                        # Business logic
│   ├── slack/                      # Slack integration
│   ├── identity/                   # @txdc name management
│   ├── wallet/                     # Wallet keys and balances
│   ├── transaction/                # Send, confirm, track
│   └── blockchain/                 # Blockchain connectivity
├── shared/                         # Reusable services
│   ├── secrets/                    # Private key access
│   └── nonce/                      # Transaction nonce tracking
├── database/                       # Database setup and entities
├── common/                         # Guards, filters, interceptors
└── monitoring/                     # Health checks, logging

contracts/                          # Smart contract
scripts/                            # Dev utilities (seed, deploy)
tests/                              # Unit, integration, e2e tests
```

### How Dependency Injection Works

NestJS's **dependency injection** means services don't create their own dependencies — they declare what they need, and NestJS provides it automatically.

Example:
```typescript
class TransactionService {
  constructor(
    private identityService: IdentityService,  // NestJS provides this
    private walletManager: WalletManager,      // and this
    private nonceManager: NonceManager,        // and this
  ) {}
}
```

When the app starts, NestJS:
1. Creates one instance of each service (singleton pattern)
2. Reads the constructor parameters
3. Provides the matching instance from its registry
4. If a dependency is missing → throws a clear error telling you which module is missing

---

## 6. Testing Strategy

### Three Levels of Tests

**Unit Tests** — Test one service in complete isolation. All external dependencies are mocked (replaced with fake versions). Fast to run, easy to debug.
- 4 test files covering IdentityService, IdentityResolver, BlockchainService, TransactionService
- 75 total tests

**Integration Tests** — Test how parts work together (but without external services).
- RPC client with mocked HTTP layer
- Slack signature verification
- Database CRUD with SQLite in-memory

**E2E Tests** — Test the full application via HTTP using supertest.
- Spins up the complete NestJS app
- Tests all endpoints: health, register, wallet, balance, send, history

### Mock Pattern

The tests use a manual mock pattern:
```typescript
let userRepo: Record<string, jest.Mock>;
// ...
{ provide: getRepositoryToken(User), useValue: userRepo }
```

Each method (`findOne`, `save`, etc.) is a `jest.fn()` that can be configured per test. This gives full control over what each mock returns.

---

## 7. Security Architecture

### Slack Signature Verification

Every request from Slack is signed with HMAC-SHA256. The backend:
1. Reads the signature and timestamp from headers
2. Rejects if timestamp is more than 5 minutes old (prevents replay attacks)
3. Computes the expected signature using the Slack signing secret
4. Uses **timing-safe comparison** (prevents timing side-channel attacks)

### Wallet Encryption

Private keys are stored encrypted using AES-256:
- In production: uses `WALLET_ENCRYPTION_KEY` from environment
- In development: if no key is set, stores plaintext (with a logged warning)

### Registrar Key

The smart contract registrar key is:
- Loaded from environment variable
- Accessed through `SecretsService` (abstraction layer for future Vault/KMS integration)
- Powerful — can register/transfer/revoke any name

### Rate Limiting

Two layers:
1. **NestJS ThrottlerGuard** — global rate limiting (30 req/min) + per-endpoint limits (10 commands/min)
2. **Daily limits** — per-user volume and transaction count tracked in the database

### Transaction Security

The two-step flow (initiate → confirm) prevents:
- **Accidental sends** — must explicitly approve
- **Replay attacks** — status check ensures one-time use
- **Unauthorized signing** — verifies the approving user is the sender

---

## 8. What's Missing — Limitations & Next Steps

### Known Issues (What to Fix Before Production)

1. **Nonce atomicity** — The Redis nonce increment uses get-then-set, not atomic INCR. In multi-instance deployments, two instances could get the same nonce.

2. **Plaintext keys in dev mode** — With `WALLET_ENCRYPTION_KEY` empty, private keys are stored unencrypted.

3. **Health checks are superficial** — The health endpoint returns "healthy" even if the database or blockchain is unreachable.

4. **Audit log unbounded growth** — No cleanup policy. Production needs log rotation/archival.

5. **No circuit breaker** — RPC client retries indefinitely but doesn't stop trying a dead node ("failing fast").

6. **CryptoJS uses CBC mode** — The primary encryption (`CryptoJS.AES`) uses CBC mode (no authentication). There's a second implementation (`CryptoService`) using GCM mode (authenticated) but it's never used.

### Architecture Improvements

- **Replace CryptoJS with Node.js crypto** — AES-256-GCM with proper IV + auth tag
- **Atomic nonce increment** — Use `Redis.INCR` instead of get-then-set
- **Add meaningful health checks** — Test DB and RPC connectivity
- **Circuit breaker for RPC** — Stop calling a node that keeps failing
- **Remove dead code** — `CryptoService` and `RateLimiter` are defined but never used
- **Add request IDs** — For tracing a single request across all logs
- **Implement daily limit reset** — The database has the fields but no cron job resets them

### Single Points of Failure

1. **Registrar key** — One key controls all on-chain name registrations
2. **Encryption key** — One key decrypts all wallet private keys
3. **Single Geth node** — No redundancy in the development setup
4. **Redis nonce persistence** — In-memory fallback resets on restart
