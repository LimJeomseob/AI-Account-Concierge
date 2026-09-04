-- AI 유료계정 관리시스템 — 초기 스키마 (PRD §4)
-- 경상국립대학교 AI융합원
-- 명명: 테이블·컬럼 영문 snake_case, 값(상태 등)은 한글 enum, UI 라벨은 lib/labels.ts

-- ---------------------------------------------------------------------------
-- 0. 확장
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. enum (PRD §5 상태 모델)
-- ---------------------------------------------------------------------------
do $$ begin
  create type account_service   as enum ('GPT', 'Claude');
exception when duplicate_object then null; end $$;
do $$ begin
  create type account_kind      as enum ('운영', '예비');
exception when duplicate_object then null; end $$;
do $$ begin
  create type account_status    as enum ('가용', '배정', '회수중', '정지', '만료');
exception when duplicate_object then null; end $$;
do $$ begin
  create type password_status   as enum ('정상', '변경대기');
exception when duplicate_object then null; end $$;
do $$ begin
  create type program_target    as enum ('교원', '직원', '학생', '지역민', '혼합');
exception when duplicate_object then null; end $$;
do $$ begin
  create type program_mode      as enum ('고정기간', '배정일기준');
exception when duplicate_object then null; end $$;
do $$ begin
  create type program_status    as enum ('진행', '종료');
exception when duplicate_object then null; end $$;
do $$ begin
  create type user_type         as enum ('교원', '직원', '학생', '지역민');
exception when duplicate_object then null; end $$;
do $$ begin
  create type service_wish      as enum ('GPT', 'Claude', '무관');
exception when duplicate_object then null; end $$;
do $$ begin
  create type assignment_status as enum ('신청', '승인', '배정', '사용중', '회수중', '회수완료', '반려', '취소', '인수기한초과');
exception when duplicate_object then null; end $$;
do $$ begin
  create type incident_type     as enum ('정지', '로그인불가', '기타');
exception when duplicate_object then null; end $$;
do $$ begin
  create type incident_status   as enum ('접수', '처리중', '완료');
exception when duplicate_object then null; end $$;
do $$ begin
  create type mail_kind         as enum ('assignment', 'intake', 'digest', 'incident', 'snapshot');
exception when duplicate_object then null; end $$;
do $$ begin
  create type mail_status       as enum ('pending', 'sent', 'failed');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. 채번 카운터 (PRD §4-2: 경합 방지)
-- ---------------------------------------------------------------------------
create table if not exists counters (
  key   text primary key,
  value bigint not null default 0
);

-- 원자적 채번. 같은 키에 대해 동시 호출해도 값이 겹치지 않는다.
create or replace function next_counter(p_key text)
returns bigint
language plpgsql
as $$
declare v bigint;
begin
  insert into counters(key, value) values (p_key, 1)
  on conflict (key) do update set value = counters.value + 1
  returning value into v;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- 3. 운영 설정 / 관리자
-- ---------------------------------------------------------------------------
create table if not exists settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists admins (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  name       text,
  created_at timestamptz not null default now(),
  created_by text,
  constraint admins_email_lower check (email = lower(email))
);

-- ---------------------------------------------------------------------------
-- 4. 계정 / 금고
-- ---------------------------------------------------------------------------
create table if not exists accounts (
  id                    text primary key,               -- GPT-001, CL-001
  service               account_service not null,
  kind                  account_kind not null default '운영',
  activated_on          date,
  expires_on            date,
  status                account_status not null default '가용',
  current_assignment_id text,
  assigned_days         int not null default 0,
  assigned_count        int not null default 0,
  note                  text,
  alert                 text,                            -- 일일 작업이 갱신 (R22)
  updated_at            timestamptz not null default now()
);

