# syntax=docker/dockerfile:1
# AI 유료계정 관리시스템 — Next.js 앱 이미지 (standalone 출력)
# 빌드:  docker build -t ai-account-app .
# 실행:  docker run -p 3000:3000 --env-file docker/.env ai-account-app

# ---------- 1) 의존성 ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------- 2) 빌드 ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 빌드 시점에는 비밀 값이 필요 없다. NEXT_PUBLIC_* 만 번들에 들어가므로 build-arg 로 받는다.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
# 미들웨어는 Edge 번들이라 런타임 env 를 읽지 못할 수 있어 내부망 주소도 빌드 시 넣는다.
ARG SUPABASE_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    SUPABASE_URL=$SUPABASE_URL \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---------- 3) 실행 ----------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    TZ=Asia/Seoul
RUN apk add --no-cache tzdata wget \
 && addgroup -S nodejs && adduser -S nextjs -G nodejs
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
