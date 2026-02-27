---
name: install-live-mirror
description: Live mirror 의존성 설치 (node-pty, ws)
allowed-tools: ["Bash"]
---

# Install Live Mirror

Live mirror에 필요한 npm 의존성(node-pty, ws)을 설치합니다.

## 수행 단계

1. 플러그인 디렉토리에서 `npm install`을 실행합니다:
   ```
   cd ${CLAUDE_PLUGIN_ROOT} && npm install
   ```

2. 설치 결과를 확인하고 사용자에게 보고합니다.
   - 성공 시: "설치 완료. `/open-live-mirror` 또는 `clm` 커맨드로 사용할 수 있습니다."
   - 실패 시: 에러 메시지를 보여줍니다.
