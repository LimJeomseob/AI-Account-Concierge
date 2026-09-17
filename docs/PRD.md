# PRD — AI 유료계정 관리시스템 (Claude Code 구현용)

경상국립대학교 AI융합원 · 2026학년도 하반기 「AI 유료계정 지원 계획(안)」 운영 시스템
버전 1.0 · 2026-09-04 · 작성: 대화 내용 종합(Apps Script 구현본 → 웹 앱 재구축)

> 이 문서는 Claude Code가 그대로 읽고 구현하는 사양서입니다. 「확정」은 사용자가 결정한 사항, 「제안」은 구현을 위해 이 문서가 채운 사항(끝에 예측 수준 표기)입니다. 제안은 사용자가 바꾸면 그에 따릅니다.

---

## 0. 한눈에 보기

| 항목 | 내용 |
|---|---|
| 목적 | ChatGPT Plus 50 + Claude Pro 50 계정(각 6개월)을 하반기 교육 프로그램 참여자에게 **회전 대여**하고, 프로그램별 사용 인원(연인원 600 목표)을 실적으로 관리 |
| 대체 대상 | Google Sheets + Apps Script 구현본(Code.gs ~1,200행, 모의 검증 완료). 기능·규칙은 그대로 계승, 구현 기술만 교체 |
| 스택(확정) | Next.js(App Router, TypeScript, Tailwind, shadcn/ui) + Supabase(Postgres, Auth, 서울 리전) + Resend(메일) + Vercel(호스팅·Cron) |
| 관리자 인증(확정) | Google 로그인 + 허용 이메일 목록 |
| 계정 금고(확정) | DB에 암호화 저장(시트 의존 제거) |
| 신청 페이지(확정) | 기존 GitHub Pages에 HTML 블록 삽입, 새 백엔드 API 호출(CORS 허용) |
| 운영 주체 | 운영관리자(소수, 동등 권한). 프로그램 담당자 역할 없음 |
| 사용자 규모 | 계정 100개, 프로그램 24개, 배정 수백~수천 건, 관리자 1~5명 |

---

## 1. 배경과 목표

### 1-1. 배경 (Fact)
- 계획안: 2026학년도 AI 유료계정 지원 — 모노플로우 신규계정 100개(GPT 50·Claude 50), 6개월, 예산 29,940,000원(299,400원×100계정). 실적 = 프로그램별 사용 인원(인수 확인 기준).
- 현재 Apps Script 버전이 완성되어 있으나 시트·스크립트·트리거·배포 관리가 운영자에게 어려워 웹 앱으로 재구축.
- OpenAI·Anthropic 소비자 약관은 계정 공유를 금지함. 시스템은 「1계정 1사용자, 순차 대여」 원칙으로 설계하되 약관 리스크는 사업 주체가 인지한 상태(설계 전제).
- ChatGPT·Claude 비밀번호를 바꾸는 공개 API는 없음(Claude.ai는 비밀번호 없는 로그인). 시스템은 비밀번호 **생성·기록·알림·추적**을 담당하고, 서비스 적용은 관리자 수작업.

### 1-2. 목표
1. 신청 → 승인 → 자동 배정 → 메일 안내 → 인수 확인 → 종료 → 회수 → 재배정의 전 과정을 관리자 화면 하나에서 처리.
2. 매일 09:00(KST) 자동 작업으로 만료·미인수·재배정·알림을 사람 개입 없이 처리.
3. 프로그램별 사용 인원, 유휴율·회전율, 대기 지표, 정지율을 언제든 조회하고 매월 1일 스냅샷을 보존.
4. 개인정보 동의·보유기간·파기까지 시스템 안에서 완결.

### 1-3. 범위 밖 (Non-goals)
- ChatGPT/Claude 계정의 비밀번호 자동 변경·자동 로그아웃(불가).
- 윤리가이드라인 시청 여부의 기술적 검증(영상 클릭 + 자기 확인으로 갈음, 확정).
- 프로그램 담당자·부서별 권한 분리(운영관리자 단일 역할, 확정).
- 다부서·다캠퍼스 확장, SSO 연동(향후).

---

## 2. 사용자와 시나리오

| 사용자 | 접점 | 하는 일 |
|---|---|---|
| 참여자(교원·직원·학생·지역민) | GitHub Pages 신청 블록, 메일 링크 | 윤리가이드라인 시청 → 신청 → 안내 메일 수신 → 2일 내 인수 확인 → 사용 → 장애 신고(필요 시) |
| 운영관리자 | `/admin` (Google 로그인) | 프로그램·계정 등록, 승인, 회수 체크리스트, 비밀번호 적용, 장애 대체, 실적 조회, 설정 |
| 시스템(Cron) | Vercel Cron → API | 매일 09:00 KST 일일 작업, 매월 1일 스냅샷 |

핵심 흐름(사용자 확정):
`프로그램 사전 등록(관리자) → 윤리가이드라인 시청(신청 전, 클릭 시 새 창 자동 연결) → 신청(드롭다운에서 프로그램 선택) → 관리자 승인 시 자동 배정 + 안내 메일 자동 발송(계정명·비밀번호 본문 삽입) → 참여자 인수 확인(2일) → 대여 종료 시 신규 비밀번호 자동 생성 + 알림 → 관리자 회수 처리 → 대기자 자동 재배정`

---

## 3. 아키텍처

```
[GitHub Pages 신청 블록] --fetch(CORS)--> [Next.js /api/public/*]
[참여자 메일 링크]  ------------------> [Next.js /ack, /incident]
[관리자 브라우저] ----Google 로그인---> [Next.js /admin/* (Server Actions)]
[Vercel Cron 00:00 UTC(=09:00 KST)] -> [Next.js /api/cron/daily, /api/cron/monthly]
                 Next.js(Vercel) --service role--> Supabase Postgres(서울)
                 Next.js(Vercel) --API-----------> Resend(메일)
```

