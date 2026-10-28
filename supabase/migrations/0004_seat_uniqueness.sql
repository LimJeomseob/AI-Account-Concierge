-- 0004: 좌석 1개 = 활성 배정 1건 (PRD §4-2, R14·R27)  — 멱등
--
-- 배경: 자동 배정·수동 배정·장애 대체가 동시에 돌면 같은 좌석이 두 신청 건에 연결될 수 있었다.
--       앱은 조건부 갱신(lib/state.ts:claimAccount)으로 막고, 이 인덱스가 DB 의 최종 방어선이다.
-- 활성 = 좌석을 실제로 쥐고 있는 상태: 배정(구) · 사용중 · 회수중 · 인수기한초과(구)
--
-- 주의: 이미 중복 데이터가 있으면 인덱스를 만들 수 없다. 이 파일은 그 경우 좌석·접수번호를
--       알려 주며 중단한다. 안내된 건을 정리(회수 완료 또는 취소)한 뒤 다시 실행하면 된다.

do $$
declare
  dup text;
begin
  if exists (select 1 from pg_indexes where indexname = 'assignments_active_account_uq') then
    return;
  end if;

  select string_agg(format('%s ← %s', account_id, ids), E'\n')
    into dup
    from (
      select account_id, string_agg(id || '(' || status || ')', ', ' order by id) as ids
        from assignments
       where account_id is not null
         and status in ('배정', '사용중', '회수중', '인수기한초과')
       group by account_id
      having count(*) > 1
    ) d;

  if dup is not null then
    raise exception E'한 좌석이 활성 배정 2건 이상에 연결돼 있어 유일 인덱스를 만들 수 없습니다.\n%\n관리자 화면에서 위 접수번호 중 실제로 쓰지 않는 건을 회수 완료하거나 취소한 뒤 0004 를 다시 실행하세요.', dup;
  end if;
end $$;

create unique index if not exists assignments_active_account_uq
  on assignments (account_id)
  where account_id is not null
    and status in ('배정', '사용중', '회수중', '인수기한초과');
