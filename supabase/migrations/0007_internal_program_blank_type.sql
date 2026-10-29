-- 0007: 기관관리자 등록 지원 (2026-10-29)  — 멱등
--
-- 배경: 팀 워크스페이스에 관리자가 직접 추가한 실사용자(소유자·관리자 포함)를 시스템에 「사용중」으로 등록한다.
--       이들은 신청서를 거치지 않아 구분(교원·직원·학생·지역민)을 알 수 없고, 공개 신청 화면에 보일 프로그램도 아니다.
-- 변경:
--   1) users.type 공란 허용 — 구분 미상. 이후 사용자 화면에서 고치거나 본인이 신청하면 채워진다.
--      실적 뷰(v_report_summary)의 구분별 인원에는 잡히지 않고 전체 인원(used_total)에만 잡힌다.
--   2) programs.internal — 내부 프로그램(기관관리자)은 공개 프로그램 목록(/api/public/programs)에서 뺀다.

alter table users alter column type drop not null;

alter table programs add column if not exists internal boolean not null default false;
