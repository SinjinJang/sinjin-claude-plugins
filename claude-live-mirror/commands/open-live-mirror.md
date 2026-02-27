---
name: open-live-mirror
description: 명령어를 웹 브라우저에서 라이브 터미널 미러링
argument-hint: "[claude-args...]  (예: --model sonnet, -y)"
allowed-tools: ["Bash"]
---

# Open Live Mirror

claude를 PTY로 감싸서 웹 브라우저에서 실시간 터미널 미러링합니다.
웹에서 터미널 출력을 보고, 코멘트와 메시지를 보낼 수 있습니다.

## 수행 단계

1. **의존성 확인**
   - `${CLAUDE_PLUGIN_ROOT}/node_modules` 디렉토리 존재 여부를 확인합니다.
   - 없으면 먼저 설치합니다:
     ```
     cd ${CLAUDE_PLUGIN_ROOT} && npm install
     ```

2. **서버 실행 (백그라운드)**
   - live-mirror-server.js를 **백그라운드**로 실행합니다 (claude 명령은 자동 고정):
     ```
     node ${CLAUDE_PLUGIN_ROOT}/scripts/live-mirror-server.js [claude-args...]
     ```
   - `-y` 인자는 `--allow-dangerously-skip-permissions`로 변환됩니다.
   - stderr 출력에서 `PORT=<number>` 라인을 파싱하여 포트 번호를 얻습니다.
   - 브라우저는 자동으로 열립니다.

3. **메시지 대기 (백그라운드 poll)**
   - **반드시 `run_in_background: true` 옵션으로** poll을 실행합니다:
     ```
     curl -s http://localhost:<PORT>/api/poll
     ```
   - 이 호출은 웹에서 메시지가 올 때까지 대기하며, 터미널을 블로킹하지 않습니다.
   - 메시지가 도착하면 자동으로 알림을 받습니다.

4. **메시지 처리 및 반복**
   - 알림을 받으면 응답 JSON의 `.text` 필드가 사용자 메시지입니다.
   - `.done` 이 `true`이면 사용자가 Close를 눌렀으므로 종료합니다.
   - 메시지를 처리한 후, 다시 3번으로 돌아가 다음 메시지를 **백그라운드로** 대기합니다.

## 중요 사항

- **poll은 항상 백그라운드(`run_in_background`)로 실행합니다.** 터미널을 블로킹하면 안 됩니다.
- 서버도 백그라운드로 실행합니다.
- 명령어는 항상 `claude`로 고정됩니다. 인자만 전달합니다.
- `-y`는 `--allow-dangerously-skip-permissions`의 축약입니다.
- 웹에서 터미널 출력을 실시간으로 볼 수 있습니다.
- 웹에서 보낸 메시지는 PTY stdin에 직접 주입되고, poll로도 현재 세션에 전달됩니다.
