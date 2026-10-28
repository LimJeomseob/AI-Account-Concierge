#!/bin/sh
# DB 백업 — pg_dump 를 docker/backups/YYYY-MM-DD.sql.gz 로 저장. 30일 지난 파일은 삭제.
# 서버 crontab 예: 0 3 * * * sh /opt/AI-Account-Concierge/docker/backup.sh >> /var/log/ai-account-backup.log 2>&1
#
# 덤프 범위: public(앱 데이터) + auth(관리자 Google 로그인 계정). auth 가 빠지면 복원 뒤 로그인이 안 된다.
# 실패 검출: POSIX sh 에는 pipefail 이 없어 `pg_dump | gzip` 만으로는 pg_dump 실패를 알 수 없다.
#            임시 파일에 먼저 덤프하고 종료 코드·크기를 확인한 뒤에만 최종 파일로 옮기며,
#            실패 시 0이 아닌 코드로 끝나 cron 로그에 남고 30일 정리도 건너뛴다(정상 백업 보존).
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="${SUPABASE_PROJECT_DIR:-$ROOT/../supabase-project}"
OUT="$ROOT/docker/backups"
mkdir -p "$OUT"
STAMP="$(date +%Y-%m-%d)"
FILE="$OUT/$STAMP.sql.gz"
TMP="$OUT/.$STAMP.sql.gz.part"
trap 'rm -f "$TMP"' EXIT

[ -f "$PROJECT/docker-compose.yml" ] || { echo "supabase-project 가 없습니다: $PROJECT"; exit 1; }

# -f 로 Supabase 스택의 compose 파일을 명시 (현재 폴더의 compose 파일을 읽지 않도록)
if ! docker compose -f "$PROJECT/docker-compose.yml" --project-directory "$PROJECT" exec -T db \
  pg_dump -U postgres -d postgres --no-owner --no-privileges --clean --if-exists \
    --schema=public --schema=auth > "$TMP.sql"; then
  rm -f "$TMP.sql"
  echo "백업 실패: pg_dump 오류 ($STAMP)"; exit 1
fi

# 빈 덤프(연결은 됐지만 내용이 없는 경우) 방어 — 스키마만 있어도 수 KB 는 된다
SIZE="$(wc -c < "$TMP.sql")"
if [ "$SIZE" -lt 4096 ]; then
  rm -f "$TMP.sql"
  echo "백업 실패: 덤프 크기가 비정상적으로 작음 (${SIZE} bytes)"; exit 1
fi

gzip -c "$TMP.sql" > "$TMP" && rm -f "$TMP.sql"
gzip -t "$TMP"
mv "$TMP" "$FILE"

# 정리는 이번 백업이 성공했을 때만
find "$OUT" -name '*.sql.gz' -mtime +30 -delete
echo "백업 완료: $FILE ($(du -h "$FILE" | cut -f1))"
