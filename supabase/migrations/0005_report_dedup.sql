-- 0005: 실적 기준 정정 + 로그 최소화 (PRD §10·R29, §13)  — 멱등
--
-- 배경: 인수 확인(R18) 폐지로 배정 즉시 acknowledged_at 이 기록돼 실적(사용 인원)에 잡힌다. 그 결과
--   ① 장애 대체 배정(R27)은 같은 사람이 같은 프로그램에서 2명으로 세어지고
--   ② 관리자가 취소한 건도 실적에 남았다.
-- 변경(운영자 결정 2026-10-28):
--   · 사용 인원 = acknowledged_at 이 있고 관리자 취소(cancelled_at)가 아닌 (프로그램, 사용자) 고유 수
--   · 관리자 취소 건은 사용 기간과 무관하게 실적에서 제외한다
--   · 신청·승인 건수에서도 장애 대체로 끝난 원 배정(replaced_at)은 빼서 같은 사람을 1건으로 센다
-- 뷰는 열 이름·순서를 유지하고 계산식만 바꾼다(create or replace). 폐지 지표(ack_overdue_cnt·no_ack_rate)
-- 열도 유지한다 — 화면·메일에서만 뺀다.

-- 1) 관리자 취소 시각 / 장애 대체로 끝난 원 배정 표시
alter table assignments add column if not exists cancelled_at timestamptz;
alter table assignments add column if not exists replaced_at timestamptz;

-- 1-1) 중복 신청 방지 인덱스(R9)에서 「장애 대체로 끝난 원 배정」을 뺀다.
--      기존 인덱스는 같은 프로그램·같은 이메일의 활성 건을 1개로 묶어, 장애 대체(R27)가 같은 사람의
--      새 배정 건을 만드는 순간 항상 실패했다. 원 배정에 replaced_at 을 찍고 나서 새 건을 만든다.
do $$
begin
  if not exists (
    select 1 from pg_indexes
     where indexname = 'assignments_active_unique' and indexdef like '%replaced_at%'
  ) then
    drop index if exists assignments_active_unique;
    create unique index assignments_active_unique
      on assignments (program_id, email)
      where status in ('신청', '승인', '배정', '사용중', '회수중', '회수완료')
        and replaced_at is null;
  end if;
end $$;

-- 1-2) 과거 장애 대체 건 표시 (incidents.action 의 「새 접수번호」가 있는 원 배정)
update assignments a
   set replaced_at = coalesce(a.updated_at, now())
  from incidents i
 where i.assignment_id = a.id
   and i.replacement_account_id is not null
   and a.replaced_at is null;

-- 2) 과거 취소 건 채우기 — logs 의 assignment.cancel 기록 시각
update assignments a
   set cancelled_at = l.at
  from (select target_id, min(at) as at from logs where action = 'assignment.cancel' group by target_id) l
 where l.target_id = a.id
   and a.cancelled_at is null;

-- 3) 실적 뷰
create or replace view v_report_program as
select
  p.id   as program_id,
  p.name as program_name,
  p.target,
  count(a.id) filter (where a.replaced_at is null)                   as applied_cnt,   -- 장애 대체 원 배정은 1건으로
  count(a.id) filter (where a.approved_on is not null and a.replaced_at is null) as approved_cnt,
  count(a.id) filter (where a.assigned_on is not null)               as assigned_cnt,
  count(distinct a.user_id) filter (where a.acknowledged_at is not null and a.cancelled_at is null)        as used_cnt,      -- 공식 실적: 사람 단위(대체 배정 중복·취소 제외)
  count(a.id) filter (where a.status = '회수완료')                    as returned_cnt,
  count(distinct a.user_id) filter (where a.acknowledged_at is not null and a.cancelled_at is null and a.service = 'GPT')    as used_gpt,
  count(distinct a.user_id) filter (where a.acknowledged_at is not null and a.cancelled_at is null and a.service = 'Claude') as used_claude,
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
group by p.id, p.name, p.target;;

create or replace view v_report_summary as
select
  (select count(*) from (select distinct program_id, user_id from assignments where acknowledged_at is not null and cancelled_at is null) x) as used_total,
  (select count(*) from (select distinct a.program_id, a.user_id from assignments a join users u on u.id = a.user_id
     where a.acknowledged_at is not null and a.cancelled_at is null and u.type = '교원') x) as used_faculty,
  (select count(*) from (select distinct a.program_id, a.user_id from assignments a join users u on u.id = a.user_id
     where a.acknowledged_at is not null and a.cancelled_at is null and u.type = '직원') x) as used_staff,
  (select count(*) from (select distinct a.program_id, a.user_id from assignments a join users u on u.id = a.user_id
     where a.acknowledged_at is not null and a.cancelled_at is null and u.type = '학생') x) as used_student,
  (select count(*) from (select distinct a.program_id, a.user_id from assignments a join users u on u.id = a.user_id
     where a.acknowledged_at is not null and a.cancelled_at is null and u.type = '지역민') x) as used_local,
  (select count(*) from (select distinct program_id, user_id from assignments where acknowledged_at is not null and cancelled_at is null and service = 'GPT') x) as used_gpt,
  (select count(*) from (select distinct program_id, user_id from assignments where acknowledged_at is not null and cancelled_at is null and service = 'Claude') x) as used_claude,
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
  (select count(*) from incidents where type = '기타')                                        as inc_etc;;

-- 4) 로그 최소화(§13): 과거 신청 로그의 이메일 제거 (앱은 2026-10-28 부터 기록하지 않음)
update logs set detail = detail - 'email'
 where action = 'assignment.apply'
   and detail ? 'email';