| 구성요소 | 결정 | 근거·제약 (Fact) |
|---|---|---|
| 프론트/서버 | Next.js App Router + TS + Tailwind + shadcn/ui (사용자 `nextjs-init` 스킬로 스캐폴딩) | — |
| DB | Supabase Postgres, 리전 `ap-northeast-2`(서울) | Free: 500MB, 1주 비활동 시 일시정지, 백업 없음 / Pro $25/월~: 일일 백업 7일, 일시정지 없음 |
| 인증 | Supabase Auth Google Provider + `admins` 허용 목록 | — |
| DB 접근 | 서버(Server Actions·Route Handlers)에서 service role 키로만 접근. 브라우저에서 Supabase 직접 호출 없음, RLS는 「anon/authenticated 전부 거부」로 잠금 | 금고 노출 방지 단순화 (제안, High) |
| 메일 | Resend, 발신 도메인 인증 필요 | Free: 3,000통/월·100통/일·도메인 3개 / Pro $20/월: 50,000통/월, 일일 한도 없음 |
| 스케줄 | Vercel Cron(`vercel.json`) | Hobby: 하루 1회, 실행 시각 ±59분 / Pro: 분 단위 |
| 호스팅 | Vercel | Hobby 플랜은 비상업·개인 용도 조건. 대학 사업 적용 가능 여부는 별도 확인 필요(§13) |

---

## 4. 데이터 모델 (Supabase Postgres)

명명: 테이블·컬럼은 영문 snake_case, UI 라벨은 한글. 시각은 `timestamptz`(표시 Asia/Seoul), 날짜는 `date`.

### 4-1. 테이블

**settings** — 운영 설정(키·값)
| key | 기본값 | 설명 |
|---|---|---|
| ack_due_days | 2 | 안내 발송 후 인수 확인 기한(일). 초과 시 자동 취소 |
| account_expiry_alert_days | 14 | 계정 구독 만료 D-N 알림 |
| password_length | 10 | 자동 생성 비밀번호 길이(영문 대소문자+숫자+기호) |
| show_new_password_in_digest | false | 점검 메일에 신규 비밀번호 표시 여부 |
| suspension_rate_warn | 5 | 정지율(%) 경고 임계값 |
| admin_emails | [] | 점검 메일 수신 관리자(JSON 배열) |
| reply_to | (공용 메일) | 참여자 회신 주소 |
| from_name | 경상국립대학교 AI융합원 | 발신자 표시명 |
| from_email | noreply@<인증 도메인> | Resend 인증 도메인 주소 |
| edu_url | https://www.youtube.com/watch?v=XzMC4jGM_P0&t=2s | GNU AI 윤리가이드라인 영상 |
| rules_url / pledge_url | '' | 이용수칙·서약 문서 링크 |
| privacy_items | 이름, 소속, 구분, 이메일, 연락처 | 개인정보 고지 |
| privacy_purpose | AI 유료계정 배정·안내 및 실적 관리 | |
| privacy_period | 사업 종료 후 1년 | |
| auto_assign_on_approve | true | 승인 즉시 배정·발송 |
| target_headcount | 600 | 목표 연인원 |
| program_id_prefix | P26 | 프로그램ID 접두 |
| signup_origins | ["https://<github-pages-origin>"] | CORS 허용 오리진 |

**admins** — 운영관리자 허용 목록: `id, email(unique, lower), name, created_at, created_by`

**accounts** — 대여용 계정(공개 가능한 메타)
`id text PK`(예 GPT-001, CL-001), `service`(GPT|Claude), `kind`(운영|예비), `activated_on date`, `expires_on date`, `status`(가용|배정|회수중|정지|만료), `current_assignment_id`, `assigned_days int default 0`, `assigned_count int default 0`, `note`, `alert text`(일일 작업이 갱신), `updated_at`

**account_secrets** — 계정 금고(서버 전용, 암호화)
`account_id PK FK`, `login_email`, `password_enc`, `new_password_enc`, `password_status`(정상|변경대기), `password_changed_at`, `owns_registered_email bool`, `two_fa text`, `note`, `updated_at`
- `*_enc`는 AES-256-GCM(키 = 환경변수 `VAULT_KEY`, 32바이트 base64)으로 애플리케이션 계층에서 암호화. 복호화는 서버에서만, 관리자 화면에서 「보기」 클릭 시 복호화 + `logs`에 열람 기록 (제안, High).

**programs**
`id text PK`(P26-01…), `name text unique`, `target`(교원|직원|학생|지역민|혼합), `mode`(고정기간|배정일기준), `days int`, `start_on date`, `end_on date`, `cap int default 0`(0=무제한), `status`(시작전|진행중|완료 — 모든 전환은 관리자 드롭다운 수동), `note`, `created_at`
- 파생(뷰 `program_availability`): `avail_gpt`, `avail_claude` = 만료일 ≥ 대여종료일(배정일기준은 오늘+days)인 「가용·운영」 계정 수.

**users** — 참여자(개인정보)
`id text PK`(U-0001…), `name`, `affiliation`, `type`(교원|직원|학생|지역민), `email unique(lower)`, `phone`, `has_paid bool`, `privacy_consented_at`, `first_applied_at`, `purged_at`

**assignments** — 신청/배정 1건
`id text PK`(A260904-0001: A+YYMMDD+일련 4자리), `program_id FK`, `user_id FK`, `name`, `email`(파기 시 익명화 대상 스냅샷), `service_wish`(GPT|Claude|무관), `account_id FK null`, `service`, `status`(§5), `applied_at`, `edu_watched_at`, `approved_on`, `approved_by`, `assigned_on`, `rent_start`, `rent_end`, `notified_at`, `acknowledged_at`, `returned_at`, `chk_delete_chats bool`, `chk_delete_memory bool`, `chk_logout_all bool`, `chk_history_review bool`, `chk_password_changed bool`, `note`, `updated_at`

**incidents** — 장애
`id serial`, `account_id FK`, `assignment_id FK null`, `type`(정지|로그인불가|기타), `symptom`, `reporter`, `reported_at`, `action`, `replacement_account_id`, `status`(접수|처리중|완료), `note`

**mail_templates** — `key PK`(배정안내|접수안내), `subject`, `body`, `placeholders`(참고 문자열). 기본 문구는 §8.

**mail_queue** — 발송 대기열: `id, to_email, subject, body_text, body_html, kind`(assignment|intake|digest|incident|snapshot), `ref_id`, `status`(pending|sent|failed), `attempts`, `last_error`, `created_at`, `sent_at`
- Resend 일일 한도(Free 100통)를 넘지 않도록 대기열에서 순차 발송, 실패는 다음 일일 작업에서 재시도.

**logs** — `id, at, actor`(관리자 이메일|system|public), `action`(예 `assignment.approve`), `target_id`, `detail jsonb`

