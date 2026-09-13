# Docker 배포 가이드 — 초보 개발자용

AI 유료계정 관리시스템을 **Vercel 없이** Docker 로 띄우는 방법입니다.
PRD §13 「Vercel Hobby 비상업 조건 불가 시 대학 서버 Docker 배포」에 해당합니다.

이 문서는 **명령을 순서대로 복사해 실행하면 끝나도록** 썼습니다.
「확인」 항목은 반드시 그 결과가 나오는지 보고 다음으로 넘어가세요.
「담당: 사람」은 프로그램이 대신할 수 없는 일(계정 발급·서버 신청 등)입니다.

---

## 0. 무엇이 만들어지는가

```
 [참여자·관리자 브라우저]
        │ HTTPS
        ▼
   ┌─────────┐   app.<도메인>  →  ┌──────────┐  Next.js 앱 (신청·관리자 화면·API)
   │  Caddy  │ ────────────────▶ │   app    │
   │ (443)   │   api.<도메인>  →  └──────────┘
   └─────────┘ ─────────┐               │ http://kong:8000 (내부망)
                        ▼               ▼
              ┌────────────────────────────────────┐
              │  Supabase 셀프호스팅 스택 (공식 compose) │
              │  kong(게이트웨이) · auth(Google 로그인)  │
              │  rest(DB API) · db(Postgres) · studio  │
              └────────────────────────────────────┘
   ┌─────────┐  매일 09:00 KST → http://app:3000/api/cron/daily
   │  cron   │  매월 1일 09:05 → /api/cron/monthly
   └─────────┘
```

| 컨테이너 | 역할 | 누가 만드나 |
|---|---|---|
| `app` | Next.js 앱. 신청 페이지·관리자 화면·공개 API | 이 저장소 `Dockerfile` |
| `cron` | Vercel Cron 대체. 정해진 시각에 앱 API 를 호출 | `docker/cron/` |
| `caddy` | HTTPS 인증서 자동 발급 + 리버스 프록시 (**서버에서만**) | `docker/Caddyfile` |
| Supabase 스택 (10여 개) | DB·Google 로그인·DB API·관리 화면(Studio) | Supabase 공식 `supabase/docker` |

**최소 사양** (Supabase 공식 요구): RAM 4GB(권장 8GB), CPU 2코어, 디스크 40GB SSD.
개인 PC 로컬 시험은 8GB RAM 노트북이면 충분합니다.

**두 개의 폴더를 씁니다.** 서로 형제 관계여야 합니다.

```
작업폴더/
├── AI-Account-Concierge/     ← 이 저장소 (앱 스택)
└── supabase-project/         ← Supabase 공식 스택 (setup.sh 가 만들어 줌)
```

---

## PART A. 개인 PC 로컬 시험

목표: 내 PC 에서 전체 시스템을 띄우고 Google 로그인까지 되는 것을 확인한다.

### A-1. Docker 설치

