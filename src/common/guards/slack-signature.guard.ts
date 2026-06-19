import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import * as crypto from 'crypto';

@Injectable()
export class SlackSignatureGuard implements CanActivate {
  private readonly signingSecret: string;

  constructor(private configService: ConfigService) {
    this.signingSecret = this.configService.get<string>('slack.signingSecret', '');
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (this.configService.get<string>('nodeEnv') === 'development') {
      return true;
    }

    const signature = request.headers['x-slack-signature'] as string;
    const timestamp = request.headers['x-slack-request-timestamp'] as string;
    const body = (request as any).rawBody || JSON.stringify(request.body);

    if (!signature || !timestamp) {
      throw new UnauthorizedException('Missing Slack signature headers');
    }

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > 60 * 5) {
      throw new UnauthorizedException('Request timestamp too old');
    }

    const sigBaseString = `v0:${timestamp}:${body}`;
    const expectedSignature =
      'v0=' +
      crypto
        .createHmac('sha256', this.signingSecret)
        .update(sigBaseString)
        .digest('hex');

    if (!crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature),
    )) {
      throw new UnauthorizedException('Invalid Slack signature');
    }

    return true;
  }
}
