export default () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',

  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'txdc',
    password: process.env.DB_PASSWORD || 'txdc_secret',
    database: process.env.DB_DATABASE || 'txdc_assistant',
  },

  slack: {
    signingSecret: process.env.SLACK_SIGNING_SECRET || '',
    botToken: process.env.SLACK_BOT_TOKEN || '',
    appToken: process.env.SLACK_APP_TOKEN || '',
    clientId: process.env.SLACK_CLIENT_ID || '',
    clientSecret: process.env.SLACK_CLIENT_SECRET || '',
    oauthRedirectUri: process.env.SLACK_OAUTH_REDIRECT_URI || '',
  },

  rpc: {
    url: process.env.RPC_URL || 'http://localhost:8545',
    wsUrl: process.env.RPC_WS_URL || 'ws://localhost:8546',
    chainId: parseInt(process.env.RPC_CHAIN_ID || '8888', 10),
    timeoutMs: parseInt(process.env.RPC_TIMEOUT_MS || '30000', 10),
    retryCount: parseInt(process.env.RPC_RETRY_COUNT || '3', 10),
    retryDelayMs: parseInt(process.env.RPC_RETRY_DELAY_MS || '1000', 10),
    fallbackUrls: (process.env.RPC_FALLBACK_URLS || '').split(',').filter(Boolean),
  },

  wallet: {
    encryptionKey: process.env.WALLET_ENCRYPTION_KEY || '',
  },

  token: {
    address: process.env.TOKEN_ADDRESS || '',
    decimals: parseInt(process.env.TOKEN_DECIMALS || '18', 10),
    symbol: process.env.TOKEN_SYMBOL || 'TXDC',
    nativeCurrency: process.env.NATIVE_CURRENCY || 'TXDC',
  },

  identityRegistry: {
    address: process.env.IDENTITY_REGISTRY_ADDRESS || '',
    deployedBlock: parseInt(process.env.IDENTITY_REGISTRY_DEPLOYED_BLOCK || '0', 10),
    registrarPrivateKey: process.env.IDENTITY_REGISTRY_REGISTRAR_KEY || '',
  },

  rateLimit: {
    ttlMs: parseInt(process.env.RATE_LIMIT_TTL_MS || '60000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '30', 10),
    dailyTransactionLimit: parseInt(process.env.DAILY_TRANSACTION_LIMIT || '100', 10),
    dailyVolumeLimitEth: parseInt(process.env.DAILY_VOLUME_LIMIT_ETH || '1000', 10),
  },

  observability: {
    logLevel: process.env.LOG_LEVEL || 'info',
    logFormat: process.env.LOG_FORMAT || 'json',
    enableMetrics: process.env.ENABLE_METRICS === 'true',
    metricsPort: parseInt(process.env.METRICS_PORT || '9090', 10),
    sentryDsn: process.env.SENTRY_DSN || '',
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
});
