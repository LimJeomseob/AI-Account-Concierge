import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/__tests__/**/*.test.ts'],
    // 실제 Supabase 연결이 필요한 수용 기준 스위트는 별도 설정으로 실행 (npm run test:acceptance)
    exclude: ['lib/__tests__/**/*.integration.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // 서버 전용 마커. 테스트(node 환경)에서는 빈 모듈로 대체한다.
      'server-only': path.resolve(__dirname, 'node_modules/server-only/empty.js'),
    },
  },
})