**report_snapshots** — `id, month text(YYYY-MM), generated_at, metrics jsonb, csv_program text, csv_summary text`

**alerts(뷰)** — 일일 작업 시점에 계산되는 「회수 대상」 목록: 구분(대여기간 만료|인수기한 초과), 계정ID, 로그인이메일, 배정ID, 이름, 프로그램, 대여종료일, 경과일, 비밀번호상태, 조치 안내. 테이블로 구체화(`alerts`)하여 일일 작업이 전체 재생성 (제안, High).

### 4-2. 제약·인덱스
- `assignments`: (`program_id`, `email`) 활성 상태(신청·승인·배정·사용중·회수중·회수완료) 중복 금지 — 부분 유니크 인덱스.
- `accounts.current_assignment_id`는 상태가 배정·회수중일 때만 값 존재.
- 모든 상태 컬럼은 Postgres `enum` 또는 CHECK 제약.
- ID 채번은 트랜잭션 내 `SELECT … FOR UPDATE` 또는 시퀀스 테이블(`counters(key, value)`)로 경합 방지.

---

## 5. 상태 모델

### 5-1. 배정(assignments.status)
| 상태 | 진입 | 이탈 |
|---|---|---|
| 신청 | 공개 API 접수(시청·개인정보·서약 동의 필수) | 승인 / 반려 / 취소 |
| 승인 | 관리자 승인 | 자동 배정 성공 → 배정 / 가용 계정 없음·상한 초과 → 승인 유지(대기) |
| 배정 | 계정 배정 + 안내 메일 발송(또는 대기열 등록) | 인수 확인 → 사용중 / 발송 후 `ack_due_days` 경과 → 인수기한초과 |
| 사용중 | 인수 확인 | 대여종료일 도래(일일 작업) → 회수중 / 장애 대체 시 새 배정으로 이관 |
| 회수중 | 종료일 도래 / 미인수 취소 / 관리자 수동 회수 | 5개 체크 완료 + 「회수 완료」 → 회수완료 |
| 회수완료 · 반려 · 취소 · 인수기한초과 | 종결 | — |

### 5-2. 계정(accounts.status)
| 상태 | 의미 |
|---|---|
| 가용 | 배정 가능(운영 구분, 만료일 검사 통과 시) |
| 배정 | 배정·사용중 건에 연결 |
| 회수중 | 종료·미인수·장애로 회수 대기. **신규 비밀번호 적용 전에는 재배정 금지** |
| 정지 | 서비스 측 정지(장애). 정지율 산출 대상 |
| 만료 | 구독 만료일 경과 |

### 5-3. 계정 금고(password_status)
`정상` ↔ `변경대기`(신규 비밀번호 생성됨) → 관리자가 서비스에 적용 후 「비밀번호 변경 완료」 → `정상`(password ← new_password, new_password 비움, changed_at 기록)

---

## 6. 업무 규칙 (구현 필수)

**프로그램**
- R1. 프로그램ID는 `program_id_prefix`-NN 자동 채번. 프로그램명 유일.
- R2. 대여방식 = 고정기간(start_on~end_on, 전원 동일) 또는 배정일기준(배정일부터 days일, 개인별).
- R3. 신청 페이지 드롭다운은 페이지에 고정(24개, §9-1). 공개 API `GET /api/public/programs`는 전체 프로그램을 반환하되 항목마다 `status`·`open`·`reason`·`label`·`period`를 붙인다(`lib/assign.ts:applyAvailability`). 접수 가능 = 상태 「진행중」이고 대여기간이 설정된(고정기간: 시작·종료일, 배정일기준: days>0) 프로그램뿐이며, 그 외는 사유와 함께 비활성화한다.
  | 프로그램 상태 | 대여기간 | 드롭다운 표시 | 선택 |
  |---|---|---|---|
  | 시작전 | 무관 | `이름 — 접수 준비 중` | ✕ |
  | 진행중 | 미설정 | `이름 — 접수 준비 중(대여기간 미설정)` | ✕ |
  | 진행중 | 설정 | `이름` + 대여기간 표시 | ○ |
  | 완료 | 무관 | `이름 — 접수 종료` | ✕ |
  | 미등록 | — | `이름 — 미등록` | ✕ |
  접수 API(R7~R11)도 같은 판정을 써서 표시와 실제 접수 가부가 어긋나지 않는다.
- R4. **폐지(2026-09-17).** 프로그램 상태 전환(시작전 → 진행중 → 완료)은 관리자가 프로그램 목록의 드롭다운으로 직접 바꾼다. 종료일 경과 시 자동 종료는 하지 않는다. (구: 고정기간 프로그램은 end_on 경과 시 일일 작업이 「종료」 처리)
- R5. 배정상한(cap): 배정·사용중·회수중·회수완료 건수 합이 cap에 도달하면 추가 배정 없이 승인 대기.
- R6. 2026 하반기 교육계획 24개 프로그램을 일괄 등록하는 시드 기능(이름 중복 시 생략, 대여기간·상한은 비움).

**신청(공개 API)**
- R7. 필수: programId(또는 programName), name, affiliation, type, email, eduWatched=true, privacy=true, pledge=true. 누락 시 400과 한글 메시지.
- R8. 프로그램은 ID 또는 이름으로 매칭. 미등록 → 「아직 등록되지 않은 프로그램」, 종료 → 「종료된 프로그램」, 기간 미설정 → 「접수 준비 중(대여기간 미설정)」.
- R9. 이메일은 소문자 정규화. 같은 프로그램에 활성 상태(신청·승인·배정·사용중·회수중·회수완료) 건이 있으면 중복 거부.
- R10. users upsert(이메일 기준): 이름·소속·유형·연락처·기존보유 갱신, privacy_consented_at 갱신, first_applied_at은 최초만.
- R11. 접수 성공 시 배정ID 반환 + 「접수안내」 메일 대기열 등록. 응답에 `{ok, id, period}`.
- R12. 보유 여부와 무관하게 신청 순(applied_at) 배정(확정).

