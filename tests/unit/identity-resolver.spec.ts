import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { IdentityResolver } from '../../src/modules/identity/identity.resolver';
import { RpcClient } from '../../src/modules/blockchain/rpc-client';
import { SecretsService } from '../../src/shared/secrets/secrets.service';

describe('IdentityResolver', () => {
  let resolver: IdentityResolver;
  let rpcClient: Record<string, jest.Mock>;
  let configService: Record<string, jest.Mock>;
  let secretsService: Record<string, jest.Mock>;

  const registryAddress = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';
  const registrarKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const aliceAddr = '0x1234567890123456789012345678901234567890';
  const bobAddr = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

  function makeConfig(overrides: Record<string, string> = {}) {
    const defaults: Record<string, string> = {
      'identityRegistry.address': registryAddress,
      'rpc.url': 'http://localhost:8545',
      'rpc.chainId': '123454321',
      'identityRegistry.registrarPrivateKey': registrarKey,
    };
    return { ...defaults, ...overrides };
  }

  function createModule(configOverrides: Record<string, string> = {}) {
    const config = makeConfig(configOverrides);
    return Test.createTestingModule({
      providers: [
        IdentityResolver,
        { provide: RpcClient, useValue: rpcClient },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => config[key] ?? undefined) },
        },
        {
          provide: SecretsService,
          useValue: secretsService,
        },
      ],
    }).compile();
  }

  beforeEach(async () => {
    rpcClient = { callContract: jest.fn() };
    secretsService = {
      getRegistrarPrivateKey: jest.fn().mockResolvedValue(registrarKey),
    };
  });

  describe('resolve', () => {
    it('should return address for a registered name', async () => {
      const encoded = ethers.AbiCoder.defaultAbiCoder().encode(['address'], [aliceAddr]);
      rpcClient.callContract.mockResolvedValue(encoded);

      const mod = await createModule();
      resolver = mod.get<IdentityResolver>(IdentityResolver);

      const result = await resolver.resolve('alice@txdc');
      expect(result).toBe(aliceAddr.toLowerCase());

      expect(rpcClient.callContract).toHaveBeenCalledWith(
        registryAddress,
        expect.any(String),
      );
    });

    it('should return null for unregistered name', async () => {
      const encoded = ethers.AbiCoder.defaultAbiCoder().encode(['address'], [ethers.ZeroAddress]);
      rpcClient.callContract.mockResolvedValue(encoded);

      const mod = await createModule();
      resolver = mod.get<IdentityResolver>(IdentityResolver);

      const result = await resolver.resolve('unknown@txdc');
      expect(result).toBeNull();
    });

    it('should return null if contract call fails', async () => {
      rpcClient.callContract.mockRejectedValue(new Error('RPC error'));

      const mod = await createModule();
      resolver = mod.get<IdentityResolver>(IdentityResolver);

      const result = await resolver.resolve('fail@txdc');
      expect(result).toBeNull();
    });

    it('should return null if registry is not configured', async () => {
      const mod = await createModule({ 'identityRegistry.address': '' });
      resolver = mod.get<IdentityResolver>(IdentityResolver);

      const result = await resolver.resolve('alice@txdc');
      expect(result).toBeNull();
      expect(rpcClient.callContract).not.toHaveBeenCalled();
    });

    it('should strip @txdc suffix and lowercase before resolving', async () => {
      const encoded = ethers.AbiCoder.defaultAbiCoder().encode(['address'], [aliceAddr]);
      rpcClient.callContract.mockResolvedValue(encoded);

      const mod = await createModule();
      resolver = mod.get<IdentityResolver>(IdentityResolver);

      await resolver.resolve('Alice@txdc');
      const callData = rpcClient.callContract.mock.calls[0][1] as string;
      // The encoded data should NOT contain uppercased 'Alice'
      expect(callData).not.toContain('Alice');
    });
  });

  describe('isRegistered', () => {
    it('should return true when name resolves to non-zero address', async () => {
      const encoded = ethers.AbiCoder.defaultAbiCoder().encode(['address'], [aliceAddr]);
      rpcClient.callContract.mockResolvedValue(encoded);

      const mod = await createModule();
      resolver = mod.get<IdentityResolver>(IdentityResolver);

      const result = await resolver.isRegistered('alice@txdc');
      expect(result).toBe(true);
    });

    it('should return false when name resolves to null', async () => {
      const encoded = ethers.AbiCoder.defaultAbiCoder().encode(['address'], [ethers.ZeroAddress]);
      rpcClient.callContract.mockResolvedValue(encoded);

      const mod = await createModule();
      resolver = mod.get<IdentityResolver>(IdentityResolver);

      const result = await resolver.isRegistered('nobody@txdc');
      expect(result).toBe(false);
    });
  });

  describe('register', () => {
    it('should throw if registry not configured', async () => {
      const mod = await createModule({ 'identityRegistry.address': '' });
      resolver = mod.get<IdentityResolver>(IdentityResolver);

      await expect(resolver.register('alice@txdc', aliceAddr)).rejects.toThrow(
        'IdentityRegistry not configured',
      );
    });

    it('should throw if registrar key not configured', async () => {
      secretsService.getRegistrarPrivateKey.mockRejectedValue(
        new Error('Registrar private key not configured'),
      );
      const mod = await createModule({ 'identityRegistry.registrarPrivateKey': '' });
      resolver = mod.get<IdentityResolver>(IdentityResolver);

      await expect(resolver.register('alice@txdc', aliceAddr)).rejects.toThrow(
        'Registrar private key not configured',
      );
    });
  });

  describe('reverseResolve', () => {
    it('should return name for a known address', async () => {
      const encoded = ethers.AbiCoder.defaultAbiCoder().encode(['string'], ['alice']);
      rpcClient.callContract.mockResolvedValue(encoded);

      const mod = await createModule();
      resolver = mod.get<IdentityResolver>(IdentityResolver);

      const result = await resolver.reverseResolve(bobAddr);
      expect(result).toBe('alice');
    });

    it('should return null for unknown address', async () => {
      const encoded = ethers.AbiCoder.defaultAbiCoder().encode(['string'], ['']);
      rpcClient.callContract.mockResolvedValue(encoded);

      const mod = await createModule();
      resolver = mod.get<IdentityResolver>(IdentityResolver);

      const result = await resolver.reverseResolve(ethers.ZeroAddress);
      expect(result).toBeNull();
    });

    it('should return null if contract call fails', async () => {
      rpcClient.callContract.mockRejectedValue(new Error('RPC error'));

      const mod = await createModule();
      resolver = mod.get<IdentityResolver>(IdentityResolver);

      const result = await resolver.reverseResolve(bobAddr);
      expect(result).toBeNull();
    });

    it('should return null if registry is not configured', async () => {
      const mod = await createModule({ 'identityRegistry.address': '' });
      resolver = mod.get<IdentityResolver>(IdentityResolver);

      const result = await resolver.reverseResolve(bobAddr);
      expect(result).toBeNull();
    });
  });

  describe('ownerOf', () => {
    it('should return address from resolve', async () => {
      const encoded = ethers.AbiCoder.defaultAbiCoder().encode(['address'], [aliceAddr]);
      rpcClient.callContract.mockResolvedValue(encoded);

      const mod = await createModule();
      resolver = mod.get<IdentityResolver>(IdentityResolver);

      const result = await resolver.ownerOf('alice@txdc');
      expect(result).toBe(aliceAddr.toLowerCase());
    });
  });
});
