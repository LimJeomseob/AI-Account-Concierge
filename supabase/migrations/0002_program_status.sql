-- 0002: 프로그램 상태 3단계 (시작전 · 진행중 · 완료)  — PRD §4-1, R3 개정, R4 폐지
--
-- 배경: 상태가 「진행|종료」 2단계였고 고정기간 종료일 경과 시 일일 작업이 자동 종료했다(R4).
-- 변경: 「시작전 → 진행중 → 완료」 3단계, 모든 전환은 관리자 드롭다운 수동.
--       시작전·완료 프로그램은 신청 페이지에서 비활성(접수 준비 중 / 접수 종료).
--
-- 주의: enum 새 값을 같은 트랜잭션에서 쓸 수 없으므로 문장별 커밋(psql 기본)으로 실행한다.
--       apply-migration.sh 는 이 조건을 만족한다. 멱등: 여러 번 실행해도 안전.

-- 1) 기존 값 이름 변경 (데이터 보존)
do $$
begin
  if exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'program_status' and e.enumlabel = '진행'
  ) then
    alter type program_status rename value '진행' to '진행중';
  end if;
  if exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'program_status' and e.enumlabel = '종료'
  ) then
    alter type program_status rename value '종료' to '완료';
  end if;
end $$;

-- 2) 새 값 추가 (DO 블록 밖 — ADD VALUE 는 트랜잭션 블록 안에서 실행 불가)
alter type program_status add value if not exists '시작전' before '진행중';

-- 3) 기본값
alter table programs alter column status set default '시작전';

-- 4) 데이터 이관: 대여기간이 아직 없는 「진행중」 → 「시작전」 (사용자 결정: 기존 시드 24개)
update programs
   set status = '시작전'
 where status = '진행중'
   and (
     (mode = '고정기간' and (start_on is null or end_on is null))
     or (mode = '배정일기준' and coalesce(days, 0) <= 0)
   );
