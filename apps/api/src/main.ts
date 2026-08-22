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
  const dbVar = process.env.APP_DATABASE_URL ? 'APP_DATABASE_URL'
    : process.env.DATABASE_URL ? 'DATABASE_URL (ควรแยกเป็น APP_DATABASE_URL บนเครื่องจริง)'
    : 'ยังไม่ได้ตั้ง — /health จะขึ้น degraded';
  console.log(`Financii API รันที่พอร์ต ${port} · ฐานข้อมูล: ${dbVar}`);
}
bootstrap();
