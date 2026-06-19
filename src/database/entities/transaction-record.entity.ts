import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';

export enum TransactionStatus {
  PENDING = 'pending',
  PENDING_CONFIRMATION = 'pending_confirmation',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
  REJECTED = 'rejected',
}

export enum TransactionType {
  TRANSFER = 'transfer',
  DEPOSIT = 'deposit',
  WITHDRAWAL = 'withdrawal',
}

@Entity('transactions')
export class TransactionRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tx_hash', type: 'varchar', length: 66, unique: true, nullable: true })
  @Index()
  txHash: string;

  @Column({ name: 'sender_identity', type: 'varchar', length: 63 })
  senderIdentity: string;

  @Column({ name: 'receiver_identity', type: 'varchar', length: 63 })
  receiverIdentity: string;

  @Column({ name: 'sender_address', type: 'varchar', length: 42 })
  senderAddress: string;

  @Column({ name: 'receiver_address', type: 'varchar', length: 42 })
  receiverAddress: string;

  @Column({ name: 'amount', type: 'decimal', precision: 36, scale: 18 })
  amount: string;

  @Column({ name: 'gas_limit', type: 'bigint', nullable: true })
  gasLimit: string;

  @Column({ name: 'gas_price', type: 'varchar', length: 66, nullable: true })
  gasPrice: string;

  @Column({ name: 'gas_used', type: 'bigint', nullable: true })
  gasUsed: string;

  @Column({ name: 'nonce', type: 'int', nullable: true })
  nonce: number;

  @Column({ name: 'block_number', type: 'bigint', nullable: true })
  blockNumber: string;

  @Column({ name: 'block_timestamp', type: 'bigint', nullable: true })
  blockTimestamp: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: TransactionStatus,
    default: TransactionStatus.PENDING_CONFIRMATION,
  })
  @Index()
  status: TransactionStatus;

  @Column({
    name: 'type',
    type: 'enum',
    enum: TransactionType,
    default: TransactionType.TRANSFER,
  })
  type: TransactionType;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string;

  @Column({ name: 'raw_transaction', type: 'text', nullable: true })
  rawTransaction: string;

  @Column({ name: 'signed_transaction', type: 'text', nullable: true })
  signedTransaction: string;

  @Column({ name: 'confirmation_blocks', type: 'int', default: 0 })
  confirmationBlocks: number;

  @Column({ name: 'required_confirmations', type: 'int', default: 12 })
  requiredConfirmations: number;

  @Column({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata: Record<string, unknown>;

  @ManyToOne(() => User, (user) => user.sentTransactions, { nullable: true })
  @JoinColumn({ name: 'sender_user_id' })
  senderUser: User;

  @Column({ name: 'sender_user_id', type: 'uuid', nullable: true })
  senderUserId: string;

  @ManyToOne(() => User, (user) => user.receivedTransactions, { nullable: true })
  @JoinColumn({ name: 'receiver_user_id' })
  receiverUser: User;

  @Column({ name: 'receiver_user_id', type: 'uuid', nullable: true })
  receiverUserId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
