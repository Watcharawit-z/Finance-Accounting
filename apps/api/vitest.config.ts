import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  // NestJS ใช้ emitDecoratorMetadata ในการฉีด dependency
  // esbuild (ตัวแปลงเริ่มต้นของ vitest) ไม่รองรับ จึงต้องใช้ SWC แทน
  // ไม่งั้น constructor injection จะได้ undefined ทั้งหมด
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,   // ทดสอบกับฐานข้อมูลจริงร่วมกัน จึงต้องรันทีละไฟล์
    globalSetup: ['./test/global-setup.ts'],
  },
});
