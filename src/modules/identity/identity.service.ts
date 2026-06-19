import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ethers } from 'ethers';
import { User, UserRole, RegistrationStatus } from '../../database/entities/user.entity';
import { AuditLog, AuditAction } from '../../database/entities/audit-log.entity';
import { IdentityResolver } from './identity.resolver';

export interface RegisterIdentityDto {
  slackId: string;
  slackTeamId?: string;
  txdcName: string;
  walletAddress: string;
  encryptedPrivateKey?: string;
}

export interface IdentityInfo {
  slackId: string;
  txdcName: string;
  walletAddress: string;
  role: UserRole;
  status: RegistrationStatus;
  createdAt: Date;
}

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);
  private readonly TXDC_NAME_REGEX = /^[a-z0-9][a-z0-9-_.]{2,31}@txdc$/;

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(AuditLog)
    private auditLogRepository: Repository<AuditLog>,
    private identityResolver: IdentityResolver,
  ) {}

  async register(dto: RegisterIdentityDto): Promise<IdentityInfo> {
    this.validateTxdcName(dto.txdcName);

    if (!ethers.isAddress(dto.walletAddress)) {
      throw new BadRequestException(`Invalid wallet address: ${dto.walletAddress}`);
    }

    const existingByName = await this.userRepository.findOne({
      where: { txdcName: dto.txdcName.toLowerCase() },
    });
    if (existingByName) {
      throw new ConflictException(
        `Identity ${dto.txdcName} is already registered. Use a different name or contact support.`,
      );
    }

    const existingBySlack = await this.userRepository.findOne({
      where: { slackId: dto.slackId },
    });
    if (existingBySlack) {
      throw new ConflictException(
        `Your Slack account is already linked to ${existingBySlack.txdcName}. Use /txdc update to change.`,
      );
    }

    const existingByWallet = await this.userRepository.findOne({
      where: { walletAddress: dto.walletAddress },
    });
    if (existingByWallet) {
      throw new ConflictException(
        `Wallet ${dto.walletAddress} is already linked to ${existingByWallet.txdcName}.`,
      );
    }

    const user = this.userRepository.create({
      slackId: dto.slackId,
      slackTeamId: dto.slackTeamId,
      txdcName: dto.txdcName.toLowerCase(),
      walletAddress: dto.walletAddress,
      encryptedPrivateKey: dto.encryptedPrivateKey || '',
      role: UserRole.USER,
      registrationStatus: RegistrationStatus.ACTIVE,
    });

    const saved = await this.userRepository.save(user);

    await this.auditLogRepository.save({
      action: AuditAction.USER_REGISTERED,
      slackId: dto.slackId,
      entityType: 'user',
      entityId: saved.id,
      details: {
        txdcName: dto.txdcName,
        walletAddress: dto.walletAddress,
      },
      success: true,
    });

    this.logger.log(`User registered (DB): ${dto.txdcName} → ${dto.walletAddress}`);

    // Mirror registration on-chain if the IdentityRegistry is configured
    try {
      const txHash = await this.identityResolver.register(dto.txdcName, dto.walletAddress);
      this.logger.log(`On-chain registration: ${txHash}`);
    } catch (onChainError) {
      // On-chain registration is optional; log warning but don't fail the request
      this.logger.warn(
        `On-chain registration skipped for ${dto.txdcName}: ${(onChainError as Error).message}`,
      );
    }

    return this.toIdentityInfo(saved);
  }

  async update(
    slackId: string,
    updates: Partial<Pick<RegisterIdentityDto, 'txdcName' | 'walletAddress'>>,
  ): Promise<IdentityInfo> {
    const user = await this.userRepository.findOne({ where: { slackId } });
    if (!user) {
      throw new NotFoundException(
        'No identity found for your Slack account. Use /txdc register first.',
      );
    }

    if (updates.txdcName) {
      this.validateTxdcName(updates.txdcName);
      const existing = await this.userRepository.findOne({
        where: { txdcName: updates.txdcName.toLowerCase() },
      });
      if (existing && existing.id !== user.id) {
        throw new ConflictException(`${updates.txdcName} is already taken.`);
      }
      user.txdcName = updates.txdcName.toLowerCase();
    }

    if (updates.walletAddress) {
      if (!ethers.isAddress(updates.walletAddress)) {
        throw new BadRequestException(`Invalid wallet address: ${updates.walletAddress}`);
      }
      const existing = await this.userRepository.findOne({
        where: { walletAddress: updates.walletAddress },
      });
      if (existing && existing.id !== user.id) {
        throw new ConflictException(`Wallet ${updates.walletAddress} is already linked to another identity.`);
      }
      user.walletAddress = updates.walletAddress;
    }

    const oldAddress = user.walletAddress;
    const saved = await this.userRepository.save(user);

    await this.auditLogRepository.save({
      action: AuditAction.USER_UPDATED,
      slackId,
      entityType: 'user',
      entityId: saved.id,
      details: updates,
      success: true,
    });

    // If wallet address changed, transfer on-chain ownership
    if (updates.walletAddress && updates.walletAddress !== oldAddress) {
      try {
        const txHash = await this.identityResolver.transfer(
          saved.txdcName,
          updates.walletAddress,
        );
        this.logger.log(`On-chain transfer: ${txHash}`);
      } catch (onChainError) {
        this.logger.warn(
          `On-chain transfer skipped for ${saved.txdcName}: ${(onChainError as Error).message}`,
        );
      }
    }

    return this.toIdentityInfo(saved);
  }

  async resolve(txdcName: string): Promise<User | null> {
    if (!txdcName.endsWith('@txdc')) {
      return null;
    }

    const user = await this.userRepository.findOne({
      where: { txdcName: txdcName.toLowerCase() },
    });

    if (user && user.registrationStatus === RegistrationStatus.ACTIVE) {
      return user;
    }

    if (!user) {
      const onChainAddress = await this.identityResolver.resolve(txdcName);
      if (onChainAddress) {
        return {
          txdcName: txdcName.toLowerCase(),
          walletAddress: onChainAddress,
        } as User;
      }
    }

    return null;
  }

  async resolveByName(txdcName: string): Promise<string | null> {
    const user = await this.resolve(txdcName);
    return user?.walletAddress || null;
  }

  async getByIdentity(txdcName: string): Promise<IdentityInfo | null> {
    const user = await this.resolve(txdcName);
    if (!user) return null;
    return this.toIdentityInfo(user);
  }

  async getBySlack(slackId: string): Promise<IdentityInfo | null> {
    const user = await this.userRepository.findOne({
      where: { slackId, registrationStatus: RegistrationStatus.ACTIVE },
    });
    if (!user) return null;
    return this.toIdentityInfo(user);
  }

  async getByAddress(walletAddress: string): Promise<IdentityInfo | null> {
    const user = await this.userRepository.findOne({
      where: { walletAddress },
    });
    if (!user) return null;
    return this.toIdentityInfo(user);
  }

  async suspend(slackId: string, reason?: string): Promise<void> {
    const user = await this.userRepository.findOne({ where: { slackId } });
    if (!user) throw new NotFoundException('User not found');

    user.registrationStatus = RegistrationStatus.SUSPENDED;
    await this.userRepository.save(user);

    await this.auditLogRepository.save({
      action: AuditAction.USER_SUSPENDED,
      slackId,
      entityType: 'user',
      entityId: user.id,
      details: { reason },
      success: true,
    });
  }

  private validateTxdcName(txdcName: string): void {
    if (!this.TXDC_NAME_REGEX.test(txdcName)) {
      throw new BadRequestException(
        `Invalid TXDC name format. Must match pattern: username@txdc (3-32 chars, lowercase, alphanumeric with hyphens/underscores/dots)`,
      );
    }
  }

  private toIdentityInfo(user: User): IdentityInfo {
    return {
      slackId: user.slackId,
      txdcName: user.txdcName,
      walletAddress: user.walletAddress,
      role: user.role,
      status: user.registrationStatus,
      createdAt: user.createdAt,
    };
  }
}