**승인·배정**
- R13. 승인 = status 승인, approved_on/approved_by 기록 → `auto_assign_on_approve`가 true면 즉시 프로그램 단위 자동 배정 시도 → 성공분은 안내 메일 대기열 등록.
- R14. 자동 배정 알고리즘(프로그램별, 트랜잭션):
  1) 대여기간 = periodFor(program, 오늘) 2) 가용 풀 = status 가용 ∧ kind 운영 ∧ (expires_on 없음 ∨ expires_on ≥ 대여종료일) ∧ password_status 정상 3) 대기열 = 상태 승인, applied_at 오름차순 4) 희망 GPT/Claude는 해당 풀에서, 무관은 잔량 많은 서비스에서 5) cap 잔여 소진 시 중단 6) 배정 시 assignments(account_id, service, status 배정, assigned_on, rent_start, rent_end) + accounts(status 배정, current_assignment_id) 갱신 + 로그.
- R15. 배정일기준 프로그램은 배정일부터 days−1일까지. 고정기간 프로그램은 end_on ≤ 오늘이면 자동 배정 대상에서 제외.
- R16. 「배정안내」 메일에 계정명(로그인 이메일)·비밀번호(복호화)·대여기간·인수 확인 링크·장애 신고 링크·학습데이터 OFF 절차·회수 절차를 치환하여 발송. 발송 시 notified_at 기록. password_status가 변경대기인 계정은 발송 보류.
- R17. 반려: status 반려 + 사유 note. 취소: 관리자 수동, 계정이 연결돼 있으면 회수중으로.

**인수·만료·회수**
- R18. 인수 확인 링크 `GET /ack?id=<배정ID>&t=<HMAC>`: 토큰 검증 → 배정 상태면 acknowledged_at 기록, 사용중 전환, 완료 페이지. 이미 처리됐거나 상태 불일치면 안내만. 관리자도 화면에서 수동 인수 처리 가능.
- R19. 미인수 자동 취소: 상태 배정 ∧ notified_at 있음 ∧ acknowledged_at 없음 ∧ 경과일 ≥ ack_due_days → 인수기한초과, note에 사유·일자, 계정은 회수중 + current_assignment_id 해제.
- R20. 대여 종료: 사용중 ∧ rent_end ≤ 오늘 → 회수중, 계정 회수중.
- R21. 회수중(또는 인수기한초과로 회수중) 계정에 신규 비밀번호 자동 생성(대문자·소문자·숫자·기호 각 1자 이상 포함, 길이 password_length, 혼동 문자 제외 세트) → new_password_enc, password_status 변경대기. 이미 변경대기이거나 chk_password_changed가 true면 재생성 금지.
- R22. 알림: `alerts` 재생성 + accounts.alert 문구(⚠ 대여기간 만료(날짜, D+n) — 비밀번호 변경 필요(신규비밀번호 생성됨) / ⚠ 인수기한 초과 — 회수 필요 / 비밀번호 변경 완료 — 회수 완료 처리 필요) + 관리자 대시보드 배지 + 일일 점검 메일.
- R23. 「비밀번호 변경 완료」(관리자): password ← new_password, 정상, changed_at, chk_password_changed=true, 로그.
- R24. 회수 체크리스트 5개(대화삭제·메모리삭제·전체로그아웃·대화기록점검·비밀번호변경)가 모두 true여야 「회수 완료」 가능 → returned_at, 회수완료, 계정 가용·current 해제 → 즉시 해당 프로그램(및 대기 중 다른 프로그램) 자동 재배정 시도.
- R25. 계정 통계: 배정일수 = 각 배정의 (rent_start 또는 assigned_on) ~ (returned_at 또는 rent_end 또는 오늘, 오늘 초과 시 오늘) 일수 합(취소·반려 제외), 배정횟수 = 건수. 일일 작업이 갱신.

**장애**
- R26. 장애 신고 링크 `GET /incident?id=<배정ID>&t=<HMAC>` → 유형(정지|로그인불가|기타)·증상 입력 → incidents 기록 + 계정 상태(정지 유형이면 정지) + 관리자 즉시 메일.
- R27. 대체: 관리자가 장애 건 선택 → 예비(kind 예비) 우선, 없으면 가용 운영 계정 중 같은 서비스로 자동 선택 → 기존 배정은 회수중(비밀번호 생성 규칙 적용), 새 배정 건 생성(같은 프로그램·사용자·대여기간 승계) + 안내 메일. incidents.status 완료, replacement_account_id.
- R28. 정지율 = 상태 정지 계정 / 전체 계정 × 100. `suspension_rate_warn` 초과 시 대시보드·점검 메일에 「업체 협의 필요」 경고.

**실적·보고**
- R29. 지표 정의(§10). 매월 1일 스냅샷: metrics JSON + 프로그램별/요약 CSV 저장 + 관리자 메일(CSV 첨부). 관리자 화면에서 「지금 생성」 가능.
- R30. 개인정보 파기: `privacy_period` 경과(운영자 판단, 버튼 실행) 시 users의 name·email·phone과 assignments의 name·email을 「(파기)」로 치환, purged_at 기록, 로그. 유형·소속·ID는 실적용으로 유지.

**공통**
- R31. 모든 상태 변경은 logs에 actor·action·target·detail 기록.
- R32. 일일 작업 순서(§11)는 멱등: 같은 날 두 번 실행해도 결과 동일.
- R33. 모든 시간 판단은 Asia/Seoul 기준 「오늘」.

---

## 7. 화면 사양

### 7-1. 공개(참여자)
| 경로 | 내용 |
|---|---|
| GitHub Pages 삽입 블록 | 기존 `signup-snippet.html` 유지. STEP 1 윤리가이드라인 「영상 보기」(새 창) → 「시청 완료 확인」 체크 → STEP 2 활성화. 프로그램 드롭다운 24개 고정(optgroup: 학생·교원·직원·윤리·재직자·지역민교육), 이름·구분·소속·연락처·이메일·희망 서비스·보유 여부, 개인정보 동의 블록(항목·목적·기간은 API 값), 서약 체크, 2일 내 인수 확인 안내. 접수 성공 시 **입력 내역 전부 삭제 + 팝업**(「입력하신 이메일 ○○로 계정과 비밀번호를 보내드릴 예정」, 접수번호·대여기간, 2일 인수 확인 안내). 변경점: `WEBAPP_URL` → 새 API 베이스 URL, 요청은 `application/json`(CORS preflight 허용). |
| `/ack` | 인수 확인 결과 페이지(성공/이미 처리/링크 오류) |
| `/incident` | 장애 신고 폼(접수번호 표시, 유형·증상) → 접수 완료 페이지 |
| `/apply`(선택) | 삽입 블록과 동일 기능의 자체 페이지(GitHub Pages 장애 시 대체 링크) (제안, Mid) |

