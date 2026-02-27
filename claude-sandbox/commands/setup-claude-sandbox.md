---
name: setup-claude-sandbox
description: 현재 프로젝트에 .claude-sandbox 환경을 설치
argument-hint: "[--build]"
allowed-tools: ["Bash", "Read", "Write", "AskUserQuestion"]
---

Set up a project-local `.claude-sandbox/` directory with Dockerfile, build script, and run script tailored to the project's tech stack.

## Instructions

### 1. Check if already set up

Check if `.claude-sandbox/Dockerfile` already exists in the current working directory.
If it does, inform the user and ask if they want to overwrite it. If not, stop.

### 2. Ask base image

Use AskUserQuestion to let the user choose a base image:

| Option | Label | Description |
|--------|-------|-------------|
| 1 | Node 22 (Recommended) | node:22-slim — JS/TS 프로젝트에 적합 |
| 2 | Java 17 | eclipse-temurin:17-jdk-jammy — Spring Boot, Gradle 등 |
| 3 | Java 21 | eclipse-temurin:21-jdk-jammy — 최신 LTS Java 프로젝트 |

### 3. Ask authentication method

Use AskUserQuestion to let the user choose an authentication method:

| Option | Label | Description |
|--------|-------|-------------|
| 1 | 구독 계정 (Recommended) | 컨테이너 첫 실행 시 `/login`으로 로그인 (Pro/Max/Team) |
| 2 | API Key | ANTHROPIC_API_KEY를 `.env`에 저장합니다 (종량제) |

**If 구독 계정:**
- Do not create `.env`.
- Inform the user:
  - 첫 실행 시 컨테이너 안에서 `/login`으로 로그인하세요.
  - 컨테이너가 유지되므로 다음 실행부터 자동 로그인됩니다.

**If API Key:**
- Use AskUserQuestion to ask the user to input their API key (free-text via "Other" option). The question should be: "ANTHROPIC_API_KEY를 입력하세요." with a single option "sk-ant-... 형태의 키를 Other에 입력하세요" so the user naturally enters their key via the Other field.
- Validate that the input starts with `sk-`. If not, warn the user and ask again.
- Store as `ANTHROPIC_API_KEY=<key>` for writing to `.env` in step 5.

### 4. Create `.claude-sandbox/` directory

Run `mkdir -p .claude-sandbox` in the current working directory.

### 5. Write `.env` file (if API Key was chosen)

Only if the user chose API Key in step 3, write `.claude-sandbox/.env`:

```
ANTHROPIC_API_KEY=<user's key>
```

Do NOT write `.env` if the user chose "구독 계정".

**IMPORTANT:** After writing, immediately warn the user:
> `.claude-sandbox/.env`에 인증 정보가 저장되었습니다. 이 파일은 절대 git에 커밋하지 마세요.

### 6. Write Dockerfile

Write `.claude-sandbox/Dockerfile` based on the user's selection:

All Dockerfiles share a common entrypoint wrapper script pattern (from nanoclaw).
The entrypoint sources `/workspace/env-dir/env` if mounted, then exec's `claude`.

**If Node 22:**

```dockerfile
FROM node:22-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends git curl && \
    rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

# Entrypoint: source env file if mounted, then exec claude
RUN printf '#!/bin/bash\nset -e\n[ -f /workspace/env-dir/env ] && set -a && . /workspace/env-dir/env && set +a\nexec claude "$@"\n' > /usr/local/bin/entrypoint.sh && chmod +x /usr/local/bin/entrypoint.sh

USER node
WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
```

**If Java 17:**

```dockerfile
FROM eclipse-temurin:17-jdk-jammy

RUN apt-get update && \
    apt-get install -y --no-install-recommends git curl && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

# Entrypoint: source env file if mounted, then exec claude
RUN printf '#!/bin/bash\nset -e\n[ -f /workspace/env-dir/env ] && set -a && . /workspace/env-dir/env && set +a\nexec claude "$@"\n' > /usr/local/bin/entrypoint.sh && chmod +x /usr/local/bin/entrypoint.sh

RUN groupadd -g 1000 appuser && useradd -u 1000 -g appuser -m appuser

USER appuser
WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
```

