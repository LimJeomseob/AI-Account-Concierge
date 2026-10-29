-- 0008: 같은 프로그램 중복 기준에 플랫폼 추가 (R9, 2026-10-29)  — 멱등
--
-- 배경: 「초·중·고급 AI활용 연구모임 운영」처럼 한 프로그램에서 Claude·ChatGPT 를 모두 쓰는 사람이 있다
--       (같은 이메일로 두 플랫폼). 기존 인덱스는 (프로그램, 이메일)당 진행 중 건 1개만 허용해 두 번째 플랫폼을 넣을 수 없었다.
-- 변경: 진행 중 건 유일 기준을 (프로그램, 이메일, 플랫폼)으로 바꾼다.
--       플랫폼 = 배정된 서비스(service), 배정 전이면 희망(service_wish). 「무관」 희망 건은 「무관」 하나로 센다.
--       공개 신청 화면은 지금처럼 같은 프로그램에 한 번만 신청받는다(lib/ops/apply.ts — 앱 검사).
-- 기존보다 느슨한 조건이라 기존 데이터가 위반할 수 없다.

-- enum → text 변환은 인덱스 식에 바로 쓸 수 없어(IMMUTABLE 아님) 함수로 감싼다.
-- enum 값 이름을 바꾸지 않는 한 결과가 변하지 않으므로 IMMUTABLE 로 선언한다.
create or replace function assignment_platform(s account_service, w service_wish)
returns text
language sql
immutable
as $$ select coalesce(s::text, w::text) $$;

do $$
begin
  if not exists (
    select 1 from pg_indexes
     where indexname = 'assignments_active_unique' and indexdef like '%assignment_platform%'
  ) then
    drop index if exists assignments_active_unique;
    create unique index assignments_active_unique
      on assignments (program_id, email, (assignment_platform(service, service_wish)))
      where status in ('신청', '승인', '배정', '사용중', '회수중', '회수완료')
        and replaced_at is null;
  end if;
end $$;
