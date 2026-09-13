# Vercel Cron 대체 — 매일 09:00 KST 일일 작업, 매월 1일 09:05 월간 스냅샷 (PRD §11)
FROM alpine:3.20
RUN apk add --no-cache curl tzdata
ENV TZ=Asia/Seoul
COPY crontab /etc/crontabs/root
CMD ["crond", "-f", "-l", "2"]
