import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { IdentityService } from '../../src/modules/identity/identity.service';
import { IdentityResolver } from '../../src/modules/identity/identity.resolver';
import { User } from '../../src/database/entities/user.entity';
import { AuditLog } from '../../src/database/entities/audit-log.entity';

describe('IdentityService', () => {
  let service: IdentityService;
  let userRepo: Record<string, jest.Mock>;
  let auditRepo: Record<string, jest.Mock>;
  let resolver: Record<string, jest.Mock>;

  const mockUser = {
    id: 'uuid-1',
    slackId: 'U12345',
    slackTeamId: 'T12345',
    txdcName: 'alice@txdc',
    walletAddress: '0x1234567890123456789012345678901234567890',
    encryptedPrivateKey: '',
    role: 'user',
    registrationStatus: 'active',
    dailyVolumeUsed: '0',
    dailyTransactionCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    userRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };
    auditRepo = { save: jest.fn() };
    resolver = { resolve: jest.fn(), isRegistered: jest.fn(), register: jest.fn(), transfer: jest.fn(), reverseResolve: jest.fn(), ownerOf: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdentityService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(AuditLog), useValue: auditRepo },
        { provide: IdentityResolver, useValue: resolver },
      ],
    }).compile();

    service = module.get<IdentityService>(IdentityService);
  });

  describe('register', () => {
    it('should register a new identity', async () => {
      userRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      userRepo.create.mockReturnValue(mockUser);
      userRepo.save.mockResolvedValue(mockUser);

      const result = await service.register({
        slackId: 'U12345',
        slackTeamId: 'T12345',
        txdcName: 'alice@txdc',
        walletAddress: '0x1234567890123456789012345678901234567890',
      });

      expect(result.txdcName).toBe('alice@txdc');
      expect(result.walletAddress).toBe('0x1234567890123456789012345678901234567890');
    });

    it('should reject invalid txdc name without @txdc suffix', async () => {
      await expect(
        service.register({
          slackId: 'U12345',
          txdcName: 'alice',
          walletAddress: '0x1234567890123456789012345678901234567890',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid wallet address', async () => {
      await expect(
        service.register({
          slackId: 'U12345',
          txdcName: 'alice@txdc',
          walletAddress: 'not-an-address',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject duplicate txdc name', async () => {
      userRepo.findOne.mockResolvedValueOnce(mockUser);

      await expect(
        service.register({
          slackId: 'U99999',
          txdcName: 'alice@txdc',
          walletAddress: '0x9999999999999999999999999999999999999999',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should attempt on-chain registration after DB save', async () => {
      userRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      userRepo.create.mockReturnValue(mockUser);
      userRepo.save.mockResolvedValue(mockUser);
      resolver.register.mockResolvedValue('0xON_CHAIN_TX_HASH');

      const result = await service.register({
        slackId: 'U12345',
        slackTeamId: 'T12345',
        txdcName: 'alice@txdc',
        walletAddress: '0x1234567890123456789012345678901234567890',
      });

      expect(resolver.register).toHaveBeenCalledWith(
        'alice@txdc',
        '0x1234567890123456789012345678901234567890',
      );
      expect(result.txdcName).toBe('alice@txdc');
    });

    it('should not fail registration if on-chain mirror throws', async () => {
      userRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      userRepo.create.mockReturnValue(mockUser);
      userRepo.save.mockResolvedValue(mockUser);
      resolver.register.mockRejectedValue(new Error('Registrar not configured'));

      const result = await service.register({
        slackId: 'U12345',
        slackTeamId: 'T12345',
        txdcName: 'alice@txdc',
        walletAddress: '0x1234567890123456789012345678901234567890',
      });

      expect(result.txdcName).toBe('alice@txdc');
    });
  });

  describe('resolve', () => {
    it('should resolve a registered identity', async () => {
      userRepo.findOne.mockResolvedValue(mockUser);

      const result = await service.resolve('alice@txdc');
      expect(result).not.toBeNull();
      expect(result!.walletAddress).toBe('0x1234567890123456789012345678901234567890');
    });

    it('should return null for unknown identity', async () => {
      userRepo.findOne.mockResolvedValue(null);
      resolver.resolve.mockResolvedValue(null);

      const result = await service.resolve('unknown@txdc');
      expect(result).toBeNull();
    });

    it('should return null for non-txdc names', async () => {
      const result = await service.resolve('justaname');
      expect(result).toBeNull();
    });
  });
});