**If Java 21:**

```dockerfile
FROM eclipse-temurin:21-jdk-jammy

RUN apt-get update && \
    apt-get install -y --no-install-recommends git curl && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

# Entrypoint: source env file if mounted, then exec claude
RUN printf '#!/bin/bash\nset -e\n[ -f /workspace/env-dir/env ] && set -a && . /workspace/env-dir/env && set +a\nexec claude "$@"\n' > /usr/local/bin/entrypoint.sh && chmod +x /usr/local/bin/entrypoint.sh

RUN groupadd -g 1000 appuser && useradd -u 1000 -g appuser -m appuser

USER appuser
WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
```

### 7. Write build.sh

Write `.claude-sandbox/build.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_NAME="$(basename "$(dirname "$SCRIPT_DIR")")"
IMAGE_NAME="claude-sandbox-${PROJECT_NAME}:latest"

echo "Building ${IMAGE_NAME}..."
docker build -t "$IMAGE_NAME" "$SCRIPT_DIR"
echo "Done. Image: ${IMAGE_NAME}"
```

### 8. Write run.sh

Write `.claude-sandbox/run.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_NAME="$(basename "$PROJECT_DIR")"
IMAGE_NAME="claude-sandbox-${PROJECT_NAME}:latest"
CONTAINER_NAME="claude-sandbox-${PROJECT_NAME}"

# Build image if it doesn't exist
if ! docker image inspect "$IMAGE_NAME" &>/dev/null; then
  echo "Image not found. Building ${IMAGE_NAME}..."
  bash "$SCRIPT_DIR/build.sh"
fi

# If container already exists, restart and reattach
if docker container inspect "$CONTAINER_NAME" &>/dev/null; then
  echo "Reattaching to existing container: ${CONTAINER_NAME}..."
  exec docker start -ai "$CONTAINER_NAME"
fi

# Mount .env as /workspace/env-dir/env if present (API key auth, nanoclaw pattern)
EXTRA_ARGS=()
ENV_FILE="$SCRIPT_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  EXTRA_ARGS+=(--mount "type=bind,source=${ENV_FILE},target=/workspace/env-dir/env,readonly")
fi

exec docker run -it \
  --name "$CONTAINER_NAME" \
  --hostname claude-sandbox \
  -v "${PROJECT_DIR}:/workspace" \
  "${EXTRA_ARGS[@]}" \
  "$IMAGE_NAME" \
  --dangerously-skip-permissions "$@"
```

### 9. Set executable permissions

Run `chmod +x .claude-sandbox/build.sh .claude-sandbox/run.sh`.

### 10. Add to .gitignore

If the user chose API Key auth, ensure `.claude-sandbox/.env` is excluded from version control. This is **mandatory**.

- Check if `.gitignore` exists in the current working directory. If not, create it.
- Check if `.claude-sandbox/.env` is already listed (or covered by a broader pattern). If not, append `.claude-sandbox/.env` to `.gitignore`.

### 11. Build image if requested

If the user passed `--build`, or ask the user if they want to build the image now.
If yes, run `bash .claude-sandbox/build.sh` and show the output.

### 12. Done

Tell the user:
- `.claude-sandbox/` has been created with `Dockerfile`, `build.sh`, `run.sh`
- If API Key auth: `.claude-sandbox/.env`에 인증 정보가 저장되었습니다
- If 구독 계정: 첫 실행 시 컨테이너 안에서 `/login`으로 로그인하세요 (컨테이너가 유지되어 이후 자동 로그인)
- They can customize the Dockerfile further if needed
- To start Claude Code in the sandbox, run in their terminal: `.claude-sandbox/run.sh`
