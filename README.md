# TXDC Assistant — Production-Grade Slack Blockchain Payment Bot

> Human-readable blockchain payments (like UPI) directly from Slack.
> `alice@txdc` → `bob@txdc` — without ever seeing a hex address.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                         Slack Workspace                          │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────┐   │
│  │ Slash Command │  │ Block Kit UI │  │ Interactive Messages │   │
│  │  /txdc send  │  │  Rich Cards  │  │  Approve / Cancel    │   │
│  └──────┬──────┘  └──────┬───────┘  └──────────┬────────────┘   │
└─────────┼────────────────┼──────────────────────┼────────────────┘
          │                │                      │
          ▼                ▼                      ▼
┌──────────────────────────────────────────────────────────────────┐
│                     TXDC Backend API (NestJS)                     │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                    API Gateway Layer                        │  │
│  │  ┌──────────┐  ┌──────────┐  ┌────────┐  ┌─────────────┐  │  │
│  │  │ Signature │  │  Rate     │  │  Auth  │  │  Request    │  │  │
│  │  │ Verify    │  │  Limiter  │  │  Guard │  │  Validation │  │  │
│  │  └──────────┘  └──────────┘  └────────┘  └─────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                    Service Layer                            │  │
│  │  ┌──────────┐  ┌──────────┐  ┌────────────┐  ┌─────────┐  │  │
│  │  │ Identity │  │  Wallet  │  │ Transaction│  │ Slack   │  │  │
│  │  │ Service  │  │  Service │  │  Service   │  │ Service │  │  │
│  │  └────┬─────┘  └────┬─────┘  └─────┬──────┘  └────┬────┘  │  │
│  └───────┼─────────────┼──────────────┼───────────────┼───────┘  │
│          │             │              │               │          │
│  ┌───────┼─────────────┼──────────────┼───────────────┼───────┐  │
│  │       ▼             ▼              ▼               ▼       │  │
│  │                  Blockchain Layer (RPC Client)              │  │
│  │  ┌──────────────────────────────────────────────────────┐  │  │
│  │  │  RpcClient — Multi-node, failover, retry logic      │  │  │
│  │  │  eth_getBalance │ eth_sendRawTransaction │ etc.      │  │  │
│  │  └──────────────────────┬───────────────────────────────┘  │  │
│  └─────────────────────────┼──────────────────────────────────┘  │
└────────────────────────────┼─────────────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
┌─────────────────┐ ┌──────────────┐ ┌──────────────┐
│   PostgreSQL    │ │  Blockchain  │ │    Redis     │
│  (Identity DB)  │ │  (Geth RPC)  │ │  (Cache/Q)   │
│                 │ │              │ │              │
│  users          │ │  Node 1      │ │  Rate Limits  │
│  transactions   │ │  Node 2      │ │  Sessions    │
│  audit_logs     │ │  Node 3      │ │  Job Queue   │
└─────────────────┘ └──────────────┘ └──────────────┘
```

---

## Folder Structure

```
txdc-assistant/
├── src/
│   ├── main.ts                          # Entry point
│   ├── app.module.ts                    # Root module
│   ├── config/
│   │   ├── configuration.ts             # Centralized env config
│   │   └── swagger.config.ts            # API docs setup
│   ├── common/
│   │   ├── guards/
│   │   │   └── slack-signature.guard.ts # Slack request verification
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts # Global error handling
│   │   └── interceptors/
│   │       └── transform.interceptor.ts # Standardized response shape
│   ├── modules/
│   │   ├── slack/
│   │   │   ├── slack.module.ts
│   │   │   ├── slack.controller.ts      # Slack HTTP endpoints
│   │   │   ├── slack.service.ts          # Block Kit builder + Slack API
│   │   │   └── slack.commands.ts         # Command routing engine
│   │   ├── identity/
│   │   │   ├── identity.module.ts
│   │   │   ├── identity.service.ts       # CRUD for @txdc identities
│   │   │   └── identity.resolver.ts      # On-chain ENS resolver
│   │   ├── wallet/
│   │   │   ├── wallet.module.ts
│   │   │   ├── wallet.service.ts         # Balance + wallet info
│   │   │   └── wallet.manager.ts         # Key generation + encryption
│   │   ├── transaction/
│   │   │   ├── transaction.module.ts
│   │   │   └── transaction.service.ts    # Send, confirm, history
│   │   └── blockchain/
│   │       ├── blockchain.module.ts
│   │       ├── blockchain.service.ts     # High-level blockchain ops
│   │       └── rpc-client.ts            # Geth JSON-RPC with failover
│   ├── database/
│   │   ├── database.module.ts
│   │   └── entities/
│   │       ├── user.entity.ts
│   │       ├── transaction-record.entity.ts
│   │       └── audit-log.entity.ts
│   ├── security/
│   │   ├── crypto.service.ts            # AES-256-GCM encryption
│   │   └── rate-limiter.ts              # In-memory rate limiter
│   └── monitoring/
│       ├── monitoring.module.ts
│       ├── health.controller.ts         # Health check endpoints
│       └── logger.ts                    # Structured Winston logger
├── contracts/
│   └── IdentityRegistry.sol             # ENS-style on-chain registry
├── tests/
│   ├── unit/
│   │   ├── identity.service.spec.ts
│   │   └── blockchain.service.spec.ts
│   ├── integration/
│   └── e2e/
│       └── transaction-flow.spec.ts
├── scripts/
│   ├── init-db.sql                      # PostgreSQL schema
│   └── geth-init.sh                     # Geth dev node setup
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Database Schema