-- 계정 금고: 서버 전용. *_enc 는 AES-256-GCM(VAULT_KEY) 애플리케이션 계층 암호화.
create table if not exists account_secrets (
  account_id            text primary key references accounts(id) on delete cascade,
  login_email           text,
  password_enc          text,
  new_password_enc      text,
  password_status       password_status not null default '정상',
  password_changed_at   timestamptz,
  owns_registered_email boolean not null default false,
  two_fa                text,
  note                  text,
  updated_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 5. 프로그램
-- ---------------------------------------------------------------------------
create table if not exists programs (
  id         text primary key,                 -- P26-01 …
  name       text not null unique,
  target     program_target not null default '혼합',
  mode       program_mode not null default '고정기간',
  days       int not null default 0,
  start_on   date,
  end_on     date,
  cap        int not null default 0,           -- 0 = 무제한
  status     program_status not null default '진행',
  note       text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 6. 참여자
-- ---------------------------------------------------------------------------
create table if not exists users (
  id                   text primary key,       -- U-0001 …
  name                 text not null,
  affiliation          text,
  type                 user_type not null,
  email                text not null unique,
  phone                text,
  has_paid             boolean not null default false,
  privacy_consented_at timestamptz,
  first_applied_at     timestamptz,
  purged_at            timestamptz,
  constraint users_email_lower check (email = lower(email))
);

-- ---------------------------------------------------------------------------
-- 7. 배정(신청 1건)
-- ---------------------------------------------------------------------------
create table if not exists assignments (
  id                    text primary key,      -- A260904-0001
  program_id            text not null references programs(id),
  user_id               text not null references users(id),
  name                  text not null,
  email                 text not null,
  service_wish          service_wish not null default '무관',
  account_id            text references accounts(id),
  service               account_service,
  status                assignment_status not null default '신청',
  applied_at            timestamptz not null default now(),
  edu_watched_at        timestamptz,
  approved_on           date,
  approved_by           text,
  assigned_on           date,
  rent_start            date,
  rent_end              date,
  notified_at           timestamptz,
  acknowledged_at       timestamptz,
  returned_at           timestamptz,
  chk_delete_chats      boolean not null default false,
  chk_delete_memory     boolean not null default false,
  chk_logout_all        boolean not null default false,
  chk_history_review    boolean not null default false,
  chk_password_changed  boolean not null default false,
  note                  text,
  updated_at            timestamptz not null default now()
);

alter table accounts
  drop constraint if exists accounts_current_assignment_fk;
alter table accounts
  add constraint accounts_current_assignment_fk
  foreign key (current_assignment_id) references assignments(id) on delete set null;

-- R? accounts.current_assignment_id 는 상태가 배정·회수중일 때만 값 존재 (PRD §4-2)
alter table accounts
  drop constraint if exists accounts_current_assignment_status;
alter table accounts
  add constraint accounts_current_assignment_status check (
    (status in ('배정', '회수중')) or current_assignment_id is null
  );

-- 같은 프로그램에 활성 상태 중복 신청 금지 (PRD §4-2, R9)
create unique index if not exists assignments_active_unique
  on assignments (program_id, email)
  where status in ('신청', '승인', '배정', '사용중', '회수중', '회수완료');

create index if not exists assignments_status_idx      on assignments (status);
create index if not exists assignments_program_idx     on assignments (program_id);
create index if not exists assignments_applied_idx     on assignments (applied_at);
create index if not exists assignments_account_idx     on assignments (account_id);
create index if not exists accounts_status_idx         on accounts (status, kind, service);

-- ---------------------------------------------------------------------------
-- 8. 장애
-- ---------------------------------------------------------------------------
create table if not exists incidents (
  id                     bigserial primary key,
  account_id             text references accounts(id),
  assignment_id          text references assignments(id),
  type                   incident_type not null default '기타',
  symptom                text,
  reporter               text,
  reported_at            timestamptz not null default now(),
  action                 text,
  replacement_account_id text references accounts(id),
  status                 incident_status not null default '접수',
  note                   text
);

-- ---------------------------------------------------------------------------
-- 9. 메일
-- ---------------------------------------------------------------------------
create table if not exists mail_templates (
  key          text primary key,               -- 배정안내 | 접수안내
  subject      text not null,
  body         text not null,
  placeholders text,
  updated_at   timestamptz not null default now()
);

create table if not exists mail_queue (
  id         bigserial primary key,
  to_email   text not null,
  subject    text not null,
  body_text  text,
  body_html  text,
  kind       mail_kind not null,
  ref_id     text,
  status     mail_status not null default 'pending',
  attempts   int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);
create index if not exists mail_queue_status_idx on mail_queue (status, created_at);

-- ---------------------------------------------------------------------------
-- 10. 로그 / 알림 / 스냅샷
-- ---------------------------------------------------------------------------
create table if not exists logs (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  actor     text not null,                     -- 관리자 이메일 | system | public
  action    text not null,                     -- 예: assignment.approve
  target_id text,
  detail    jsonb
);
create index if not exists logs_at_idx     on logs (at desc);
create index if not exists logs_action_idx on logs (action);

-- 일일 작업이 전체 재생성하는 「회수 대상」 목록 (R22)
create table if not exists alerts (
  id              bigserial primary key,
  category        text not null,               -- 대여기간 만료 | 인수기한 초과
  account_id      text,
  login_email     text,
  assignment_id   text,
  name            text,
  program_name    text,
  rent_end        date,
  elapsed_days    int,
  password_status text,
  guide           text,
  generated_at    timestamptz not null default now()
);

create table if not exists report_snapshots (
  id           bigserial primary key,
  month        text not null,                  -- YYYY-MM
  generated_at timestamptz not null default now(),
  metrics      jsonb not null,
  csv_program  text,
  csv_summary  text
);
create unique index if not exists report_snapshots_month_idx on report_snapshots (month);

-- 공개 API 레이트 리밋 카운터 (PRD §12-1)
create table if not exists rate_limits (
  bucket     text primary key,
  count      int not null default 0,
  expires_at timestamptz not null
);

-- ---------------------------------------------------------------------------
-- 11. 뷰
-- ---------------------------------------------------------------------------

-- 프로그램별 배정 가능 계정 수 (PRD §4-1 파생)
create or replace view program_availability as
select
  p.id as program_id,
  count(*) filter (
    where a.service = 'GPT' and s.account_id is not null
      and (a.expires_on is null or a.expires_on >= (
        case when p.mode = '고정기간' then p.end_on
             else (now() at time zone 'Asia/Seoul')::date + greatest(p.days - 1, 0) end))
  ) as avail_gpt,
  count(*) filter (
    where a.service = 'Claude' and s.account_id is not null
      and (a.expires_on is null or a.expires_on >= (
        case when p.mode = '고정기간' then p.end_on
             else (now() at time zone 'Asia/Seoul')::date + greatest(p.days - 1, 0) end))
  ) as avail_claude
from programs p
left join accounts a
  on a.status = '가용' and a.kind = '운영'
left join account_secrets s
  on s.account_id = a.id and s.password_status = '정상'
group by p.id;

-- 프로그램별 실적 (PRD §10)
create or replace view v_report_program as
select
  p.id   as program_id,
  p.name as program_name,
  p.target,
  count(a.id)                                                        as applied_cnt,
  count(a.id) filter (where a.approved_on is not null)               as approved_cnt,
  count(a.id) filter (where a.assigned_on is not null)               as assigned_cnt,
  count(a.id) filter (where a.acknowledged_at is not null)           as used_cnt,      -- 공식 실적
  count(a.id) filter (where a.status = '회수완료')                    as returned_cnt,
  count(a.id) filter (where a.acknowledged_at is not null and a.service = 'GPT')    as used_gpt,
  count(a.id) filter (where a.acknowledged_at is not null and a.service = 'Claude') as used_claude,
  count(a.id) filter (where a.status = '인수기한초과')                 as ack_overdue_cnt,
  case when count(a.id) filter (where a.status in ('회수완료', '회수중')) = 0 then null
       else round(
         count(a.id) filter (where a.status = '회수완료')::numeric
         / count(a.id) filter (where a.status in ('회수완료', '회수중')) * 100, 1)
  end                                                                as return_rate,
  count(a.id) filter (where a.status = '승인')                        as waiting_cnt,
  round(avg(a.assigned_on - a.approved_on) filter
        (where a.assigned_on is not null and a.approved_on is not null), 1) as wait_days_avg,
  max(a.assigned_on - a.approved_on) filter
        (where a.assigned_on is not null and a.approved_on is not null)     as wait_days_max
from programs p
left join assignments a on a.program_id = p.id
group by p.id, p.name, p.target;

-- 계정별 가용일수/유휴율 계산 보조
create or replace view v_account_usage as
select
  a.id,
  a.service,
  a.status,
  a.assigned_days,
  a.assigned_count,
  greatest(
    (least(coalesce(a.expires_on, (now() at time zone 'Asia/Seoul')::date),
           (now() at time zone 'Asia/Seoul')::date)
     - coalesce(a.activated_on, (now() at time zone 'Asia/Seoul')::date)) + 1,
    0) as available_days
from accounts a;

-- 요약 실적 (PRD §10)
create or replace view v_report_summary as
select
  (select count(*) from assignments where acknowledged_at is not null)                       as used_total,
  (select count(*) from assignments a join users u on u.id = a.user_id
     where a.acknowledged_at is not null and u.type = '교원')                                 as used_faculty,
  (select count(*) from assignments a join users u on u.id = a.user_id
     where a.acknowledged_at is not null and u.type = '직원')                                 as used_staff,
  (select count(*) from assignments a join users u on u.id = a.user_id
     where a.acknowledged_at is not null and u.type = '학생')                                 as used_student,
  (select count(*) from assignments a join users u on u.id = a.user_id
     where a.acknowledged_at is not null and u.type = '지역민')                               as used_local,
  (select count(*) from assignments where acknowledged_at is not null and service = 'GPT')    as used_gpt,
  (select count(*) from assignments where acknowledged_at is not null and service = 'Claude') as used_claude,
  (select round(coalesce(sum(assigned_days), 0)::numeric / 30, 1) from accounts)              as account_months,
  (select round(coalesce(avg(assigned_count), 0)::numeric, 2) from accounts)                  as turnover_avg,
  (select case when coalesce(sum(available_days), 0) = 0 then null
               else round((1 - coalesce(sum(assigned_days), 0)::numeric
                               / nullif(sum(available_days), 0)) * 100, 1) end
     from v_account_usage)                                                                    as idle_rate,
  (select count(*) from assignments where status = '승인')                                    as waiting_cnt,
  (select round(avg((now() at time zone 'Asia/Seoul')::date - approved_on), 1)
     from assignments where status = '승인' and approved_on is not null)                      as waiting_days_avg,
  (select case when count(*) filter (where assigned_on is not null) = 0 then null
               else round(count(*) filter (where status = '인수기한초과')::numeric
                          / count(*) filter (where assigned_on is not null) * 100, 1) end
     from assignments)                                                                        as no_ack_rate,
  (select case when count(*) = 0 then 0
               else round(count(*) filter (where status = '정지')::numeric / count(*) * 100, 1) end
     from accounts)                                                                           as suspension_rate,
  (select count(*) from accounts where status = '가용')                                       as acc_available,
  (select count(*) from accounts where status = '배정')                                       as acc_assigned,
  (select count(*) from accounts where status = '회수중')                                     as acc_returning,
  (select count(*) from accounts where status = '정지')                                       as acc_suspended,
  (select count(*) from accounts where status = '만료')                                       as acc_expired,
  (select count(*) from accounts)                                                             as acc_total,
  (select count(*) from incidents where type = '정지')                                        as inc_suspend,
  (select count(*) from incidents where type = '로그인불가')                                   as inc_login,
  (select count(*) from incidents where type = '기타')                                        as inc_etc;

-- ---------------------------------------------------------------------------
-- 12. RLS — 모든 테이블에서 anon·authenticated 거부 (PRD §13 방어 계층)
--     서버(Server Actions·Route Handlers)의 service role 키만 접근한다.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'settings','admins','accounts','account_secrets','programs','users','assignments',
    'incidents','mail_templates','mail_queue','logs','alerts','report_snapshots',
    'counters','rate_limits'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