### 7-2. 관리자 `/admin` (Google 로그인, admins 목록만 통과)
| 메뉴 | 기능 |
|---|---|
| 대시보드 | 오늘 할 일: 승인 대기 n, 미배정 승인 n, 회수 대상(만료/미인수) 목록, 변경대기 비밀번호 n, 장애 미처리 n, 정지율 경고, 구독 만료 D-14 계정, 메일 대기열 상태 |
| 신청·배정 | 목록(프로그램·상태·이름·이메일·계정·기간·인수·발송 필터/검색), 다중 선택 → 승인(자동 배정·발송) / 반려(사유) / 취소, 행 상세: 인수 확인 처리, 회수 체크리스트 5개 토글, 비밀번호 변경 완료, 회수 완료, 안내 메일 재발송, 메일 미리보기, 비고 |
| 프로그램 | 목록(배정가능 GPT/Claude, 배정 현황/상한), 등록·수정(이름·대상·방식·기간·상한·상태), 「하반기 24개 일괄 등록」, 종료 처리 |
| 계정 | 목록(상태·서비스·구분·만료일·현재 배정·배정일수·횟수·알림), 등록·CSV 가져오기(계정ID·서비스·구분·로그인이메일·비밀번호·활성화일·만료일·등록이메일소유·2FA), 금고 보기(클릭 시 복호화·열람 로그), 신규 비밀번호 생성(선택 계정), 상태 변경 |
| 사용자 | 목록·검색, 동의 일시, 파기 여부, 「개인정보 파기 실행」 |
| 장애 | 목록·상세, 「대체 계정 배정」, 상태 변경, 유형별 건수·정지율 |
| 실적 | §10 지표 표(프로그램별·요약), 기간 필터, CSV 다운로드, 월별 스냅샷 목록·「지금 생성」 |
| 설정 | settings 편집, 메일 템플릿 편집·미리보기(치환자 목록 표시), 관리자 추가·제거, CORS 오리진, 발신 테스트 메일 |
| 로그 | 시간·실행자·동작·대상·상세 검색 |

UI 원칙: 한글 라벨, shadcn `DataTable`(정렬·필터·다중 선택), 상태는 Badge 색상(신청 회색·승인 파랑·배정 남색·사용중 초록·회수중 주황·인수기한초과/반려/취소 빨강·회수완료 회색), 위험 동작은 확인 Dialog, 모든 처리 결과는 Toast.

---

## 8. 메일 사양 (Resend)

공통: From = `from_name <from_email>`(인증 도메인), Reply-To = `reply_to`, 텍스트+간단 HTML. 치환자는 `{이름}` 형식 유지(템플릿 편집 호환).

| 템플릿 | 발송 시점 | 치환자 |
|---|---|---|
| 배정안내 | 자동 배정 직후(대기열) / 재발송 / 장애 대체 | {이름} {프로그램명} {서비스명} {로그인URL} {계정ID} {계정명} {비밀번호} {대여시작일} {대여종료일} {인수확인링크} {장애신고링크} {인수기한} {학습데이터OFF절차} {회수절차} {이용수칙URL} {서약문URL} {접수번호} |
| 접수안내 | 신청 접수 직후 | {이름} {프로그램명} {접수번호} {대여기간} {대여시작일} {대여종료일} {윤리가이드라인URL} |
| 일일 점검(관리자) | 일일 작업 말미 | 승인 대기·미배정·오늘 만료·경과·미인수 회수·신규 비밀번호(설정 시)·장애·정지율 경고·구독 만료 임박·메일 대기열 |
| 장애 신고(관리자) | 신고 접수 즉시 | 접수번호·계정·유형·증상·신고자 |
| 월간 스냅샷(관리자) | 매월 1일 | 요약 지표 + CSV 첨부 |

기본 문구(Apps Script 본 그대로 시드):

**배정안내** 제목 `[AI융합원] {프로그램명} — AI 유료계정({서비스명}) 배정 안내`
```
{이름} 님, 안녕하세요. 경상국립대학교 AI융합원입니다.
{프로그램명} 참여자께 AI 유료계정을 아래와 같이 배정하였습니다.

■ 서비스: {서비스명} ({로그인URL})
■ 계정명(로그인 이메일): {계정명}
■ 비밀번호: {비밀번호}
■ 대여기간: {대여시작일} ~ {대여종료일}

① 인수 확인(필수) — 아래 링크를 눌러 계정을 인수했음을 확인해 주세요.
{인수확인링크}
※ 안내일로부터 {인수기한}일 내 인수 확인이 없으면 배정이 자동 취소되고 대기자에게 재배정됩니다.

② 첫 로그인 후 반드시: {학습데이터OFF절차}

③ 로그인이 되지 않거나 계정이 정지된 경우 — 장애 신고
{장애신고링크}

④ 이용 수칙
· 계정은 배정받은 본인만 사용하며 타인에게 공유하지 않습니다.
· 개인정보·미공개 연구자료·내부 문서를 입력하지 않습니다.
· GNU AI 윤리가이드라인을 준수합니다. {이용수칙URL}

⑤ 대여 종료일({대여종료일})까지 할 일
· 본인 산출물(프롬프트·결과)은 개인 저장소에 백업
· {회수절차}
· 종료 후 AI융합원이 비밀번호를 변경하여 접근을 차단합니다.

문의: AI융합원 (055-772-4857)
```
서비스별 치환값: 로그인URL = chatgpt.com / claude.ai. 학습데이터OFF절차(GPT) = 「설정 > 데이터 제어 > "모두를 위한 모델 개선" 끄기」, (Claude) = 「설정 > 개인정보 > "Claude 개선에 도움" 끄기」. 회수절차(GPT) = 「설정 > 데이터 제어 > 모든 채팅 삭제, 개인 맞춤 설정 > 메모리 모두 삭제, 보안 > 모든 기기에서 로그아웃」, (Claude) = 「모든 대화 삭제, 메모리·프로젝트 삭제, 모든 기기 로그아웃」.

**접수안내** 제목 `[AI융합원] {프로그램명} — AI 유료계정 신청 접수 안내`
```
{이름} 님, {프로그램명} AI 유료계정 신청이 접수되었습니다. (접수번호 {접수번호})

· 대여기간: {대여기간}
· 관리자 승인 후 계정 정보(계정명·비밀번호·대여기간)를 이메일로 안내드립니다.
· 신청 순으로 배정되며, 가용 계정이 없으면 회수되는 대로 순차 배정됩니다.

문의: AI융합원 (055-772-4857)
```

