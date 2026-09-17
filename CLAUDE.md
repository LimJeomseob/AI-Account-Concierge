# 프로젝트: AI 유료계정 관리시스템 (GNU AI융합원)

- 사양: `docs/PRD.md` 가 단일 진실. 규칙 번호(R1~R33)를 커밋 메시지·주석에 인용.
- 스택: Next.js App Router + TS + Tailwind, Supabase(service role, 서버 전용), Resend, Vercel Cron.
- 시간대: 모든 날짜 계산은 Asia/Seoul. 유틸 `lib/date.ts` 의 `todayKST()` 만 사용.
- DB 접근: `lib/db.ts` 의 서버 클라이언트만. 브라우저 번들에 Supabase service role 키 절대 포함 금지. 좌석 접속 링크(`account_secrets.access_url`)는 서버 전용이며 로그에 남기지 않는다.
- 상태 전이: `lib/state.ts` 의 `transitionAssignment()` / `transitionAccount()` 를 통해서만 변경, 항상 `logs` 기록.
- 메일: 직접 발송 금지. `lib/mail/queue.ts` 로 대기열에 넣고 `lib/mail/dispatch.ts` 가 발송.
- 테스트: 도메인 로직(배정·만료·알림·지표)은 순수 함수로 분리하고 Vitest 단위 테스트.
- 한글 UI, 라벨은 `lib/labels.ts` 에서 관리.
- 비밀 값은 `.env.local`, 예시는 `.env.example` 에 유지.

## 디렉터리

```
app/
  (public)/ack, (public)/incident, (public)/apply
  admin/(protected)/(dashboard|assignments|programs|accounts|users|incidents|reports|settings|logs)
  admin/login, admin/denied, admin/actions.ts     ← Server Actions
  api/public/programs, api/public/apply
  api/cron/daily, api/cron/monthly, api/health, api/admin/report
lib/
  db.ts date.ts state.ts ids.ts assign.ts transitions.ts alerts.ts report.ts
  auth.ts settings.ts token.ts cors.ts rate-limit.ts labels.ts types.ts seed-data.ts
  mail/(templates.ts render.ts queue.ts dispatch.ts)
  ops/(apply.ts assignments.ts accounts.ts incidents.ts privacy.ts)
  cron/(daily.ts monthly.ts)
supabase/migrations/(0001_init.sql 0002_program_status.sql 0003_team_seat_access_url.sql)
scripts/seed.ts, scripts/import-accounts.ts
public/signup-snippet.html                        ← GitHub Pages 삽입용
Dockerfile, .dockerignore                         ← Next.js standalone 이미지
docker/docker-compose.yml, docker/Caddyfile, docker/cron/, docker/backup.sh
docker/supabase/(setup.sh apply-migration.sh google-oauth.override.yml)  ← 공식 셀프호스팅 스택 준비
docs/PRD.md, docs/운영매뉴얼.md, docs/배포체크리스트.md, docs/Docker배포가이드.md
```

- 배포 경로는 둘: Vercel + Supabase 클라우드(`docs/배포체크리스트.md`) / 대학 서버 Docker + Supabase 셀프호스팅(`docs/Docker배포가이드.md`).
  앱 코드는 두 경로에서 동일하며 환경변수 값만 다르다. `SUPABASE_URL`(서버 내부망) 과 `NEXT_PUBLIC_SUPABASE_URL`(브라우저) 을 분리해 둔 이유다.

## 규칙 ↔ 구현 대응

| 규칙 | 위치 |
|---|---|
| R1·R6 프로그램 채번·시드 | `lib/ids.ts`, `lib/seed-data.ts`, `app/admin/actions.ts:programSeedAction` |
| R2·R15 대여기간 | `lib/assign.ts:periodFor / isAssignable` |
| R3 공개 프로그램 목록·상태별 표시 | `lib/assign.ts:applyAvailability / isOpenForApply`, `app/api/public/programs` |
| R4 프로그램 자동 종료 | 폐지 — 상태(시작전·진행중·완료) 전환은 관리자 드롭다운 수동 `app/admin/actions.ts:programStatusAction` |
| R5 배정상한 | `lib/assign.ts:capRemaining` |
| R7~R11 신청 접수 | `lib/ops/apply.ts`, `app/api/public/apply` |
| R12·R14 자동 배정 | `lib/assign.ts:planAllocations`, `lib/ops/assignments.ts:autoAssignProgram` |
| R14-2 배정 풀(접속 링크 등록) | `lib/ops/assignments.ts:availablePool`, `program_availability` 뷰 |
| R13·R17 승인·반려·취소 | `lib/ops/assignments.ts` |
| R16 배정안내 메일(계정명·접속 링크) | `lib/mail/queue.ts:queueAssignmentMail` |
| R18 인수 확인 | `app/(public)/ack`, `lib/ops/assignments.ts:acknowledge` |
| R19 미인수 자동 취소 | `lib/ops/assignments.ts:expireUnacknowledged` |
| R20 대여 종료 | `lib/ops/assignments.ts:endExpiredRentals` |
| R21 비밀번호 생성 | 폐지 — 접근 차단은 R24 ②「팀에서 제거」 체크 |
| R22 알림 | `lib/alerts.ts` |
| R23 비밀번호 변경 완료 | 폐지 — R24 ② 체크로 대체 |
| R24 회수 체크 2개(대화·메모리 삭제 / 팀에서 제거)·재배정 | `lib/ops/assignments.ts:completeReturn` |
| R25 계정 통계 | `lib/assign.ts:assignedDaysOf`, `lib/ops/accounts.ts:refreshAccountStats` |
| R26~R28 장애 | `lib/ops/incidents.ts` |
| R29 실적·스냅샷 | `lib/report.ts`, `lib/cron/monthly.ts` |
| R30 개인정보 파기 | `lib/ops/privacy.ts` |
| R31 로그 | `lib/state.ts:log` |
| R32 멱등 일일 작업 | `lib/cron/daily.ts` |
| R33 Asia/Seoul | `lib/date.ts` |
