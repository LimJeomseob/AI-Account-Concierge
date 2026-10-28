-- 0006: 접속 링크 기능 폐지 (PRD R14-2 폐지, 2026-10-29)  — 멱등
--
-- 배경: 배정된 신청자는 관리자가 팀 워크스페이스(ChatGPT Business·Claude Team)에 이메일로 초대한다.
--       계정마다 고정 접속 링크를 등록하던 방식과 「링크가 없는 계정은 배정 제외」 규칙(R14-2)을 없앤다.
-- 변경: 프로그램별 배정 가능 계정 수 뷰에서 접속 링크 조건을 뺀다(가용 ∧ 운영 ∧ 대여종료일까지 구독 유지).
-- 보존: account_secrets.access_url 열과 기존 값은 그대로 둔다(되돌릴 수 없는 삭제 없음). 앱은 더 이상 읽거나 쓰지 않는다.

create or replace view program_availability as
select
  p.id as program_id,
  count(*) filter (
    where a.service = 'GPT'
      and (a.expires_on is null or a.expires_on >= (
        case when p.mode = '고정기간' then p.end_on
             else (now() at time zone 'Asia/Seoul')::date + greatest(p.days - 1, 0) end))
  ) as avail_gpt,
  count(*) filter (
    where a.service = 'Claude'
      and (a.expires_on is null or a.expires_on >= (
        case when p.mode = '고정기간' then p.end_on
             else (now() at time zone 'Asia/Seoul')::date + greatest(p.days - 1, 0) end))
  ) as avail_claude
from programs p
left join accounts a
  on a.status = '가용' and a.kind = '운영'
group by p.id;