### `users`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | Unique identifier |
| slack_id | VARCHAR(255) UNIQUE | Slack user ID |
| txdc_name | VARCHAR(63) UNIQUE | `alice@txdc` identity |
| wallet_address | VARCHAR(42) UNIQUE | Ethereum address |
| encrypted_private_key | TEXT | AES-256-GCM encrypted |
| role | ENUM | user / admin / whitelisted |
| registration_status | ENUM | pending / active / suspended / revoked |
| daily_volume_used | DECIMAL(36,18) | 24h volume tracker |
| daily_transaction_count | INT | 24h tx counter |
| metadata | JSONB | Extensible data |
| created_at / updated_at | TIMESTAMPTZ | Timestamps |

### `transactions`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | Internal identifier |
| tx_hash | VARCHAR(66) UNIQUE | Blockchain transaction hash |
| sender_identity / receiver_identity | VARCHAR(63) | Resolved @txdc names |
| sender_address / receiver_address | VARCHAR(42) | Blockchain addresses |
| amount | DECIMAL(36,18) | Transaction value |
| gas_limit / gas_price / gas_used | Various | Gas tracking |
| block_number | BIGINT | Block where mined |
| status | ENUM | pending / pending_confirmation / confirmed / failed / rejected |
| type | ENUM | transfer / deposit / withdrawal |
| error_message | TEXT | Failure reason |
| sender_user_id / receiver_user_id | UUID FK → users | Relationship |

### `audit_logs`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | Unique identifier |
| action | VARCHAR(63) | Audit action type |
| slack_id | VARCHAR(255) | User who performed action |
| entity_type / entity_id | Various | Related entity |
| details | JSONB | Full action details |
| success | BOOLEAN | Whether action succeeded |
| error_message | TEXT | Error details if failed |
| latency_ms | INT | Request duration |

---

## API Design

### REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/slack/commands` | Slash command handler |
| POST | `/api/v1/slack/interactions` | Interactive message handler |
| POST | `/api/v1/slack/events` | Slack Events API handler |
| POST | `/api/v1/slack/oauth/callback` | OAuth 2.0 callback |
| GET | `/api/v1/health` | Health check |
| GET | `/api/v1/health/readiness` | Readiness probe |
| GET | `/api/v1/health/liveness` | Liveness probe |

### Slack Command Specification

| Command | Syntax | Description |
|---------|--------|-------------|
| register | `/txdc register <name>@txdc` | Register blockchain identity |
| wallet | `/txdc wallet` | Show wallet + balance |
| balance | `/txdc balance <name>@txdc` | Check identity balance |
| send | `/txdc send <from> <to> <amount>` | Initiate transaction |
| transaction | `/txdc transaction <hash>` | Track transaction by hash |
| history | `/txdc history <name>@txdc` | View transaction history |
| help | `/txdc help` | Show help |

---

## Security Architecture

### Authentication

- **Slack Signature Verification**: Every request validated via HMAC-SHA256 signing secret
- **Role-Based Access**: User / Admin / Whitelisted roles with different limits
- **OAuth 2.0**: Slack OAuth flow for workspace installation

### Wallet Security (Layered Approach)

```
User Private Key
       │
       ▼
┌───────────────────┐
│  Wallet Manager   │  ← Generates key with ethers.Wallet.createRandom()
│  encryptPrivateKey│
└───────┬───────────┘
        │ AES-256-GCM
        ▼
┌───────────────────┐
│  CryptoService    │  ← AES-256-GCM encryption with random IV + auth tag
│  (node:crypto)    │
└───────┬───────────┘
        │
        ▼
┌───────────────────┐
│   PostgreSQL      │  ← Encrypted at rest (column-level)
│   encrypted_key   │
└───────────────────┘

Production Hardening:
├── AWS KMS / HashiCorp Vault for key management
├── HSM for transaction signing
├── Key never touches application memory unencrypted
└── All decryption occurs in isolated signing worker
```

### Transaction Security

1. **Initiation**: User sends command → system validates balance, gas estimates
2. **Confirmation**: Slack Block Kit buttons → user must explicitly Approve/Cancel
3. **Signing**: Private key decrypted only at signing moment, never stored in memory
4. **Broadcast**: Raw signed transaction sent to Geth, broadcast to network
5. **Tracking**: Background job monitors pending transactions until confirmed

### Abuse Prevention

