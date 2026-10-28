# 프로젝트: AI 유료계정 관리시스템 (GNU AI융합원)

- 사양: `docs/PRD.md` 가 단일 진실. 규칙 번호(R1~R33)를 커밋 메시지·주석에 인용.
- 스택: Next.js App Router + TS + Tailwind, Supabase(service role, 서버 전용), Gmail SMTP(nodemailer), Vercel Cron.
- 시간대: 모든 날짜 계산은 Asia/Seoul. 유틸 `lib/date.ts` 의 `todayKST()` 만 사용.
- DB 접근: `lib/db.ts` 의 서버 클라이언트만. 브라우저 번들에 Supabase service role 키 절대 포함 금지. 좌석 접속 링크(`account_secrets.access_url`)는 서버 전용이며 로그에 남기지 않는다.
- 상태 전이: `lib/state.ts` 의 `transitionAssignment()` / `transitionAccount()` 를 통해서만 변경, 항상 `logs` 기록. 둘 다 조건부 갱신(읽은 상태일 때만)이며 경합 시 `false`. 좌석 선점·해제는 `claimAccount()` / `releaseClaim()` 만 쓴다(DB 유일 인덱스 `assignments_active_account_uq` 가 최종 방어).
- 메일: 직접 발송 금지. `lib/mail/queue.ts` 로 대기열에 넣고 `lib/mail/dispatch.ts` 가 Gmail SMTP(`GMAIL_USER` + `GMAIL_APP_PASSWORD`)로 발송. 둘 중 하나라도 비면 대기열에만 쌓인다.
- 테스트: 도메인 로직(배정·만료·알림·지표)은 순수 함수로 분리하고 Vitest 단위 테스트.
- 한글 UI, 라벨은 `lib/labels.ts` 에서 관리.
- 비밀 값은 `.env.local`, 예시는 `.env.example` 에 유지.

## 디렉터리

```
app/
  (public)/incident, (public)/apply
  admin/(protected)/(dashboard|assignments|programs|accounts|users|incidents|reports|settings|logs)
  admin/login, admin/denied, admin/actions.ts     ← Server Actions
  api/public/programs, api/public/apply
  api/cron/daily, api/cron/monthly, api/health, api/admin/report
lib/
  db.ts date.ts state.ts ids.ts assign.ts transitions.ts alerts.ts report.ts
  auth.ts settings.ts token.ts cors.ts rate-limit.ts labels.ts types.ts seed-data.ts
  mail/(templates.ts render.ts queue.ts dispatch.ts)
  ops/(apply.ts assignments.ts accounts.ts incidents.ts export.ts)
  cron/(daily.ts monthly.ts)
supabase/migrations/(0001_init.sql 0002_program_status.sql 0003_team_seat_access_url.sql 0004_seat_uniqueness.sql 0005_report_dedup.sql)
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
| R16 배정안내 메일(계정명·접속 링크) | 폐지(2026-10-28) — 신청자 자동 메일 없음 |
| R18 인수 확인 | 폐지(2026-10-28) — 배정 즉시 「사용중」, `acknowledged_at` = 사용개시 |
| R19 미인수 자동 취소 | 폐지(2026-10-28) |
| R20 대여 종료 | `lib/ops/assignments.ts:endExpiredRentals` |
| R21 비밀번호 생성 | 폐지 — 접근 차단은 R24 ②「팀에서 제거」 체크 |
| R22 알림 | `lib/alerts.ts` |
| R23 비밀번호 변경 완료 | 폐지 — R24 ② 체크로 대체 |
| R24 회수 체크 2개(대화·메모리 삭제 / 팀에서 제거)·재배정 | `lib/ops/assignments.ts:completeReturn` |
| R25 계정 통계 | `lib/assign.ts:assignedDaysOf`, `lib/ops/accounts.ts:refreshAccountStats` |
| R26~R28 장애 | `lib/ops/incidents.ts` |
| R29 실적·스냅샷 | `lib/report.ts`, `lib/cron/monthly.ts`, 뷰 `v_report_*`(0005: 사람 단위·취소 제외) |
| R30 개인정보 파기 | 화면 기능 없음(2026-10-28 제거) — `docs/운영매뉴얼.md` §8 SQL 절차 |
| R31 로그 | `lib/state.ts:log` |
| R32 멱등 일일 작업 | `lib/cron/daily.ts`(단계별 오류 수집·점검 메일 보고), `lib/lock.ts`(실행 잠금·마지막 성공 시각), `app/api/health`(`?strict=1` 외부 감시) |
| R33 Asia/Seoul | `lib/date.ts` |
