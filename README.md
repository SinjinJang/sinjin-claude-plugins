# Claude Code 플러그인 모음 

## 플러그인 목록

| 플러그인 | 설명 | 주요 컴포넌트 |
|----------|------|---------------|
| [agora-debate](#agora-debate) | 다중 에이전트 토론 시뮬레이션 | 에이전트 1, 스킬 1 |
| [claude-live-mirror](#claude-live-mirror) | 웹 브라우저에서 실시간 터미널 미러링 + 인라인 코멘트 | 커맨드 2 |
| [claude-sandbox](#claude-sandbox) | Docker 격리 환경에서 Claude Code 실행 | 커맨드 1, 훅 1 |

## 설치

### Marketplace에서 설치

```bash
# 1. Marketplace 등록
claude plugin marketplace add https://github.com/SinjinJang/sinjin-plugins


# 2. 원하는 플러그인 설치
claude plugin install agora-debate
claude plugin install claude-live-mirror
claude plugin install claude-sandbox
```

### 로컬 경로에서 설치

```bash
# 1. Marketplace 등록
claude plugin marketplace add /path/to/sinjin-plugins

# 2. 원하는 플러그인 설치
claude plugin install agora-debate
claude plugin install claude-live-mirror
claude plugin install claude-sandbox
```

---

## agora-debate

고대 그리스 아고라에서 영감을 받은 다중 에이전트 토론 시뮬레이션 플러그인.

### 주요 기능

- 8가지 성격 유형(낙관론자, 비관론자, 현실주의자, 혁신가, 보수주의자, 분석가, 옹호자, 회의론자) 기반 토론
- 5가지 사전 설정 조합: balanced, innovation, critical, risk, opportunity
- 3/5/7인 팀 구성, 순차 발언 또는 자유 토론 모드
- 후속 토론 지원 (이전 결과를 기반으로 심화 토론)
- 결과 자동 저장 (`토론결과_YYYYMMDD_주제요약.md`)

### 사용법

토론 주제를 자연어로 요청하면 debate 스킬이 자동으로 트리거됩니다.

```
"AI 도입의 장단점에 대해 토론해줘"
"이전 토론 결과 파일을 바탕으로 후속 토론 진행해줘"
```

---

## claude-live-mirror

node-pty + WebSocket 기반 양방향 터미널 미러링 플러그인. 웹 브라우저에서 Claude Code 터미널 출력을 실시간으로 확인하고 인라인 코멘트를 작성할 수 있습니다.

### 커맨드

| 커맨드 | 설명 |
|--------|------|
| `/open-live-mirror` | 웹 브라우저에서 라이브 터미널 미러링 시작 |
| `/install-live-mirror` | Live mirror 의존성 설치 (node-pty, ws) |

### 주요 기능

- Claude Code 터미널 출력을 웹에서 실시간 모니터링
- 웹에서 코멘트/메시지를 보내면 PTY stdin에 직접 주입
- 브라우저 자동 열림, 백그라운드 서버 실행

### 사용법

```
/install-live-mirror               # 최초 1회 의존성 설치
/open-live-mirror                  # 미러링 시작
/open-live-mirror --model sonnet   # claude 인자 전달
/open-live-mirror -y               # 권한 자동 승인 모드
```

---

## claude-sandbox

Docker 컨테이너에서 Claude Code를 격리 실행하여 안전한 자율 작업을 수행할 수 있는 환경을 세팅합니다.

### 커맨드

| 커맨드 | 설명 |
|--------|------|
| `/setup-claude-sandbox` | 현재 프로젝트에 `.claude-sandbox` 환경 설치 |

### 주요 기능

- 베이스 이미지 선택: Node 22 (기본), Java 17, Java 21
- 인증 방식 선택: 구독 계정 또는 API Key
- Dockerfile, build.sh, run.sh 자동 생성
- `--build` 옵션으로 즉시 이미지 빌드

### 사용법

```
/setup-claude-sandbox           # 대화형 설정
/setup-claude-sandbox --build   # 설정 후 즉시 빌드
```

---

## 라이선스

MIT
