import { DataSource, DataSourceOptions } from 'typeorm';
import * as dotenv from 'dotenv';
import * as path from 'path';

import { User } from './entities/user.entity';
import { TransactionRecord } from './entities/transaction-record.entity';
import { AuditLog } from './entities/audit-log.entity';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const config: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'txdc',
  password: process.env.DB_PASSWORD || 'txdc_secret',
  database: process.env.DB_DATABASE || 'txdc_assistant',
  entities: [User, TransactionRecord, AuditLog],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
};

export const AppDataSource = new DataSource(config);
