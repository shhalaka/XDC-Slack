import { INestApplication } from '@nestjs/common';

export function setupSwagger(app: INestApplication) {
  const { SwaggerModule, DocumentBuilder } = require('@nestjs/swagger');
  const config = new DocumentBuilder()
    .setTitle('TXDC Assistant API')
    .setDescription('Production-grade Slack Blockchain Assistant for TXDC payments')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);
}
