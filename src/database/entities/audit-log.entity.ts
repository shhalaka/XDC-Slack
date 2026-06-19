import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum AuditAction {
  USER_REGISTERED = 'user.registered',
  USER_UPDATED = 'user.updated',
  USER_SUSPENDED = 'user.suspended',
  WALLET_CREATED = 'wallet.created',
  TRANSACTION_INITIATED = 'transaction.initiated',
  TRANSACTION_CONFIRMED = 'transaction.confirmed',
  TRANSACTION_FAILED = 'transaction.failed',
  TRANSACTION_REJECTED = 'transaction.rejected',
  BALANCE_CHECKED = 'balance.checked',
  HISTORY_VIEWED = 'history.viewed',
  IDENTITY_RESOLVED = 'identity.resolved',
  AUTH_SUCCESS = 'auth.success',
  AUTH_FAILURE = 'auth.failure',
  RATE_LIMIT_HIT = 'rate_limit.hit',
  SLASH_COMMAND_EXECUTED = 'slash_command.executed',
  SLACK_EVENT_RECEIVED = 'slack.event.received',
  ERROR_OCCURRED = 'error.occurred',
}

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    name: 'action',
    type: 'varchar',
    length: 63,
  })
  @Index()
  action: string;

  @Column({ name: 'slack_id', type: 'varchar', length: 255, nullable: true })
  @Index()
  slackId: string;

  @Column({ name: 'entity_type', type: 'varchar', length: 63, nullable: true })
  entityType: string;

  @Column({ name: 'entity_id', type: 'varchar', length: 255, nullable: true })
  entityId: string;

  @Column({ name: 'details', type: 'jsonb', nullable: true })
  details: Record<string, unknown>;

  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true })
  ipAddress: string;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent: string;

  @Column({ name: 'success', type: 'boolean', default: true })
  success: boolean;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string;

  @Column({ name: 'latency_ms', type: 'int', nullable: true })
  latencyMs: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