링크 토큰: `t = HMAC-SHA256(secret=APP_SECRET, message=<배정ID>)`의 hex 앞 24자(장애 신고는 `inc:<배정ID>`). 링크는 만료 없음, 상태 검사로 재사용 방지.

---

## 9. 시드 데이터

### 9-1. 프로그램 24개 (출처: 하반기 교육계획 담당자지정표 2026.8.26. 회의 결과)
| 구분 | 프로그램명 | 대상 | 운영시기 |
|---|---|---|---|
| 학생교육 | 초·중급 온라인 특강 2차 | 학생 | 2026. 8. |
| 학생교육 | 초·중급 온라인 특강 3차 | 학생 | 2026. 11. |
| 학생교육 | 초·중급 온라인 특강 4차 | 학생 | 2027. 1. |
| 학생교육 | 중·고급 GNU AI Pioneer | 학생 | 2026. 9.~11. |
| 학생교육 | 중급 프로젝트 중심 AI 활용 캠프 | 학생 | 2026. 11. |
| 학생교육 | 고급 프로젝트 중심 AI 활용 캠프 | 학생 | 2027. 1. |
| 학생교육 | 중·고급 워크숍 2차 | 학생 | 2026. 9.~10. |
| 학생교육 | 중·고급 워크숍 3차 | 학생 | 2026. 12.~2027. 1. |
| 교원교육 | 초·중·고급 AI활용 연구모임 운영 | 교원 | 2026. 9.~11. |
| 교원교육 | AXIS 인증 교수법 워크숍 | 교원 | 2026. 10. |
| 직원교육 | 초급 업무 효율화 기초 외 교육 2차 | 직원 | 2026. 9.~10. |
| 직원교육 | 중급 교육과정 | 직원 | 2026. 10.~11. |
| 직원교육 | 고급 교육과정 | 직원 | 2026. 12.~2027. 1. |
| 직원교육 | 초급 온라인 교육과정 | 직원 | 2026. 9.~12. |
| 직원교육 | 중·고급 워크숍(2회~3회) | 직원 | 2026. 12.~2027. 2. |
| 윤리교육 | AI 윤리교육(인증) | 혼합 | 2026. 9. |
| 윤리교육 | AI활용 윤리 | 혼합 | 미정 |
| 재직자교육 | 중·고급 GNU AI 노바투스 아카데미아 프로그램 | 지역민 | 2026. 9.~2027. 1. |
| 재직자교육 | 초·중급 RAG 기반 리더십 AI 활용 교육 | 지역민 | 2026. 10.~2027. 1. |
| 재직자교육 | 초급 산업체 재직자 AI 교육(TP 협업) | 지역민 | 2026. 10. |
| 재직자교육 | 공공기관 대상 AI활용 교육 | 지역민 | 2026. 9.~2027. 1. |
| 지역민교육 | 초·중급 생성형 AI 활용 교육 서비스를 위한 강사 양성 | 지역민 | 2026. 10.~12. |
| 지역민교육 | 초·중급 교육청 연계 ROBLOX 기반 AI 활용 교육 | 지역민 | 2026. 11.~2027. 1. |
| 지역민교육 | 초·중급 정보 소외 계층 대상 맞춤형 AI 활용 교육 | 지역민 | 2026. 11.~2027. 1. |

비고에 「구분 / 운영시기 / 대여기간 입력 필요」 기록. 재직자교육의 대상 「지역민」은 제안(Mid) — 관리자가 변경 가능.

### 9-2. 그 외
- settings 기본값(§4-1), mail_templates 기본 문구(§8), admins 첫 관리자(환경변수 `INITIAL_ADMIN_EMAIL`).
- 계정 100개는 납품 후 CSV 가져오기(§7-2 계정). 개발용 샘플: GPT-001~003, CL-001~003.

---

## 10. 실적 지표 정의

**프로그램별(행 = 프로그램)**: 신청(전체 건), 승인, 배정, 사용 인원(acknowledged_at 있는 건 = **공식 실적**), 회수완료, GPT/Claude 사용 인원, 인수기한초과, 회수 완료율(회수완료 / (회수완료+회수중)), 대기 인원(승인 상태), 승인→배정 대기일수 평균·최대.

**요약**: 누계 사용 인원 vs 목표 600(달성률), 대상별(교원·직원·학생·지역민) 사용 인원, 서비스별, 계정·월 환산(배정일수 합/30), 평균 유휴율(1 − 배정일수/가용일수(활성화일~min(만료일, 오늘))), 평균 회전율(배정횟수 평균), 현재 대기 인원·평균 대기일수, 미인수율(인수기한초과/배정 총계), 장애 유형별 건수, 정지율, 계정 현황(가용·배정·회수중·정지·만료).

구현: SQL 뷰(`v_report_program`, `v_report_summary`)로 계산, 화면·CSV·스냅샷이 같은 뷰를 사용.

---

## 11. 배치(Cron)

`vercel.json`
```json
{ "crons": [
  { "path": "/api/cron/daily",   "schedule": "0 0 * * *" },
  { "path": "/api/cron/monthly", "schedule": "0 0 1 * *" }
] }
```
(UTC 00:00 = KST 09:00. Hobby 플랜은 ±59분 오차, 하루 1회 제한 — 본 설계는 하루 1회로 충분.)

인증: 헤더 `Authorization: Bearer ${CRON_SECRET}` 검증. 관리자 화면 「일일 작업 지금 실행」 버튼도 같은 함수 호출.

`/api/cron/daily` 순서(트랜잭션 단위로 분리, 각 단계 로그):
1. (폐지) 프로그램 자동 종료 — R4 폐지, 상태 전환은 관리자 수동
2. 미인수 자동 취소(R19)
3. 대여 종료 → 회수중(R20) + 신규 비밀번호 생성(R21) + alerts·accounts.alert 재생성(R22)
4. 승인 대기 자동 배정(R14, 모든 「진행중」 프로그램)
5. 메일 대기열 발송(일일 한도 고려, 실패 재시도)
6. 계정 통계 갱신(R25)
7. 구독 만료 D-`account_expiry_alert_days` 계정 표시, 만료일 경과 계정 → 만료
8. 관리자 일일 점검 메일(내용 §8)