- Windows / Mac: [Docker Desktop](https://www.docker.com/products/docker-desktop/) 설치 후 실행. 담당: 사람
- Windows 는 설치 중 WSL 2 를 켜라고 하면 켭니다.

**확인**
```bash
docker --version          # Docker version 2x.x.x 처럼 나오면 됨
docker compose version    # Docker Compose version v2.x.x
```

> **Windows 사용자는 반드시 읽으세요.**
> 이 문서의 `sh ...` 명령과 Supabase 공식 스택의 `run.sh` 는 리눅스/맥 셸 스크립트입니다.
> **PowerShell 이나 CMD 에서는 실행되지 않습니다** (`'sh' 용어가 ... 인식되지 않습니다` 오류).
> [Git for Windows](https://git-scm.com/download/win) 를 설치하고 **Git Bash** 창을 열어 거기서 실행하세요.
> Git Bash 에는 `sh`·`openssl`·`sed` 가 모두 들어 있습니다.
>
> - Git Bash 에서 경로는 `C:\Users\user\작업폴더` → `/c/Users/user/작업폴더` 로 씁니다.
> - `docker ...` 명령은 PowerShell·Git Bash 어디서든 됩니다. `sh ...` 만 Git Bash 에서.
> - 이 문서 전체를 **Git Bash 창 하나로** 진행하는 것이 가장 간단합니다.

### A-2. 저장소 받기

```bash
mkdir 작업폴더 && cd 작업폴더
git clone https://github.com/LimJeomseob/AI-Account-Concierge.git
cd AI-Account-Concierge
```

### A-3. Supabase 스택 띄우기

```bash
sh docker/supabase/setup.sh local
```
이 명령이 하는 일: 공식 스택을 `../supabase-project` 로 복사 → 비밀 키 자동 생성 → 로컬 주소로 설정.

```bash
cd ../supabase-project
sh run.sh start
```
처음에는 이미지 내려받기로 5~10분 걸립니다.

**확인**
```bash
docker compose ps
```
모든 줄이 `Up ... (healthy)` 여야 합니다. `unhealthy` 가 있으면 1~2분 더 기다렸다가 다시 확인하고, 그래도 안 되면 `sh run.sh logs <서비스명>` 으로 원인을 봅니다.

브라우저에서 **http://localhost:8000** 을 열면 Studio(관리 화면) 로그인 창이 뜹니다.
아이디·비밀번호는 `supabase-project/.env` 의 `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` 입니다.

### A-4. 스키마(테이블) 만들기

```bash
cd ../AI-Account-Concierge
sh docker/supabase/apply-migration.sh
```

**확인** — 마지막 줄에 숫자 `15` 이상이 찍힙니다. Studio → Table Editor 에도 `programs`, `accounts`, `assignments` 등이 보입니다.

### A-5. Google 로그인 연결

관리자 화면은 Google 로그인만 씁니다(PRD §3).

1. [Google Cloud Console](https://console.cloud.google.com/) → 프로젝트 생성 → **API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID**. 담당: 사람
   - 애플리케이션 유형: **웹 애플리케이션**
   - 승인된 리디렉션 URI: **`http://localhost:8000/auth/v1/callback`** ← 정확히 이 값
   - 처음이면 「OAuth 동의 화면」을 먼저 만들라고 합니다. 외부·테스트 모드로 만들고 본인 Gmail 을 테스트 사용자에 추가하면 됩니다.
2. 발급된 **클라이언트 ID** 와 **클라이언트 보안 비밀번호**를 `supabase-project/.env` 맨 아래에 넣습니다.
   ```
   GOOGLE_ENABLED=true
   GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
   GOOGLE_SECRET=GOCSPX-xxxxxxxx
   ```
3. Auth 컨테이너만 다시 띄웁니다.
   ```bash
   cd ../supabase-project
   docker compose -f docker-compose.yml -f google-oauth.override.yml up -d auth
   ```

**확인**
```bash
docker compose logs auth | grep -i google
```
오류 없이 기동 로그만 보이면 됩니다.

### A-6. 앱 환경변수

```bash
cd ../AI-Account-Concierge
cp docker/.env.docker.example docker/.env
```

`docker/.env` 를 열어 채웁니다. 로컬은 주소 부분이 이미 맞게 돼 있으니 **키와 비밀 값만** 넣으면 됩니다.

| 항목 | 값을 어디서 가져오나 |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | `cd ../supabase-project && sh run.sh secrets` 의 **`SUPABASE_SECRET_KEY`** (이름이 다름에 주의) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 같은 출력의 **`SUPABASE_PUBLISHABLE_KEY`** |
| `VAULT_KEY` | 터미널에서 `openssl rand -base64 32` |
| `APP_SECRET` | `openssl rand -hex 32` |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `INITIAL_ADMIN_EMAIL` | 관리자로 쓸 본인 Gmail |
| `RESEND_API_KEY` | 로컬 시험은 **비워 둠** (메일이 실제로 나가지 않고 대기열에만 쌓임) |

> Windows 에 `openssl` 이 없으면 Git Bash 에서 실행하거나, Studio → SQL Editor 에서
> `select encode(gen_random_bytes(32),'base64');` 로 만들어도 됩니다.

> `SUPABASE_URL=http://kong:8000` 과 `NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000` 이 **다른 값인 것이 정상**입니다.
> 앞은 앱 컨테이너가 도커 내부망으로 접근하는 주소, 뒤는 브라우저가 Google 로그인 때 접근하는 주소입니다.

### A-7. 앱 띄우기

```bash
cd docker
docker compose up -d --build
```
처음 빌드는 3~5분 걸립니다.

**확인**
```bash
docker compose ps                   # app, cron 두 개가 Up (healthy)
curl http://localhost:3000/api/health
```
`{"ok":true,"today":"2026-..","db":"up"}` 이 나오면 앱 ↔ DB 연결 성공입니다.
`"db":"down"` 이면 `docker/.env` 의 키 두 개를 다시 확인하세요.

### A-8. 초기 데이터 넣기

시드 스크립트는 컨테이너 밖(내 PC)에서 실행합니다. 이유: 컨테이너 안에는 개발 도구가 없고, 스크립트는 Supabase 주소만 있으면 어디서든 동작하기 때문입니다.

```bash
cd ..                                  # AI-Account-Concierge 로
npm install
cp docker/.env .env.local
# .env.local 에서 SUPABASE_URL 한 줄만 http://localhost:8000 으로 바꿉니다 (PC 에서는 kong 이라는 이름을 모름)
npx tsx scripts/seed.ts --programs --sample-accounts
```

**확인** — `프로그램 24건 등록`, `샘플 계정 6건 등록`, `시드 완료.` 가 찍힙니다.

### A-9. 전체 동작 확인

| 확인 | 방법 | 기대 결과 |
|---|---|---|
| 관리자 로그인 | http://localhost:3000/admin | Google 로그인 후 대시보드. `INITIAL_ADMIN_EMAIL` 이 아닌 계정은 「권한 없음」 |
| 신청 페이지 | http://localhost:3000/apply | 프로그램 24개가 「접수 준비 중」으로 보임 (기간을 넣으면 활성화) |
| 일일 작업 수동 호출 | `curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/daily` | `{"ok":true,...}` |
| 크론 컨테이너 시간대 | `docker compose exec cron date` | `KST` 가 찍힘 |
| 크론 로그 | `docker compose logs cron` | 09:00 이 지나면 호출 기록이 보임 |

### A-10. 끄기 · 지우기 · 다시 켜기

```bash
# 앱 스택
cd AI-Account-Concierge/docker
docker compose down          # 끄기 (데이터는 Supabase 쪽에 있으므로 안전)
docker compose up -d         # 다시 켜기 (코드가 바뀌었으면 --build)

# Supabase 스택
cd ../../supabase-project
sh run.sh stop               # 끄기 — DB 데이터는 volumes/ 에 남음
sh run.sh start              # 다시 켜기
sh reset.sh                  # ⚠ 전부 삭제 (DB 데이터 포함). 되돌릴 수 없음
```

---

## PART B. 대학 서버 운영 배포

목표: 대학 서버에서 24시간 운영. HTTPS 와 자동 배치까지 포함.
아래 예시는 도메인을 `gnu-ai.kr` 로 가정합니다. 본인 도메인으로 바꿔 읽으세요.

### B-1. 서버·도메인 준비 (담당: 사람)

| 항목 | 내용 |
|---|---|
| 서버 | Ubuntu 22.04 이상, RAM 8GB, 디스크 80GB 권장. 정보전산원에 VM 신청 |
| 방화벽 | 외부에서 **80, 443** 만 개방. 22(SSH)는 교내망만 |
| 도메인 | A 레코드 2개를 서버 공인 IP 로: `app.gnu-ai.kr`, `api.gnu-ai.kr` |
| Docker | 서버에 접속해 아래 한 줄 실행 |

```bash
curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker $USER
```
로그아웃 후 다시 접속해서 `docker compose version` 이 나오면 됩니다.

정보전산원에 보낼 DNS 요청 예시:
```
[협조 요청] AI융합원 AI 유료계정 관리시스템 DNS 등록
 · app.gnu-ai.kr  A  <서버 공인 IP>   (관리자·신청 화면)
 · api.gnu-ai.kr  A  <서버 공인 IP>   (인증 API)
 · 방화벽: 80/443 인바운드 허용
```

**확인** (내 PC 에서)
```bash
nslookup app.gnu-ai.kr    # 서버 IP 가 나와야 함
```

### B-2. 저장소·Supabase 스택 (서버에서)

```bash
sudo mkdir -p /opt && cd /opt
sudo git clone https://github.com/LimJeomseob/AI-Account-Concierge.git
sudo chown -R $USER /opt/AI-Account-Concierge
cd AI-Account-Concierge

sh docker/supabase/setup.sh server api.gnu-ai.kr app.gnu-ai.kr
cd ../supabase-project
sh run.sh start
```

로컬과 다른 점: `KONG_HTTP_PORT=127.0.0.1:8000` 으로 설정돼 **외부에서 8000 포트가 열리지 않습니다.** Caddy 만 내부망으로 접근합니다.

**확인**: `docker compose ps` 전부 healthy.

### B-3. Google 로그인 (서버 주소 추가)

A-5 에서 만든 OAuth 클라이언트의 「승인된 리디렉션 URI」에 **`https://api.gnu-ai.kr/auth/v1/callback`** 을 **추가**합니다(로컬 것은 남겨도 됨). 담당: 사람
OAuth 동의 화면이 「테스트」 상태면 실제 관리자들의 Gmail 을 테스트 사용자에 추가하거나, 「프로덕션」으로 게시합니다.

```bash
# supabase-project/.env 에 GOOGLE_CLIENT_ID / GOOGLE_SECRET 입력 후
docker compose -f docker-compose.yml -f google-oauth.override.yml up -d auth
```

### B-4. 스키마 + 앱 환경변수

```bash
cd /opt/AI-Account-Concierge
sh docker/supabase/apply-migration.sh
cp docker/.env.docker.example docker/.env
```

`docker/.env` 를 **서버 값**으로:
```
NEXT_PUBLIC_APP_URL=https://app.gnu-ai.kr
NEXT_PUBLIC_SUPABASE_URL=https://api.gnu-ai.kr
DOMAIN=gnu-ai.kr
SUPABASE_URL=http://kong:8000
```
키·비밀 값은 A-6 표와 같은 방법으로. **VAULT_KEY 는 로컬과 다른 새 값**을 만들고, 기관 비밀번호 관리소에 보관합니다(잃으면 계정 금고 복호화 불가).
`RESEND_API_KEY` 는 실제 값을 넣습니다(도메인 인증은 `docs/배포체크리스트.md` 3번).

### B-5. 앱 + HTTPS 띄우기

```bash
cd docker
docker compose --profile server up -d --build
```
`--profile server` 가 Caddy 를 함께 띄웁니다. Caddy 가 Let's Encrypt 에서 인증서를 자동 발급합니다(1분 내).

**확인**
```bash
docker compose ps                                  # app, cron, caddy 모두 Up
docker compose logs caddy | grep -i certificate    # "certificate obtained" 류 로그
curl https://app.gnu-ai.kr/api/health              # {"ok":true,...,"db":"up"}
curl -I https://api.gnu-ai.kr/auth/v1/health       # HTTP/2 200
```

### B-6. Studio(관리 화면) 접근

서버에서는 Studio 가 외부에 열려 있지 않습니다. 필요할 때 SSH 터널로 봅니다.
```bash
# 내 PC 에서
ssh -L 8000:127.0.0.1:8000 <계정>@<서버IP>
# 그 상태로 브라우저에서 http://localhost:8000
```

### B-7. 초기 데이터 (시드 · 계정 100개)

서버에 Node 를 설치하지 않고, **내 PC 에서 SSH 터널을 통해** 실행하는 것이 가장 간단합니다.

```bash
# 내 PC, 터널(B-6)이 열린 상태에서, AI-Account-Concierge 폴더
cp docker/.env .env.local              # 서버의 docker/.env 내용을 복사해 온 파일
# .env.local 의 SUPABASE_URL 을 http://localhost:8000 으로 (터널 주소)
npx tsx scripts/seed.ts --programs
npx tsx scripts/import-accounts.ts accounts.csv
```

이후 관리자 화면(https://app.gnu-ai.kr/admin)에서 설정·프로그램 기간·관리자 추가를 진행합니다 — `docs/운영매뉴얼.md`.

### B-8. 운영 루틴

| 할 일 | 명령 (서버, `/opt/AI-Account-Concierge/docker`) |
|---|---|
| 상태 보기 | `docker compose ps` |
| 앱 로그 | `docker compose logs -f app` |
| 크론이 실제로 돌았는지 | `docker compose logs cron` (매일 09:00 KST 한 줄) |
| 재시작 | `docker compose restart app` |
| **코드 업데이트** | `cd .. && git pull && cd docker && docker compose --profile server up -d --build` |
| 환경변수 바꾼 뒤 | `docker compose --profile server up -d` (재빌드 불필요. `NEXT_PUBLIC_*` 을 바꿨을 때만 `--build`) |
| Supabase 스택 로그 | `cd ../../supabase-project && sh run.sh logs auth` |

**백업** — 주 1회 이상. 서버 crontab 에 등록합니다.
```bash
crontab -e
# 매일 03:00 백업, 30일 보관
0 3 * * * sh /opt/AI-Account-Concierge/docker/backup.sh >> /var/log/ai-account-backup.log 2>&1
```
백업 파일은 `docker/backups/YYYY-MM-DD.sql.gz`. **서버 밖(기관 NAS 등)으로도 복사**해 두세요.

**복구**
```bash
cd /opt/supabase-project
gunzip -c /opt/AI-Account-Concierge/docker/backups/2026-10-01.sql.gz \
  | docker compose exec -T db psql -U postgres -d postgres
```

**Supabase 스택 업그레이드**는 함부로 하지 마세요. `setup.sh` 가 태그를 고정(`self-hosted/v0.8.1`)해 둔 이유입니다. 사업 기간(6개월) 중에는 보안 패치가 아니면 그대로 두는 것을 권합니다.

### B-9. 문제 해결

| 증상 | 원인·조치 |
|---|---|
| Windows: `'sh' 용어가 cmdlet, 함수, ... 인식되지 않습니다` | PowerShell/CMD 에서 실행함. **Git Bash** 창을 열어 같은 명령을 실행 (A-1 참고) |
| Git Bash: `sh: docker: command not found` | Docker Desktop 이 꺼져 있거나 PATH 미등록. Docker Desktop 을 실행한 뒤 Git Bash 를 새로 연다 |
| Google 로그인 시 `redirect_uri_mismatch` | Google Console 의 리디렉션 URI 와 GoTrue 가 보낸 값이 다름. `https://api.<도메인>/auth/v1/callback` 을 **정확히**(http/https, 끝 슬래시 없음) 등록했는지, `supabase-project/.env` 의 `API_EXTERNAL_URL` 이 `https://api.<도메인>/auth/v1` 인지 확인 |
| 로그인 후 `/admin/denied` | 그 Gmail 이 `admins` 테이블에 없음. Studio → Table Editor → admins 에 추가하거나, 기존 관리자가 설정 화면에서 추가 |
| `api/health` 가 `"db":"down"` | `docker/.env` 의 `SUPABASE_SERVICE_ROLE_KEY` 오타, 또는 앱이 Supabase 네트워크에 못 붙음 → `docker network ls` 에 `supabase_default` 가 있는지 확인 |
| `network supabase_default declared as external, but could not be found` | Supabase 스택이 안 떠 있거나 네트워크 이름이 다름. `docker network ls` 로 실제 이름을 확인해 `docker/.env` 의 `SUPABASE_NETWORK` 에 넣는다 |
| Caddy 가 인증서를 못 받음 | 80 포트가 외부에서 막혀 있거나 DNS 가 아직 전파 안 됨. `docker compose logs caddy` 에 `acme` 오류 확인. DNS 는 최대 수 시간 걸림 |
| 컨테이너가 `unhealthy` | `docker compose logs <이름>` 으로 원인 확인. Supabase 쪽은 첫 기동 시 2~3분 걸릴 수 있음 |
| 포트 충돌 (`address already in use`) | 다른 프로그램이 3000/8000/80/443 사용 중. `sudo lsof -i :3000` 으로 찾아 종료하거나 `docker/.env` 의 `APP_PORT` 변경 |
| 크론이 UTC 로 돔 | `docker compose exec cron date` 가 KST 가 아니면 이미지 재빌드: `docker compose build cron && docker compose up -d cron` |
| 메일이 안 나감 | `RESEND_API_KEY` 비어 있음 또는 도메인 미인증. 관리자 화면 설정 → 발신 테스트 메일로 확인 |
| 디스크 부족 | `docker system prune -f` 로 안 쓰는 이미지 정리. `docker/backups` 오래된 파일 정리 |

---

## 부록

### Vercel 배포와의 차이

| 항목 | Vercel | Docker (이 문서) |
|---|---|---|
| 배치 실행 | `vercel.json` Cron | `cron` 컨테이너 (`docker/cron/crontab`) |
| HTTPS | 자동 | Caddy 가 자동 발급 |
| 환경변수 | Vercel 대시보드 | `docker/.env` |
| DB·Auth | Supabase 클라우드 | Supabase 셀프호스팅 (`supabase-project/`) |
| 배포 | git push | `git pull && docker compose up -d --build` |
| 백업 | Supabase Pro 자동 | `docker/backup.sh` + crontab |
| 비용 | 플랜 요금 | 서버 비용만 |

### 환경변수는 어느 파일에 들어가나

| 파일 | 내용 |
|---|---|
| `supabase-project/.env` | Supabase 스택 전용. `POSTGRES_PASSWORD`, `JWT_SECRET`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `DASHBOARD_*`, `SITE_URL`, `API_EXTERNAL_URL`, `SUPABASE_PUBLIC_URL`, `KONG_HTTP_PORT`, `GOOGLE_*` |
| `AI-Account-Concierge/docker/.env` | 앱 스택 전용. `NEXT_PUBLIC_*`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VAULT_KEY`, `APP_SECRET`, `CRON_SECRET`, `RESEND_API_KEY`, `DOMAIN` |
| `AI-Account-Concierge/.env.local` | 내 PC 에서 시드·가져오기 스크립트를 돌릴 때만. `docker/.env` 복사본에서 `SUPABASE_URL` 만 localhost 로 |

같은 키를 다른 이름으로 두 번 쓰는 곳:
`SUPABASE_SECRET_KEY`(Supabase) = `SUPABASE_SERVICE_ROLE_KEY`(앱),
`SUPABASE_PUBLISHABLE_KEY`(Supabase) = `NEXT_PUBLIC_SUPABASE_ANON_KEY`(앱).

### 비밀 값 보관 규칙

- `.env` 파일은 절대 git 에 올리지 않습니다(`.gitignore` 에 이미 제외돼 있음).
- `VAULT_KEY`, `APP_SECRET`, `CRON_SECRET`, `supabase-project/.env` 전체를 기관 비밀번호 관리소에 보관합니다.
- `VAULT_KEY` 를 바꾸면 기존에 저장된 계정 비밀번호를 전부 읽을 수 없게 됩니다. **바꾸지 마세요.**

### 이 문서로 검증한 것 / 못 한 것 (Fact)

- 검증함: `Dockerfile` 이 만드는 standalone 번들 기동(`/` 200, `/api/health` 응답), `docker compose config` 문법(로컬·서버 프로필), `setup.sh --dry-run` 치환 값, Supabase v0.8.1 의 `.env` 키 이름·게이트웨이 별칭(`kong`)·포트 매핑 방식.
- 검증 못 함(이 문서를 쓴 환경에 Docker 데몬이 없음): 실제 이미지 빌드, Supabase 스택 기동, Google 로그인, Let's Encrypt 발급. 각 단계의 「확인」 항목으로 직접 검증하세요.
