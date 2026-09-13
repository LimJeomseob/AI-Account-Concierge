#!/bin/sh
# Google 로그인 켜기 (PRD §3 관리자 인증)
#
#   sh docker/supabase/enable-google.sh
#
# 공식 compose 는 GOTRUE_EXTERNAL_GOOGLE_* 이 주석 처리돼 있어, 오버라이드를 덧씌워야 한다.
# `sh run.sh start` 로 Supabase 스택을 다시 켤 때마다 이 스크립트를 함께 실행할 것.
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROJECT="${SUPABASE_PROJECT_DIR:-$ROOT/../supabase-project}"
OVERRIDE="$PROJECT/google-oauth.override.yml"

[ -f "$PROJECT/docker-compose.yml" ] || { echo "supabase-project 가 없습니다: $PROJECT"; exit 1; }

# 오버라이드 파일이 없으면 저장소에서 복사
[ -f "$OVERRIDE" ] || cp "$ROOT/docker/supabase/google-oauth.override.yml" "$OVERRIDE"

# .env 의 Google 값 확인
CID=$(grep -E '^GOOGLE_CLIENT_ID=' "$PROJECT/.env" | cut -d= -f2- || true)
CSEC=$(grep -E '^GOOGLE_SECRET=' "$PROJECT/.env" | cut -d= -f2- || true)
if [ -z "$CID" ] || [ -z "$CSEC" ]; then
  echo "!! $PROJECT/.env 의 GOOGLE_CLIENT_ID / GOOGLE_SECRET 이 비어 있습니다."
  echo "   Google Cloud Console 에서 발급한 값을 넣고 다시 실행하세요:"
  echo "   notepad $PROJECT/.env"
  exit 1
fi
grep -q '^GOOGLE_ENABLED=true' "$PROJECT/.env" || echo 'GOOGLE_ENABLED=true' >> "$PROJECT/.env"

echo "== auth 컨테이너에 Google 설정 적용"
docker compose -f "$PROJECT/docker-compose.yml" -f "$OVERRIDE" \
  --project-directory "$PROJECT" up -d auth

echo "== 확인 (아래 4줄이 보여야 정상)"
docker exec supabase-auth env | grep -i google || {
  echo "!! 적용되지 않았습니다. docker compose -f ... logs auth 로 확인하세요."
  exit 1
}

echo
echo "완료. 브라우저를 새로고침하고 다시 로그인해 보세요:"
echo "  ${NEXT_PUBLIC_APP_URL:-http://localhost:3000}/admin"
