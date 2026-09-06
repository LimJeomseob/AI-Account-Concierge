import { defineConfig } from 'vitest/config'
import path from 'node:path'

/** 수용 기준 T1~T13 통합 테스트 전용 (실제 Supabase 연결) */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/__tests__/**/*.integration.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      'server-only': path.resolve(__dirname, 'node_modules/server-only/empty.js'),
    },
  },
})
