#!/bin/sh
# 스키마 적용 — supabase-project 의 db 컨테이너에 supabase/migrations/*.sql 을 순서대로 실행
# 여러 번 실행해도 안전(멱등).
set -eu
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROJECT="${SUPABASE_PROJECT_DIR:-$ROOT/../supabase-project}"

[ -f "$PROJECT/docker-compose.yml" ] || { echo "supabase-project 가 없습니다: $PROJECT"; exit 1; }

for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "== 적용: $(basename "$f")"
  docker compose --project-directory "$PROJECT" exec -T db \
    psql -v ON_ERROR_STOP=1 -U postgres -d postgres < "$f"
done

echo "== 확인: public 스키마 테이블 수"
docker compose --project-directory "$PROJECT" exec -T db \
  psql -U postgres -d postgres -tAc "select count(*) from information_schema.tables where table_schema='public'"