`/api/cron/monthly`: 실적 스냅샷 생성·저장·메일(R29).

---

## 12. API 명세

### 12-1. 공개(CORS: `signup_origins`만 허용, `OPTIONS` 처리)
| 메서드·경로 | 요청 | 응답 |
|---|---|---|
| GET `/api/public/programs` | — | `{ok, programs:[{id,name,target,mode,days,start,end,status,open,reason,label,period}], eduUrl, privacy:{items,purpose,period}}` (전체 프로그램, R3 표) |
| POST `/api/public/apply` | `{programId, programName, name, affiliation, type, email, phone, service, hasPaid, pledge, privacy, eduWatched, eduWatchedAt}` | 성공 `{ok:true, id, period}` / 실패 `{ok:false, msg}` (R7~R11) |
| GET `/ack?id&t` | — | HTML 페이지(R18) |
| GET/POST `/incident?id&t` | 폼 | HTML 페이지(R26) |

보호: 공개 POST는 IP당 분당 10회 제한(Upstash 없이 메모리/DB 카운터로 충분, 제안 Mid), honeypot 필드, zod 검증, 이메일 형식 검사.

### 12-2. 관리자(Server Actions, 세션 필수 + admins 검사)
프로그램 CRUD·시드, 계정 CRUD·CSV 가져오기·금고 조회·비밀번호 생성, 배정 승인/반려/취소/수동 배정/인수 처리/체크리스트/비밀번호 변경 완료/회수 완료/재발송/미리보기, 장애 처리/대체, 실적 조회/CSV/스냅샷, 설정·템플릿·관리자, 로그 조회, 일일 작업 수동 실행, 개인정보 파기.

### 12-3. 내부
`/api/cron/daily`, `/api/cron/monthly` (CRON_SECRET), `/api/health`.

---

## 13. 보안·개인정보·운영

- 관리자 화면·Server Actions는 미들웨어에서 세션 + `admins` 검사. 미허용 이메일은 로그인 후 「권한 없음」.
- DB 접근은 서버 전용 service role. RLS는 모든 테이블에서 anon·authenticated 거부(방어 계층).
- 금고 암호화 키 `VAULT_KEY`, 링크 서명 `APP_SECRET`, `CRON_SECRET`, `RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`는 Vercel 환경변수. 코드·로그에 비밀번호 평문 금지(메일 본문 생성 시에만 복호화, mail_queue의 body에는 저장 후 발송 완료 시 본문 삭제 — 제안, High).
- 금고 열람·메일 발송·비밀번호 변경은 logs에 actor 포함 기록.
- 개인정보: 수집 항목·목적·기간 고지, 동의 일시 기록, 파기 기능(R30). 로그에는 이름·배정ID 수준만.
- 백업: Supabase Pro 일일 백업(권장) 또는 관리자 「전체 CSV 내보내기」 주 1회 수동(Free 사용 시).
- 확인 필요 사항(구현 전 결정):
  1) Resend 발신 도메인 — DNS 설정 가능한 도메인 확보(대학 도메인 하위 or 별도 도메인).
  2) Supabase Free vs Pro — 6개월 운영이면 Pro 권장(일시정지·백업) (Opinion, High).
  3) Vercel Hobby 비상업 조건 적용 가능 여부 — 불가 시 Pro($20/월/사용자) 또는 대학 서버 Docker 배포.
  4) 계정 통제권(등록 이메일·2FA) — 미확보 계정은 비밀번호 변경 불가 → 프로그램 단위 고정 배정으로 운영.

---

## 14. 구현 계획 (Claude Code 단계별)

각 단계는 「완료 기준」을 통과해야 다음 단계로. 단계마다 `npm run build`·`npm run test` 통과.

| 단계 | 산출물 | 완료 기준 |
|---|---|---|
| 0. 스캐폴딩 | `nextjs-init` 스킬로 프로젝트 생성, Supabase 프로젝트(서울)·Resend·Vercel 연결, `.env.example`, `CLAUDE.md`(§15) | 로컬 실행, Supabase 연결 확인, 빈 `/admin` Google 로그인 성공 |
| 1. 데이터·인증 | 마이그레이션 SQL(§4 전체, enum, 인덱스, 뷰), 시드 스크립트(§9), 암호화 유틸, admins 미들웨어 | 시드 후 프로그램 24개·설정·템플릿 존재, 비허용 계정 차단 |
| 2. 프로그램·계정·금고 | `/admin/programs`, `/admin/accounts`(CSV 가져오기, 금고 보기, 비밀번호 생성) | 계정 CSV 6건 가져오기 → 금고 복호화 표시 → 열람 로그 기록 |
| 3. 신청·승인·배정·메일 | 공개 API 2종(CORS), `signup-snippet.html` 연결 수정, 승인/자동 배정/메일 대기열/Resend 발송, `/admin/assignments` | GitHub Pages(또는 로컬 HTML)에서 신청 → 관리자 승인 → 계정 배정 → 실제 메일 수신(계정명·비밀번호 포함) |
| 4. 인수·만료·회수 | `/ack`, 미인수 취소, 종료 → 회수중, 비밀번호 생성, alerts, 체크리스트·회수 완료·재배정, `/api/cron/daily` | 시나리오 T1~T6(§16) 통과 |
| 5. 장애·실적·스냅샷·파기 | `/incident`, 대체 배정, 정지율, 실적 뷰·화면·CSV, `/api/cron/monthly`, 개인정보 파기, 로그 화면 | 시나리오 T7~T10 통과, 스냅샷 메일 수신 |
| 6. 배포·이관·시범운영 | Vercel 배포·Cron 등록·환경변수, 기존 시트 데이터(있을 경우) CSV 이관, 시범 프로그램 1개·테스트 계정 2~3개 전 과정 실행 | 시범 운영 체크리스트 전 항목 완료, 구축가이드(운영 매뉴얼) 갱신 |

---

## 15. Claude Code 작업 지침 (CLAUDE.md에 넣을 내용)

