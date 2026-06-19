-- TXDC Assistant Database Initialization
-- PostgreSQL schema for production deployment

BEGIN;

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slack_id VARCHAR(255) UNIQUE NOT NULL,
    slack_team_id VARCHAR(255),
    txdc_name VARCHAR(63) UNIQUE NOT NULL,
    wallet_address VARCHAR(42) UNIQUE NOT NULL,
    encrypted_private_key TEXT,
    role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin', 'whitelisted')),
    registration_status VARCHAR(20) DEFAULT 'active' CHECK (registration_status IN ('pending', 'active', 'suspended', 'revoked')),
    daily_volume_used DECIMAL(36, 18) DEFAULT '0',
    daily_transaction_count INTEGER DEFAULT 0,
    last_transaction_at TIMESTAMPTZ,
    daily_limit_reset_at TIMESTAMPTZ,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_slack_id ON users(slack_id);
CREATE INDEX idx_users_txdc_name ON users(txdc_name);
CREATE INDEX idx_users_wallet_address ON users(wallet_address);
CREATE INDEX idx_users_status ON users(registration_status);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tx_hash VARCHAR(66) UNIQUE,
    sender_identity VARCHAR(63) NOT NULL,
    receiver_identity VARCHAR(63) NOT NULL,
    sender_address VARCHAR(42) NOT NULL,
    receiver_address VARCHAR(42) NOT NULL,
    amount DECIMAL(36, 18) NOT NULL,
    gas_limit BIGINT,
    gas_price VARCHAR(66),
    gas_used BIGINT,
    nonce INTEGER,
    block_number BIGINT,
    block_timestamp BIGINT,
    status VARCHAR(30) DEFAULT 'pending_confirmation' CHECK (status IN ('pending', 'pending_confirmation', 'confirmed', 'failed', 'rejected')),
    type VARCHAR(20) DEFAULT 'transfer' CHECK (type IN ('transfer', 'deposit', 'withdrawal')),
    error_message TEXT,
    raw_transaction TEXT,
    signed_transaction TEXT,
    confirmation_blocks INTEGER DEFAULT 0,
    required_confirmations INTEGER DEFAULT 12,
    metadata JSONB,
    sender_user_id UUID REFERENCES users(id),
    receiver_user_id UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_transactions_tx_hash ON transactions(tx_hash);
CREATE INDEX idx_transactions_sender ON transactions(sender_identity);
CREATE INDEX idx_transactions_receiver ON transactions(receiver_identity);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_created ON transactions(created_at DESC);

-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action VARCHAR(63) NOT NULL,
    slack_id VARCHAR(255),
    entity_type VARCHAR(63),
    entity_id VARCHAR(255),
    details JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    success BOOLEAN DEFAULT true,
    error_message TEXT,
    latency_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_action ON audit_logs(action);
CREATE INDEX idx_audit_slack_id ON audit_logs(slack_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);

-- Daily limits reset function
CREATE OR REPLACE FUNCTION reset_daily_limits()
RETURNS void AS $$
BEGIN
    UPDATE users
    SET
        daily_volume_used = '0',
        daily_transaction_count = 0,
        daily_limit_reset_at = NOW()
    WHERE
        daily_limit_reset_at IS NULL
        OR daily_limit_reset_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_transactions_updated_at
    BEFORE UPDATE ON transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMIT;
