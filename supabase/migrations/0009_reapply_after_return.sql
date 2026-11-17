-- 0009: 회수중·회수완료 뒤 같은 프로그램 재신청 허용 (R9, 2026-11-17)  — 멱등
--
-- 배경: 중복 신청 방지 인덱스가 회수중·회수완료 건까지 묶어, 계정을 반납한(또는 반납 중인) 사람이
--       그 프로그램이 다시 「진행중」이 되어도 영구히 신청할 수 없었다.
-- 변경: 유일 기준 (프로그램, 이메일, 플랫폼)은 그대로 두고, 대상 상태를 「진행 중」(신청·승인·배정·사용중)으로 줄인다.
--       앱 판정 lib/assign.ts:DUPLICATE_BLOCK_STATUSES 와 같은 목록이어야 한다.
-- 기존보다 느슨한 조건이라 기존 데이터가 위반할 수 없다.
-- 배포 순서: 이 파일을 먼저 적용하고 앱을 배포한다(반대 순서여도 「이미 신청」으로 안전하게 거부될 뿐이다).

do $$
begin
  if exists (
    select 1 from pg_indexes
     where indexname = 'assignments_active_unique' and indexdef like '%회수완료%'
  ) or not exists (
    select 1 from pg_indexes where indexname = 'assignments_active_unique'
  ) then
    drop index if exists assignments_active_unique;
    create unique index assignments_active_unique
      on assignments (program_id, email, (assignment_platform(service, service_wish)))
      where status in ('신청', '승인', '배정', '사용중')
        and replaced_at is null;
  end if;
end $$;