```
# 프로젝트: AI 유료계정 관리시스템 (GNU AI융합원)
- 사양: docs/PRD.md 가 단일 진실. 규칙 번호(R1~R33)를 커밋 메시지·주석에 인용.
- 스택: Next.js App Router + TS + Tailwind + shadcn/ui, Supabase(service role, 서버 전용), Resend, Vercel Cron.
- 시간대: 모든 날짜 계산은 Asia/Seoul. 유틸 lib/date.ts 의 todayKST() 만 사용.
- DB 접근: lib/db.ts 의 서버 클라이언트만. 브라우저 번들에 Supabase 키·VAULT_KEY 절대 포함 금지.
- 상태 전이: lib/state.ts 의 transition() 을 통해서만 변경, 항상 logs 기록.
- 메일: 직접 발송 금지. mail_queue 에 넣고 lib/mail/dispatch.ts 가 발송.
- 테스트: 도메인 로직(배정·만료·비밀번호·지표)은 순수 함수로 분리하고 Vitest 단위 테스트, 흐름은 Playwright.
- 한글 UI, 라벨은 lib/labels.ts 에서 관리.
- 비밀 값은 .env.local, 예시는 .env.example 에 유지.
```

권장 디렉터리
```
app/
  (public)/ack/page.tsx, (public)/incident/page.tsx, (public)/apply/page.tsx
  admin/(dashboard|assignments|programs|accounts|users|incidents|reports|settings|logs)/
  api/public/programs/route.ts, api/public/apply/route.ts
  api/cron/daily/route.ts, api/cron/monthly/route.ts
lib/ db.ts, crypto.ts, date.ts, state.ts, ids.ts, assign.ts, password.ts, alerts.ts, report.ts, mail/(templates.ts, render.ts, dispatch.ts), auth.ts
supabase/migrations/*.sql, supabase/seed.sql
scripts/ seed-programs.ts, import-accounts.ts
docs/ PRD.md, 운영매뉴얼.md
public/signup-snippet.html   (GitHub Pages 삽입용 사본)
```

환경변수: `NEXT_PUBLIC_APP_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`(Auth 전용), `RESEND_API_KEY`, `VAULT_KEY`, `APP_SECRET`, `CRON_SECRET`, `INITIAL_ADMIN_EMAIL`.

---

## 16. 테스트 시나리오 (수용 기준)

| # | 시나리오 | 기대 결과 |
|---|---|---|
| T1 | 기간 미설정 프로그램으로 신청 | 400 「접수 준비 중(대여기간 미설정)」, 페이지에서는 옵션 비활성 |
| T2 | 정상 신청 2건(같은 이메일·같은 프로그램) | 1건 접수 + 접수안내 메일, 2번째 중복 거부 |
| T3 | 승인(가용 GPT 1·Claude 1, 희망 GPT·무관·Claude 3명) | 신청 순으로 2명 배정(희망 반영), 1명 승인 대기, 배정안내 메일 2통(계정명·비밀번호 포함) |
| T4 | 인수 링크 클릭 / 위조 토큰 | 사용중 전환·acknowledged_at 기록 / 「링크가 올바르지 않습니다」 |
| T5 | 발송 2일 경과 미인수 상태에서 일일 작업 | 인수기한초과, 계정 회수중 + 신규 비밀번호 변경대기, alerts 1건, 점검 메일에 「미인수 회수」 |
| T6 | 대여종료일 경과 → 비밀번호 변경 완료 → 5개 체크 → 회수 완료 | 회수중 → 회수완료, 계정 가용, 대기자에게 자동 재배정 + 메일, 재생성 없음(pwDone) |
| T7 | 장애 신고(정지) → 대체 | incidents 기록·관리자 메일, 예비 계정으로 새 배정 + 메일, 기존 계정 정지, 정지율 갱신 |
| T8 | 정지율 5% 초과 | 대시보드·점검 메일 경고 |
| T9 | 월간 스냅샷 | report_snapshots 1행, CSV 2종, 관리자 메일 첨부 |
| T10 | 개인정보 파기 | 이름·이메일·연락처 「(파기)」, purged_at, 실적 수치 불변 |
| T11 | 일일 작업 2회 연속 실행 | 2회째 변경 0건(멱등) |
| T12 | 비허용 Google 계정 로그인 | `/admin` 접근 차단 |
| T13 | 100건 배정 메일 일괄 | Resend 일일 한도 내 순차 발송, 초과분 다음 날 재시도, 상태 추적 |

---

## 17. 결정 요약 (대화에서 확정된 사항)

| 항목 | 결정 |
|---|---|
| 대여 단위·기간 | 프로그램별, 관리자가 설정(고정기간 또는 배정일기준) |
| 배정 순서 | 신청 순, 기존 계정 보유 여부 무관 |
| 비밀번호 전달 | 배정 안내 메일 본문에 계정명·비밀번호 기재 |
| 절차 | 윤리가이드라인 시청(신청 전, 클릭 시 자동 연결) → 신청 → 승인 시 자동 배정·자동 발송 → 이메일 안내 |
| 시청 검증 | 별도 확인 절차 없음(체크 확인) |
| 인수 기한 | 2일, 초과 시 자동 취소·회수·대기자 재배정 |
| 회수 체크 | 대화삭제·메모리삭제·전체로그아웃·대화기록점검·비밀번호변경 5개 |
| 비밀번호 | 대여 종료·미인수 시 자동 생성(영문·숫자·기호 혼합 10자), 알림 표시, 관리자 적용 |
| 회수안내 메일 | 없음(삭제) |
| 담당자 | 운영관리자만, 담당자 추가 기능. 프로그램 담당자 없음 |
| 실적 | 프로그램별 사용 인원(인수 확인 기준) + 유휴율·회전율·대기·정지율, 매월 1일 스냅샷 |
| 개인정보 | 동의 필수, 보유기간 사업 종료 후 1년, 파기(익명화) |
| 장애 | 신고 링크, 유형별 건수, 정지율 5% 경고 |
| 프로그램 목록 | 하반기 교육계획 24개, 신청 페이지 드롭다운 고정 |
| 신청 완료 UX | 입력 내역 전부 삭제 + 팝업 안내 |
| 재구축 스택 | Next.js + Supabase + Vercel, Google 로그인, DB 금고, GitHub Pages 삽입 |

---

## 18. 변경 이력

| 일자 | 변경 | 사유 |
|---|---|---|
| 2026-09-17 | 프로그램 상태 「진행\|종료」 → 「시작전\|진행중\|완료」 3단계, 목록 드롭다운으로 즉시 전환. R4(자동 종료) 폐지, R3 을 상태별 표시 표로 개정. 마이그레이션 `0002_program_status.sql`(기존 기간 미설정 프로그램 → 시작전) | 관리자 요청 — 접수 개시·종료 시점을 담당자가 직접 통제 |
