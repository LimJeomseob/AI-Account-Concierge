import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  typedRoutes: false,
  // Docker 배포용 최소 실행 번들(.next/standalone). Vercel 배포에는 영향 없음.
  output: 'standalone',
}

export default nextConfig
