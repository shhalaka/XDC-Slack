import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { TransactionRecord } from './transaction-record.entity';

export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
  WHITELISTED = 'whitelisted',
}

export enum RegistrationStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  REVOKED = 'revoked',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'slack_id', type: 'varchar', length: 255, unique: true })
  @Index()
  slackId: string;

  @Column({ name: 'slack_team_id', type: 'varchar', length: 255, nullable: true })
  slackTeamId: string;

  @Column({ name: 'txdc_name', type: 'varchar', length: 63, unique: true })
  @Index()
  txdcName: string;

  @Column({ name: 'wallet_address', type: 'varchar', length: 42, unique: true })
  @Index()
  walletAddress: string;

  @Column({ name: 'encrypted_private_key', type: 'text', nullable: true })
  encryptedPrivateKey: string;

  @Column({
    name: 'role',
    type: 'enum',
    enum: UserRole,
    default: UserRole.USER,
  })
  role: UserRole;

  @Column({
    name: 'registration_status',
    type: 'enum',
    enum: RegistrationStatus,
    default: RegistrationStatus.ACTIVE,
  })
  registrationStatus: RegistrationStatus;

  @Column({ name: 'daily_volume_used', type: 'decimal', precision: 36, scale: 18, default: '0' })
  dailyVolumeUsed: string;

  @Column({ name: 'daily_transaction_count', type: 'int', default: 0 })
  dailyTransactionCount: number;

  @Column({ name: 'last_transaction_at', type: 'timestamptz', nullable: true })
  lastTransactionAt: Date;

  @Column({ name: 'daily_limit_reset_at', type: 'timestamptz', nullable: true })
  dailyLimitResetAt: Date;

  @Column({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => TransactionRecord, (tx) => tx.senderUser)
  sentTransactions: TransactionRecord[];

  @OneToMany(() => TransactionRecord, (tx) => tx.receiverUser)
  receivedTransactions: TransactionRecord[];
}
