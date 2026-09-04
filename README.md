# AI 유료계정 관리시스템

경상국립대학교 AI융합원 · 2026학년도 하반기 「AI 유료계정 지원 계획(안)」 운영 시스템
사양: [`docs/PRD.md`](docs/PRD.md) · 운영: [`docs/운영매뉴얼.md`](docs/운영매뉴얼.md)

ChatGPT Plus 50 + Claude Pro 50 계정을 하반기 교육 프로그램 참여자에게 회전 대여하고,
신청 → 승인 → 자동 배정 → 메일 안내 → 인수 확인 → 종료 → 회수 → 재배정 전 과정을
관리자 화면 하나에서 처리한다.

## 스택

| 구성 | 선택 |
|---|---|
| 프론트/서버 | Next.js(App Router) + TypeScript + Tailwind |
| DB | Supabase Postgres (`ap-northeast-2` 서울) — 서버에서 service role 로만 접근, RLS 전면 잠금 |
| 인증 | Supabase Auth Google Provider + `admins` 허용 목록 |
| 메일 | Resend (대기열 경유 발송) |
| 배치 | Vercel Cron — 매일 09:00 KST, 매월 1일 |

## 설치

```bash
npm install
cp .env.example .env.local     # 값 채우기
```

환경변수:

| 이름 | 설명 |
|---|---|
| `NEXT_PUBLIC_APP_URL` | 배포 주소 (메일 링크 생성에 사용) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | 서버 전용 DB 접근 |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 브라우저 Auth 전용 |
| `RESEND_API_KEY` | 메일 발송 (없으면 대기열에 보관만) |
| `VAULT_KEY` | 계정 금고 AES-256-GCM 키 — `openssl rand -base64 32` |
| `APP_SECRET` | 인수·장애 링크 HMAC 서명 키 — `openssl rand -hex 32` |
| `CRON_SECRET` | Cron 엔드포인트 인증 — `openssl rand -hex 32` |
| `INITIAL_ADMIN_EMAIL` | 시드로 등록할 최초 관리자 |

## 초기 구축

```bash
# 1) 스키마
psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql
#    또는 Supabase 대시보드 SQL Editor 에 붙여 넣기

# 2) 시드 (설정·메일 템플릿·최초 관리자 [+ 프로그램 24개, 샘플 계정])
npx tsx scripts/seed.ts --programs --sample-accounts

# 3) 계정 100개 납품 후
npx tsx scripts/import-accounts.ts accounts.csv
#    헤더: 계정ID,서비스,구분,로그인이메일,비밀번호,활성화일,만료일,등록이메일소유,2FA

# 4) 실행
npm run dev        # http://localhost:3000/admin
```

Supabase 대시보드에서 Google Provider 를 켜고, 리디렉션 URL 에
`<배포주소>/auth/callback` 을 등록한다.

## 신청 페이지 연결

`public/signup-snippet.html` 을 기존 GitHub Pages 에 붙여 넣고,
파일 안 `API_BASE` 를 배포 주소로 바꾼다. 관리자 화면 「설정 > CORS 허용 오리진」에
GitHub Pages 오리진을 등록해야 요청이 통과한다.
GitHub Pages 장애 시 대체용으로 같은 기능의 `/apply` 페이지를 제공한다.

## 배치

`vercel.json` 이 다음 두 작업을 등록한다 (UTC 00:00 = KST 09:00).

- `/api/cron/daily` — 프로그램 종료, 미인수 취소, 대여 종료·비밀번호 생성, 자동 배정,
  메일 발송, 계정 통계, 구독 만료, 관리자 점검 메일 (멱등)
- `/api/cron/monthly` — 월간 실적 스냅샷 + CSV + 관리자 메일

두 엔드포인트는 `Authorization: Bearer $CRON_SECRET` 헤더를 요구한다.
관리자 대시보드의 「일일 작업 지금 실행」 버튼도 같은 함수를 호출한다.

## 검증

```bash
npm test           # 도메인 로직 단위 테스트 (Vitest)
npm run build      # 타입체크 + 프로덕션 빌드
```

`supabase/migrations/0001_init.sql` 은 PostgreSQL 16 에서 적용·재적용(멱등)과
제약(중복 신청 차단, `current_assignment_id` 상태 제약) 동작을 확인했다.
PRD §16 의 시나리오 T1~T13 은 실제 Supabase·Resend 연결이 필요하므로 배포 후 수행한다.
