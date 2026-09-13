#!/bin/sh
# DB 백업 — pg_dump 를 docker/backups/YYYY-MM-DD.sql.gz 로 저장. 30일 지난 파일은 삭제.
# 서버 crontab 예: 0 3 * * * sh /opt/ai-account/docker/backup.sh >> /var/log/ai-account-backup.log 2>&1
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="${SUPABASE_PROJECT_DIR:-$ROOT/../supabase-project}"
OUT="$ROOT/docker/backups"
mkdir -p "$OUT"
FILE="$OUT/$(date +%Y-%m-%d).sql.gz"

docker compose --project-directory "$PROJECT" exec -T db \
  pg_dump -U postgres -d postgres --no-owner --schema=public | gzip > "$FILE"

find "$OUT" -name '*.sql.gz' -mtime +30 -delete
echo "백업 완료: $FILE ($(du -h "$FILE" | cut -f1))"
