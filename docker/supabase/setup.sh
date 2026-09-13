#!/bin/sh
# Supabase 셀프호스팅 스택 준비 스크립트 (docs/Docker배포가이드.md PART A-3 / B-2)
#
#   sh docker/supabase/setup.sh local
#   sh docker/supabase/setup.sh server api.gnu-ai.kr app.gnu-ai.kr
#   (--dry-run 을 붙이면 파일을 만들지 않고 어떤 값이 들어갈지만 출력)
#
# 하는 일
#   1) 공식 supabase/docker 스택(고정 태그)을 저장소 옆 supabase-project/ 로 복사
#   2) .env 생성 + 비밀 키 자동 생성(utils/generate-keys.sh)
#   3) 주소 관련 값(SITE_URL, API_EXTERNAL_URL, SUPABASE_PUBLIC_URL, KONG_HTTP_PORT) 치환
#   4) Google OAuth 오버라이드 파일 복사
set -eu

SUPABASE_TAG="self-hosted/v0.8.1"
MODE="${1:-}"
API_HOST="${2:-}"
APP_HOST="${3:-}"
DRY=0
for a in "$@"; do [ "$a" = "--dry-run" ] && DRY=1; done

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="$ROOT/../supabase-project"

usage() {
  echo "사용법:"
  echo "  sh docker/supabase/setup.sh local"
  echo "  sh docker/supabase/setup.sh server api.<도메인> app.<도메인>"
  exit 1
}

case "$MODE" in
  local)
    PUBLIC_URL="http://localhost:8000"
    SITE_URL="http://localhost:3000"
    KONG_PORT="8000"
    ;;
  server)
    [ -n "$API_HOST" ] && [ -n "$APP_HOST" ] || usage
    PUBLIC_URL="https://$API_HOST"
    SITE_URL="https://$APP_HOST"
    KONG_PORT="127.0.0.1:8000"   # 외부 노출 차단. Caddy 가 내부망으로 프록시한다.
    ;;
  *) usage ;;
esac

echo "== 모드: $MODE"
echo "   SUPABASE_PUBLIC_URL = $PUBLIC_URL"
echo "   API_EXTERNAL_URL    = $PUBLIC_URL/auth/v1"
echo "   SITE_URL            = $SITE_URL"
echo "   KONG_HTTP_PORT      = $KONG_PORT"
echo "   대상 디렉터리        = $TARGET"
[ "$DRY" = 1 ] && { echo "== --dry-run: 파일을 만들지 않았습니다."; exit 0; }

command -v docker >/dev/null || { echo "docker 가 없습니다. Docker 를 먼저 설치하세요."; exit 1; }
command -v git    >/dev/null || { echo "git 이 없습니다."; exit 1; }

# 1) 공식 스택 복사 (이미 있으면 건너뜀)
if [ ! -f "$TARGET/docker-compose.yml" ]; then
  TMP="$(mktemp -d)"
  echo "== 공식 스택 내려받는 중 ($SUPABASE_TAG)"
  git clone --quiet --depth 1 --branch "$SUPABASE_TAG" https://github.com/supabase/supabase "$TMP/supabase"
  mkdir -p "$TARGET"
  cp -rf "$TMP/supabase/docker/." "$TARGET/"
  rm -rf "$TMP"
  echo "   → $TARGET"
else
  echo "== supabase-project 가 이미 있어 내려받기를 건너뜁니다."
fi

cd "$TARGET"

# 2) .env + 키 생성
if [ ! -f .env ]; then
  cp .env.example .env
  if [ -f utils/generate-keys.sh ]; then
    echo "== 비밀 키 생성 (utils/generate-keys.sh)"
    sh utils/generate-keys.sh
  else
    echo "!! utils/generate-keys.sh 가 없습니다. POSTGRES_PASSWORD, JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY 를 직접 바꾸세요."
  fi
else
  echo "== .env 가 이미 있어 키 생성을 건너뜁니다."
fi

# 3) 주소 값 치환 (sed 구분자로 | 사용 — URL 에 / 가 있으므로)
set_env() {
  key="$1"; val="$2"
  if grep -q "^$key=" .env; then
    sed -i.bak "s|^$key=.*|$key=$val|" .env
  else
    printf '%s=%s\n' "$key" "$val" >> .env
  fi
}
set_env SITE_URL "$SITE_URL"
set_env API_EXTERNAL_URL "$PUBLIC_URL/auth/v1"
set_env SUPABASE_PUBLIC_URL "$PUBLIC_URL"
set_env KONG_HTTP_PORT "$KONG_PORT"
set_env ADDITIONAL_REDIRECT_URLS "$SITE_URL/auth/callback"
grep -q '^GOOGLE_ENABLED='   .env || printf '\n# Google OAuth (docs/Docker배포가이드.md A-5)\nGOOGLE_ENABLED=true\nGOOGLE_CLIENT_ID=\nGOOGLE_SECRET=\n' >> .env
rm -f .env.bak

# 4) Google OAuth 오버라이드
cp "$ROOT/docker/supabase/google-oauth.override.yml" ./google-oauth.override.yml

echo
echo "== 준비 완료. 다음 순서:"
echo "   1) $TARGET/.env 의 GOOGLE_CLIENT_ID / GOOGLE_SECRET 입력"
echo "   2) cd $TARGET && sh run.sh start"
echo "   3) docker compose -f docker-compose.yml -f google-oauth.override.yml up -d auth"
echo "   4) sh run.sh secrets   ← 앱 .env 에 넣을 키 확인"
echo "   5) sh $ROOT/docker/supabase/apply-migration.sh"
