-- 0003: 팀 계정(좌석 + 고정 접속 링크) 전환 — PRD §4-1, R14·R16·R22·R24 개정, R21·R23 폐지
--
-- 배경: 계정마다 비밀번호를 금고(AES-256-GCM, VAULT_KEY)에 두고 배정 메일에 실어 보냈으며,
--       회수 시 신규 비밀번호를 자동 생성해 관리자가 서비스에 적용했다(R21·R23).
-- 변경: ChatGPT Team · Claude Team 좌석을 대여한다. 좌석마다 고정 접속 링크(access_url)를
--       등록해 두고, 배정 시 계정명 + 접속 링크를 안내한다. 비밀번호는 다루지 않는다.
--       회수는 ① 대화·메모리 삭제 ② 팀에서 제거(접속 차단) 2단계 체크로 바뀐다.
--
-- ⚠ 주의: 이 마이그레이션은 password_enc·new_password_enc 를 **되돌릴 수 없이 삭제**한다.
--         좌석 정리를 위해 기존 비밀번호가 필요하면 적용 전에 「금고 보기」로 옮겨 적을 것.
--
-- 멱등: 여러 번 실행해도 안전. psql 문장별 커밋(apply-migration.sh)을 전제로 한다.

-- 1) 좌석 고정 접속 링크
alter table account_secrets add column if not exists access_url text;
comment on column account_secrets.access_url is '팀 좌석 고정 접속 링크 — 비어 있으면 배정 풀에서 제외 (R14-2)';

-- 2) 회수 체크리스트 5개 → 2개 (기존 값 이관 후 구 컬럼 삭제)
alter table assignments add column if not exists chk_team_removed boolean not null default false;

do $$
begin
  -- 구 「비밀번호 변경」(= 접근 차단 완료) → 「팀에서 제거」
  if exists (
    select 1 from information_schema.columns
    where table_name = 'assignments' and column_name = 'chk_password_changed'
  ) then
    update assignments set chk_team_removed = true where chk_password_changed;
  end if;
  -- 「대화 삭제」+「메모리 삭제」가 한 항목으로 합쳐진다 (둘 다 완료했을 때만 유지)
  if exists (
    select 1 from information_schema.columns
    where table_name = 'assignments' and column_name = 'chk_delete_memory'
  ) then
    update assignments set chk_delete_chats = chk_delete_chats and chk_delete_memory;
  end if;
end $$;

alter table assignments
  drop column if exists chk_delete_memory,
  drop column if exists chk_logout_all,
  drop column if exists chk_history_review,
  drop column if exists chk_password_changed;

-- 3) program_availability 뷰가 password_status 에 의존하므로 먼저 지운다
--    (CREATE OR REPLACE VIEW 로는 컬럼·조인을 바꿀 수 없다)
drop view if exists program_availability;

-- 4) 비밀번호 관련 컬럼·타입 제거 (등록이메일 소유·2FA 도 비밀번호 시대의 필드라 함께 제거)
alter table account_secrets
  drop column if exists password_enc,
  drop column if exists new_password_enc,
  drop column if exists password_status,
  drop column if exists password_changed_at,
  drop column if exists owns_registered_email,
  drop column if exists two_fa;

drop type if exists password_status;

alter table alerts drop column if exists password_status;

-- 5) 뷰 재생성: 배정 가능 = 가용 ∧ 운영 ∧ 접속 링크 등록 ∧ 대여종료일까지 구독 유지 (R14-2)
create view program_availability as
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
  on s.account_id = a.id and nullif(btrim(s.access_url), '') is not null
group by p.id;

-- 6) 비밀번호 관련 설정 키 제거
delete from settings where key in ('password_length', 'show_new_password_in_digest');

-- 7) DB 에 이미 시드된 메일 문구 패치.
--    renderTemplate 는 모르는 자리표시자를 그대로 남기므로 이 단계를 건너뛰면
--    배정안내 메일에 「■ 비밀번호: {비밀번호}」 가 그대로 나간다.
update mail_templates set
  body = replace(replace(replace(replace(body,
    '■ 비밀번호: {비밀번호}', '■ 접속 링크: {접속링크}'),
    '· 종료 후 AI융합원이 비밀번호를 변경하여 접근을 차단합니다.',
    '· 종료 후 AI융합원이 대화·메모리를 삭제하고 해당 계정을 팀에서 제거하여 접근을 차단합니다.'),
    '계정 정보(계정명·비밀번호·대여기간)', '계정 정보(계정명·접속 링크·대여기간)'),
    '{비밀번호}', '{접속링크}'),
  placeholders = replace(coalesce(placeholders, ''), '{비밀번호}', '{접속링크}'),
  updated_at = now()
where key in ('배정안내', '접수안내')
  and (body like '%비밀번호%' or coalesce(placeholders, '') like '%{비밀번호}%');
