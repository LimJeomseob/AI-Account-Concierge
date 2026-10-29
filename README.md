# AI 유료계정 관리시스템

경상국립대학교 AI융합원 · 2026학년도 하반기 「AI 유료계정 지원 계획(안)」 운영 시스템
사양: [`docs/PRD.md`](docs/PRD.md) · 운영: [`docs/운영매뉴얼.md`](docs/운영매뉴얼.md)

ChatGPT Business Standard 45 + Claude Team 71 계정(계정번호 GPT-001·CL-001 …)을 하반기 교육 프로그램 참여자에게 회전 대여하고,
신청 → 승인 → 「승인 건 배정 + 메일 내려받기」(즉시 사용중) → 워크스페이스 초대 → 대여 종료 → 회수 전 과정을
관리자 화면 하나에서 처리한다. 신청자에게 자동 메일은 보내지 않는다(관리자 점검·장애·스냅샷 메일만).

## 스택

| 구성 | 선택 |
|---|---|
| 프론트/서버 | Next.js(App Router) + TypeScript + Tailwind |
| DB | Supabase Postgres (`ap-northeast-2` 서울) — 서버에서 service role 로만 접근, RLS 전면 잠금 |
| 인증 | Supabase Auth Google Provider + `admins` 허용 목록 |
| 메일 | Gmail SMTP — nodemailer, 앱 비밀번호 (대기열 경유 발송) |
| 배치 | Vercel Cron — 매일 09:00 KST, 매월 1일 |

## 운영 환경 (클라우드 전용, 2026-10-29)

로컬 실행은 하지 않는다. Vercel + Supabase 클라우드에서만 구동한다.

- **접속 주소:** https://ai-account-concierge.vercel.app — 코드에 고정(`lib/site.ts`).
  운영 배포에 다른 `*.vercel.app` 주소로 들어오면 이 주소로 이동한다(`/api` 제외).
- **배포:** GitHub `main` 에 합치면 Vercel 이 자동 배포한다. 절차 전체는 [`docs/배포체크리스트.md`](docs/배포체크리스트.md).
- **검사:** PR 마다 GitHub Actions CI 가 타입 검사·단위 테스트·빌드를 실행한다.

Vercel 환경변수 (Production·Preview 모두, 이름 예시는 `.env.example`):

| 이름 | 설명 |
|---|---|
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | 서버 전용 DB 접근 |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 브라우저 Auth 전용 |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | 메일 발송 — 발신 Gmail 계정과 16자리 앱 비밀번호 (하나라도 없으면 대기열에 보관만) |
| `APP_SECRET` | 장애 신고 링크 HMAC 서명 키 — `openssl rand -hex 32` |
| `CRON_SECRET` | Cron 엔드포인트 인증(필수) — `openssl rand -hex 32` |
| `INITIAL_ADMIN_EMAIL` | (선택) `admins` 가 비어 있을 때 첫 로그인으로 자동 등록할 관리자 |

## 초기 구축 (모두 웹 화면에서)

1. **스키마:** Supabase 대시보드 > SQL Editor 에 `supabase/migrations/0001`~`0008` 을 번호 순서대로 붙여 넣어 실행한다(각 파일 멱등).
   0002·0003 은 enum 값 추가가 있어, 한 번에 실행해 오류가 나면 파일 안 문장을 위에서부터 나눠 실행한다.
2. **Google 로그인:** Supabase > Authentication > URL Configuration 의 Site URL 을 `https://ai-account-concierge.vercel.app`,
   Redirect URLs 에 `https://ai-account-concierge.vercel.app/auth/callback` 을 등록한다.
3. **최초 관리자:** `INITIAL_ADMIN_EMAIL` 계정으로 로그인하면 자동 등록된다. 이후 관리자는 설정 > 로그인 허용 관리자에서 추가한다.
4. **프로그램:** 관리자 화면 「프로그램 > 하반기 24개 일괄 등록」.
5. **계정:** 관리자 화면 「계정 > CSV 가져오기」 (헤더: 계정번호,서비스,구분,로그인이메일,활성화일,만료일).

`scripts/seed.ts`·`scripts/import-accounts.ts` 는 로컬용 대체 수단이라 운영에서는 쓰지 않는다.

## 신청 페이지 연결

`public/signup-snippet.html` 을 기존 GitHub Pages 에 붙여 넣고,
파일 안 `API_BASE` 는 고정 주소(`https://ai-account-concierge.vercel.app`)로 이미 맞춰져 있다. 관리자 화면 「설정 > CORS 허용 오리진」에
GitHub Pages 오리진을 등록해야 요청이 통과한다.
GitHub Pages 장애 시 대체용으로 같은 기능의 `/apply` 페이지를 제공한다.

## 배치

`vercel.json` 이 다음 두 작업을 등록한다 (UTC 00:00 = KST 09:00).

- `/api/cron/daily` — 대여 종료, 회수 알림, 메일 발송(장애·스냅샷), 계정 통계
  (멱등·실행 잠금, 단계 오류는 대시보드 경고 + 500 응답)
- `/api/cron/monthly` — 월간 실적 스냅샷 + CSV + 관리자 메일 (매월 1일 UTC 00:10)

두 엔드포인트는 `Authorization: Bearer $CRON_SECRET` 헤더를 요구한다.
관리자 대시보드의 「일일 작업 지금 실행」 버튼도 같은 함수를 호출한다.

## 검증

```bash
npm test              # 도메인 로직 단위 테스트 (Vitest) — GitHub Actions CI(.github/workflows/ci.yml)가 PR 마다 tsc·test·build 를 실행
npm run build         # 타입체크 + 프로덕션 빌드

# 수용 기준 T1~T13 (PRD §16) — 실제 Supabase 연결 필요, 시범/스테이징에서만.
# ACCEPTANCE_DB_HOST 에 시범 DB 호스트를 적어야 켜진다(운영 DB 오실행 방지). 테스트는 자기 계정·프로그램 안에서만 배정한다.
ACCEPTANCE_CONFIRM=yes ACCEPTANCE_DB_HOST=<시범프로젝트>.supabase.co npm run test:acceptance
```

`supabase/migrations/0001_init.sql`~`0006_drop_access_link_rule.sql` 은 PostgreSQL 16 에서 적용·재적용(멱등)과
제약(중복 신청 차단, `current_assignment_id` 상태 제약) 동작을 확인했다.
PRD §16 의 시나리오 T1~T13 은 `lib/__tests__/acceptance.integration.test.ts` 로 자동화돼 있으며,
실제 Supabase 연결이 있을 때만 실행된다(테스트 데이터는 `ZTEST` 접두, 종료 시 삭제, 메일 발송 차단).
배포 절차 전체는 [`docs/배포체크리스트.md`](docs/배포체크리스트.md) 를 따른다.
