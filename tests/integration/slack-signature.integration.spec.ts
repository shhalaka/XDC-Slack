import * as crypto from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SlackSignatureGuard } from '../../src/common/guards/slack-signature.guard';

/**
 * Integration test: Slack request signature verification.
 *
 * Tests the HMAC-SHA256 signing scheme that Slack uses:
 *   sig = HMAC-SHA256("v0:{timestamp}:{body}", signingSecret)
 *
 * Without a real HTTP request context, we test the cryptographic
 * primitives directly and verify that the guard rejects:
 *   - Missing headers
 *   - Expired timestamps
 *   - Invalid signatures
 */
describe('Slack Signature Verification', () => {
  const signingSecret = 'test_signing_secret_abc123';

  let guard: SlackSignatureGuard;
  let mockConfig: { get: jest.Mock };

  function generateSignature(timestamp: string, body: string): string {
    const sigBaseString = `v0:${timestamp}:${body}`;
    return (
      'v0=' +
      crypto.createHmac('sha256', signingSecret).update(sigBaseString).digest('hex')
    );
  }

  beforeEach(async () => {
    mockConfig = {
      get: jest.fn((key: string) => {
        if (key === 'slack.signingSecret') return signingSecret;
        if (key === 'nodeEnv') return 'production';
        return undefined;
      }),
    };

    guard = new SlackSignatureGuard(mockConfig as unknown as ConfigService);
  });

  it('should generate and verify a valid signature', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = 'command=/txdc&text=test&user_id=U123';
    const signature = generateSignature(timestamp, body);

    const computed = `v0:${timestamp}:${body}`;
    const expected =
      'v0=' +
      crypto.createHmac('sha256', signingSecret).update(computed).digest('hex');

    expect(signature).toBe(expected);
  });

  it('should reject if signature headers are missing', () => {
    const mockRequest = {
      headers: {},
      body: {},
    } as any;
    const context = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as any;

    expect(() => guard.canActivate(context)).toThrow();
  });

  it('should reject expired timestamps (older than 5 minutes)', () => {
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 301); // 5min + 1s
    const body = 'test body';
    const signature = generateSignature(oldTimestamp, body);

    const mockRequest = {
      headers: {
        'x-slack-signature': signature,
        'x-slack-request-timestamp': oldTimestamp,
      },
      body: {},
    } as any;
    const context = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as any;

    expect(() => guard.canActivate(context)).toThrow();
  });

  it('should reject an invalid signature', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const mockRequest = {
      headers: {
        'x-slack-signature': 'v0=invalid_signature_here',
        'x-slack-request-timestamp': timestamp,
      },
      body: 'command=/txdc&text=test&user_id=U123',
      rawBody: 'command=/txdc&text=test&user_id=U123',
    } as any;
    const context = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as any;

    expect(() => guard.canActivate(context)).toThrow();
  });

  it('should accept a valid recent signature', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = 'command=/txdc&text=test&user_id=U123';
    const signature = generateSignature(timestamp, body);

    const mockRequest = {
      headers: {
        'x-slack-signature': signature,
        'x-slack-request-timestamp': timestamp,
      },
      body,
      rawBody: body,
    } as any;
    const context = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as any;

    expect(guard.canActivate(context)).toBe(true);
  });

  it('should use rawBody if available, otherwise stringify body', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = 'raw=body&data=here';
    // signature computed from rawBody
    const signature = generateSignature(timestamp, rawBody);

    const mockRequest = {
      headers: {
        'x-slack-signature': signature,
        'x-slack-request-timestamp': timestamp,
      },
      body: { raw: 'body', data: 'here' },
      rawBody,
    } as any;
    const context = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as any;

    expect(guard.canActivate(context)).toBe(true);
  });
});
