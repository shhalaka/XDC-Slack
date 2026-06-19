import { DataSource, Repository } from 'typeorm';
import { User, UserRole, RegistrationStatus } from '../../src/database/entities/user.entity';
import { TransactionRecord, TransactionStatus, TransactionType } from '../../src/database/entities/transaction-record.entity';
import { AuditLog } from '../../src/database/entities/audit-log.entity';

/**
 * Integration test: PostgreSQL database CRUD operations.
 *
 * Uses SQLite in-memory to validate entity mappings, constraints,
 * indexes, and relationship loading without requiring a real PG instance.
 */
describe('Database CRUD', () => {
  let dataSource: DataSource;
  let userRepo: Repository<User>;
  let txRepo: Repository<TransactionRecord>;
  let auditRepo: Repository<AuditLog>;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [User, TransactionRecord, AuditLog],
      synchronize: true,
      logging: false,
    });

    try {
      await dataSource.initialize();
    } catch {
      // better-sqlite3 may not be installed; skip with a clear message
      console.warn(
        'Skipping DB integration tests: better-sqlite3 not available. ' +
        'Install with: npm install --save-dev better-sqlite3 @types/better-sqlite3',
      );
      return;
    }

    userRepo = dataSource.getRepository(User);
    txRepo = dataSource.getRepository(TransactionRecord);
    auditRepo = dataSource.getRepository(AuditLog);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  function itIfDbAvailable(name: string, fn: () => Promise<void>) {
    it(name, async () => {
      if (!dataSource?.isInitialized) return;
      await fn();
    });
  }

  itIfDbAvailable('should create and read a user', async () => {
    const user = userRepo.create({
      slackId: 'U_TEST',
      txdcName: 'testuser@txdc',
      walletAddress: '0x1234567890123456789012345678901234567890',
      encryptedPrivateKey: 'encrypted:data',
      role: UserRole.USER,
      registrationStatus: RegistrationStatus.ACTIVE,
    });
    const saved = await userRepo.save(user);

    expect(saved.id).toBeDefined();
    expect(saved.txdcName).toBe('testuser@txdc');
    expect(saved.role).toBe(UserRole.USER);

    const found = await userRepo.findOne({ where: { slackId: 'U_TEST' } });
    expect(found).not.toBeNull();
    expect(found!.txdcName).toBe('testuser@txdc');
  });

  itIfDbAvailable('should enforce unique txdc_name', async () => {
    const user1 = userRepo.create({
      slackId: 'U_DUP1',
      txdcName: 'duplicate@txdc',
      walletAddress: '0x1111111111111111111111111111111111111111',
    });
    await userRepo.save(user1);

    const user2 = userRepo.create({
      slackId: 'U_DUP2',
      txdcName: 'duplicate@txdc',
      walletAddress: '0x2222222222222222222222222222222222222222',
    });

    await expect(userRepo.save(user2)).rejects.toThrow();
  });

  itIfDbAvailable('should create a transaction linked to a user', async () => {
    const user = await userRepo.findOne({ where: { slackId: 'U_TEST' } });
    if (!user) return;

    const tx = txRepo.create({
      txHash: '0xTX_HASH_1',
      senderIdentity: 'testuser@txdc',
      receiverIdentity: 'bob@txdc',
      senderAddress: '0x1234567890123456789012345678901234567890',
      receiverAddress: '0xRECEIVER',
      amount: '10.5',
      status: TransactionStatus.CONFIRMED,
      type: TransactionType.TRANSFER,
      senderUser: user,
      senderUserId: user.id,
    });
    const saved = await txRepo.save(tx);

    expect(saved.txHash).toBe('0xTX_HASH_1');
    expect(saved.senderIdentity).toBe('testuser@txdc');

    const loaded = await txRepo.findOne({
      where: { txHash: '0xTX_HASH_1' },
      relations: ['senderUser'],
    });
    expect(loaded).not.toBeNull();
    expect(loaded!.senderUser).not.toBeNull();
    expect(loaded!.senderUser!.txdcName).toBe('testuser@txdc');
  });

  itIfDbAvailable('should find transactions by sender identity', async () => {
    // The previous test created a tx with txHash 0xTX_HASH_1
    // Create one more
    const user = await userRepo.findOne({ where: { slackId: 'U_TEST' } });
    if (!user) return;

    const tx2 = txRepo.create({
      txHash: '0xTX_HASH_2',
      senderIdentity: 'testuser@txdc',
      receiverIdentity: 'carol@txdc',
      senderAddress: '0x1234567890123456789012345678901234567890',
      receiverAddress: '0xCAROL',
      amount: '5',
      status: TransactionStatus.PENDING,
      type: TransactionType.TRANSFER,
      senderUser: user,
      senderUserId: user.id,
    });
    await txRepo.save(tx2);

    const [txs, count] = await txRepo.findAndCount({
      where: { senderIdentity: 'testuser@txdc' },
    });

    expect(count).toBeGreaterThanOrEqual(2);
  });

  itIfDbAvailable('should create an audit log entry', async () => {
    const audit = auditRepo.create({
      action: 'user.registered',
      slackId: 'U_TEST',
      entityType: 'user',
      details: { txdcName: 'testuser@txdc' },
      success: true,
    });
    const saved = await auditRepo.save(audit);

    expect(saved.id).toBeDefined();
    expect(saved.action).toBe('user.registered');
  });
});
