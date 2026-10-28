import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  typedRoutes: false,
  // Docker 배포용 최소 실행 번들(.next/standalone).
  // Vercel 에서는 켜면 안 된다 — onBuildComplete 가 .next/next-server.js.nft.json 을 찾다 ENOENT 로 실패한다.
  // Vercel 은 빌드 환경에 VERCEL=1 을 넣어 주므로 그때만 끈다(Dockerfile 은 그대로 standalone).
  ...(process.env.VERCEL ? {} : { output: 'standalone' as const }),
}

export default nextConfig