- **Rate Limiting**: NestJS ThrottlerGuard per endpoint
- **Daily Transaction Limits**: Per-user volume and count limits
- **Input Validation**: class-validator DTOs, regex for @txdc format
- **Fraud Detection Hooks**: Extensible; logs all suspicious patterns
- **Audit Logging**: Every command, transaction, and auth attempt logged

---

## Smart Contract: ENS-style Identity Registry (`contracts/IdentityRegistry.sol`)

Designed for Phase 2 deployment after database-backed Phase 1 is stable.

```
contract IdentityRegistry {
    mapping(bytes32 => address) private _owners;     // nameHash → owner
    mapping(address => bytes32) private _reverseRegistry;  // address → nameHash

    function register(string calldata name) external payable;
    function transfer(string calldata name, address newOwner) external;
    function revoke(string calldata name) external;
    function resolve(string calldata name) external view returns (address);
    function isRegistered(string calldata name) external view returns (bool);
}
```

Gas-optimized with `bytes32` name hashes. Includes registration fees (configurable), owner-only revocation for abuse cases, and full event emission for off-chain indexing.

---

## Development Roadmap

### MVP (Week 1-2)

| Feature | Status |
|---------|--------|
| Database-backed identity registry (PostgreSQL) | ✅ Implemented |
| `/txdc register` command | ✅ Implemented |
| `/txdc wallet` command | ✅ Implemented |
| `/txdc balance` command | ✅ Implemented |
| `/txdc send` — initiate transaction | ✅ Implemented |
| `[Approve] [Cancel]` confirmation flow | ✅ Implemented |
| Transaction signing + broadcast | ✅ Implemented |
| `/txdc transaction <hash>` tracking | ✅ Implemented |
| `/txdc history` command | ✅ Implemented |
| Slack signature verification | ✅ Implemented |
| Docker Compose (app + postgres + redis + geth) | ✅ Implemented |

### Production (Week 3-4)

- ✅ Smart contract design (IdentityRegistry.sol)
- ✅ Full test suite (unit, integration, e2e)
- ✅ Structured logging (Winston)
- ✅ Health check endpoints
- ✅ Rate limiting per user
- ✅ Daily transaction limits

### Post-MVP (Week 5+)

- On-chain identity resolution (ENS-style)
- WebSocket subscriptions for real-time balance updates
- Admin dashboard (React + Slack modals)
- Multi-token support (ERC-20, ERC-721)
- Scheduled transaction support
- Batch transactions
- Hardware Security Module (HSM) integration
- Kubernetes deployment manifests
- CI/CD pipeline (GitHub Actions)
- Sentry error tracking
- Prometheus + Grafana dashboards

---

## MVP vs Production Feature Breakdown

| Feature | MVP | Production |
|---------|-----|------------|
| Identity storage | PostgreSQL | PostgreSQL + ENS on-chain |
| Wallet generation | ethers.Wallet | HSM / KMS integration |
| Key encryption | AES-256-GCM | AWS KMS / Vault transit |
| RPC failover | Simple retry | Circuit breaker + health-based routing |
| Monitoring | Console logs | Prometheus + Grafana + Sentry |
| Rate limiting | In-memory | Redis-based distributed |
| Deployment | Docker Compose | Kubernetes (EKS/GKE) |
| CI/CD | Manual | GitHub Actions + ArgoCD |
| Auth | Slack signature | OAuth2 + JWT + RBAC |
| Notifications | Ephemeral messages | Real-time via WebSocket |

---

## Deployment Strategy

### Development

```bash
# Clone and configure
cp .env.example .env
# Edit .env with your Slack credentials and RPC endpoint

# Start all services
docker-compose up -d

# Run migrations
docker-compose exec app npx typeorm migration:run
```

### Production (Cloud)

```
┌──────────────────────────────────────────────────────┐
│                Load Balancer (ALB/NLB)               │
└────────────────────────┬─────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
    ┌─────────┐    ┌─────────┐    ┌─────────┐
    │ App v1  │    │ App v2  │    │ App v3  │
    │ (ECS)   │    │ (ECS)   │    │ (ECS)   │
    └────┬────┘    └────┬────┘    └────┬────┘
         │              │              │
         └──────────────┼──────────────┘
                        │
         ┌──────────────┼──────────────┐
         ▼              ▼              ▼
    ┌─────────┐    ┌─────────┐    ┌──────────┐
    │ RDS     │    │ Elasti  │    │ Geth     │
    │ (PG)    │    │ Cache   │    │ (Multi-  │
    │         │    │ (Redis) │    │  Node)   │
    └─────────┘    └─────────┘    └──────────┘
```

**Infrastructure as Code**: Terraform for VPC, subnets, ECS/EKS, RDS, ElastiCache.

---

## Development Setup

```bash
# Prerequisites: Node.js 20+, Docker, pnpm/npm

# Install dependencies
npm install

# Start infrastructure (PostgreSQL + Redis + Geth)
docker-compose up -d postgres redis geth-node

# Run in dev mode with hot reload
npm run start:dev

# Run tests
npm test
npm run test:cov
```
