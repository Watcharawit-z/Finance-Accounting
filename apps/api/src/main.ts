import 'reflect-metadata';

// กันไว้อีกชั้น: ถ้ามี bigint หลุดเข้า response ให้กลายเป็นสตริง
// ดีกว่าปล่อยให้ตอบ 500 โดยที่ผู้เรียกทำอะไรไม่ได้
(BigInt.prototype as unknown as { toJSON(): string }).toJSON = function () {
  return this.toString();
};
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DomainExceptionFilter } from './common/errors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.useGlobalFilters(new DomainExceptionFilter());
  app.enableCors({ origin: process.env.CORS_ORIGIN ?? true, credentials: true });
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
  console.log(`DULY API รันที่ http://localhost:${port}`);
}
bootstrap();
