#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn: spawnChild } = require('child_process');
const os = require('os');

// ── Constants ──
const START_PORT = 3456;
const MAX_PORT_SCAN = 100;
const POLL_TIMEOUT_MS = 120_000;
const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MB
const MAX_SELECTED_TEXT = 80;
const CLEANUP_EXIT_DELAY_MS = 100;
const SIGINT_FORCE_CLEANUP_MS = 3000;
const MAX_MESSAGE_QUEUE = 100;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
};

// ── Parse CLI args (claude is always the command) ──
const rawArgs = process.argv.slice(2);
const hasSkipPerms = rawArgs.includes('-y') || rawArgs.includes('--allow-dangerously-skip-permissions');
const claudeArgs = rawArgs.map(a => a === '-y' ? '--allow-dangerously-skip-permissions' : a);

if (hasSkipPerms) {
  process.stderr.write('\x1b[33m⚠ WARNING: Running with --allow-dangerously-skip-permissions. Claude will execute tools without confirmation.\x1b[0m\n');
}

const userShell = process.env.SHELL || '/bin/bash';
const command = userShell;
const commandArgs = ['-ic', ['claude', ...claudeArgs].join(' ')];

// ── Dependencies ──
let pty;
try {
  pty = require('node-pty');
} catch (e) {
  console.error('node-pty not installed. Run: /install-live-mirror');
  process.exit(1);
}

let WebSocket;
try {
  WebSocket = require('ws');
} catch (e) {
  console.error('ws not installed. Run: /install-live-mirror');
  process.exit(1);
}

// ── State ──
const cols = process.stdout.columns || 80;
const rows = process.stdout.rows || 24;
let ptyProcess = null;
let serverPort = null;
const terminalClients = new Set();
const commentClients = new Set();
const messageQueue = [];
const pollWaiters = [];

function resolveNextPoll() {
  while (pollWaiters.length > 0 && messageQueue.length > 0) {
    const { res, timer } = pollWaiters.shift();
    clearTimeout(timer);
    const msg = messageQueue.shift();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(msg));
  }
}

// ── PTY spawn (deferred until server is listening) ──
const ptyEnv = { ...process.env, TERM: 'xterm-256color' };
// Remove Claude Code session vars to allow nested claude invocation
delete ptyEnv.CLAUDE_CODE;
delete ptyEnv.CLAUDECODE;
delete ptyEnv.CLAUDE_CODE_SESSION;
delete ptyEnv.CLAUDE_CODE_ENTRYPOINT;

function spawnPty() {
  ptyProcess = pty.spawn(command, commandArgs, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: process.cwd(),
    env: ptyEnv,
  });

  // PTY output → local terminal + WebSocket broadcast
  ptyProcess.onData((data) => {
    process.stdout.write(data);

    const buf = Buffer.from(data, 'utf-8');
    for (const ws of terminalClients) {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(buf); } catch { /* ws.send may fail on closing socket */ }
      }
    }
  });

  // PTY exit → cleanup
  ptyProcess.onExit(({ exitCode }) => {
    cleanup(exitCode);
  });
}

// Local stdin → PTY
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}
process.stdin.resume();
process.stdin.on('data', (data) => {
  if (ptyProcess) ptyProcess.write(data.toString());
});

// Terminal resize → PTY + WebSocket notification
process.stdout.on('resize', () => {
  const newCols = process.stdout.columns;
  const newRows = process.stdout.rows;
  if (ptyProcess) ptyProcess.resize(newCols, newRows);
  broadcastTerminalJSON({ type: 'resize', cols: newCols, rows: newRows });
});

let cleaningUp = false;
function cleanup(exitCode = 0) {
  if (cleaningUp) return;
  cleaningUp = true;
  // Notify browser clients to close their windows before disconnecting
  const shutdownMsg = JSON.stringify({ type: 'shutdown' });
  for (const ws of terminalClients) {
    try { if (ws.readyState === WebSocket.OPEN) ws.send(shutdownMsg); } catch { /* ws may be closing */ }
  }
  for (const ws of commentClients) {
    try { if (ws.readyState === WebSocket.OPEN) ws.send(shutdownMsg); } catch { /* ws may be closing */ }
  }
  for (const ws of terminalClients) {
    try { ws.close(1000, 'PTY exited'); } catch { /* already closed */ }
  }
  for (const ws of commentClients) {
    try { ws.close(1000, 'PTY exited'); } catch { /* already closed */ }
  }
  // Flush waiting polls
  while (pollWaiters.length > 0) {
    const { res, timer } = pollWaiters.shift();
    clearTimeout(timer);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ done: true }));
  }
  if (process.stdin.isTTY) {
    try { process.stdin.setRawMode(false); } catch { /* stdin may be destroyed */ }
  }
  process.stdin.pause();
  if (httpServer) {
    try { httpServer.close(); } catch { /* server may not be listening */ }
  }
  setTimeout(() => process.exit(exitCode), CLEANUP_EXIT_DELAY_MS);
}

process.on('SIGINT', () => {
  if (ptyProcess) {
    ptyProcess.kill('SIGINT');
    // Force cleanup if PTY doesn't exit within timeout
    setTimeout(() => {
      if (!cleaningUp) cleanup(130);
    }, SIGINT_FORCE_CLEANUP_MS);
  } else {
    cleanup(130);
  }
});
process.on('SIGTERM', () => { cleanup(); });

// ── Helpers: broadcast ──
function broadcastTerminalJSON(obj) {
  const msg = JSON.stringify(obj);
  for (const ws of terminalClients) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(msg); } catch { /* ws.send may fail on closing socket */ }
    }
  }
}

function broadcastCommentJSON(obj) {
  const msg = JSON.stringify(obj);
  for (const ws of commentClients) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(msg); } catch { /* ws.send may fail on closing socket */ }
    }
  }
}

// ── HTTP server ──
const publicDir = path.join(__dirname, 'public');

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;
    req.on('data', (c) => {
      if (settled) return;
      totalBytes += c.length;
      if (totalBytes > MAX_BODY_BYTES) {
        settled = true;
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString());
    });
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

const httpServer = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;

  const allowedOrigin = `http://localhost:${serverPort}`;
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Status endpoint
  if (req.method === 'GET' && pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      cols: ptyProcess ? ptyProcess.cols : cols,
      rows: ptyProcess ? ptyProcess.rows : rows,
      pid: ptyProcess ? ptyProcess.pid : null,
    }));
    return;
  }

  // Submit comments + message → inject to PTY + queue for poll
  if (req.method === 'POST' && pathname === '/api/submit') {
    try {
      const body = await readBody(req);
      const { comments = [], message, batchId } = JSON.parse(body);

      // Build formatted text for tracking (PTY input is handled via WebSocket)
      const parts = [];
      for (const c of comments) {
        const ref = c.selectedText ? `[Re: "${c.selectedText.substring(0, MAX_SELECTED_TEXT)}"] ` : '';
        parts.push(`${ref}${c.comment}`);
      }
      if (message) parts.push(message);
      const text = parts.join('\n\n');

      if (text) {
        // Queue for poll (so the parent session can also receive it)
        const entry = { text, at: new Date().toISOString() };
        if (messageQueue.length >= MAX_MESSAGE_QUEUE) messageQueue.shift();
        messageQueue.push(entry);
        resolveNextPoll();

        // Notify comment WS clients
        if (comments.length > 0) {
          const batch = comments.map(c => ({ ...c, submittedAt: entry.at }));
          broadcastCommentJSON({ type: 'comments', comments: batch, batchId: batchId || null });
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch {
      /* invalid JSON or oversized body */
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request' }));
    }
    return;
  }

  // Long-poll: wait for next message (timeout 120s)
  if (req.method === 'GET' && pathname === '/api/poll') {
    if (messageQueue.length > 0) {
      const msg = messageQueue.shift();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(msg));
      return;
    }

    const timer = setTimeout(() => {
      const idx = pollWaiters.findIndex(w => w.res === res);
      if (idx !== -1) pollWaiters.splice(idx, 1);
      res.writeHead(204);
      res.end();
    }, POLL_TIMEOUT_MS);

    pollWaiters.push({ res, timer });
    req.on('close', () => {
      clearTimeout(timer);
      const idx = pollWaiters.findIndex(w => w.res === res);
      if (idx !== -1) pollWaiters.splice(idx, 1);
    });
    return;
  }

  // Get all pending messages (non-blocking)
  if (req.method === 'GET' && pathname === '/api/messages') {
    const messages = messageQueue.splice(0);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ messages }));
    return;
  }

  // Shutdown
  if (req.method === 'POST' && pathname === '/api/done') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    setTimeout(() => cleanup(0), CLEANUP_EXIT_DELAY_MS);
    return;
  }

  // Serve static files from public directory
  if (req.method === 'GET') {
    const requestedFile = pathname === '/' ? 'index.html' : pathname.slice(1);
    const filePath = path.resolve(publicDir, requestedFile);

    // Prevent directory traversal
    if (filePath !== publicDir && !filePath.startsWith(publicDir + path.sep)) {
      res.writeHead(403); res.end('Forbidden');
      return;
    }

    try {
      const content = fs.readFileSync(filePath);
      const ext = path.extname(filePath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch {
      /* file not found */
      res.writeHead(404); res.end('Not Found');
    }
    return;
  }

  res.writeHead(404); res.end('Not Found');
});

// ── WebSocket server (noServer mode) ──
const wss = new WebSocket.WebSocketServer({ noServer: true });

httpServer.on('upgrade', (request, socket, head) => {
  // Validate Origin to prevent cross-origin WebSocket hijacking
  const origin = request.headers.origin || '';
  if (origin && origin !== `http://localhost:${serverPort}`) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  const pathname = new URL(request.url, 'http://localhost').pathname;

  if (pathname === '/ws/terminal') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      terminalClients.add(ws);

      ws.send(JSON.stringify({
        type: 'resize',
        cols: ptyProcess ? ptyProcess.cols : cols,
        rows: ptyProcess ? ptyProcess.rows : rows,
      }));

      ws.on('message', (msg) => {
        try {
          const data = JSON.parse(msg.toString());
          if (data.type === 'input' && data.data && ptyProcess) {
            ptyProcess.write(data.data);
          }
        } catch { /* ignore malformed WebSocket message */ }
      });

      ws.on('close', () => { terminalClients.delete(ws); });
      ws.on('error', () => { terminalClients.delete(ws); });
    });
  } else if (pathname === '/ws/comments') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      commentClients.add(ws);
      ws.on('close', () => { commentClients.delete(ws); });
      ws.on('error', () => { commentClients.delete(ws); });
    });
  } else {
    socket.destroy();
  }
});

// ── Port detection + start ──
function tryListen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

async function listenOnAvailablePort(server, startPort, maxAttempts = MAX_PORT_SCAN) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await tryListen(server, startPort + i);
      return startPort + i;
    } catch (e) {
      if (e.code !== 'EADDRINUSE') throw e;
    }
  }
  throw new Error('No available port found');
}

function openBrowser(url) {
  const isWSL = process.env.WSL_DISTRO_NAME || (os.release && os.release().includes('microsoft'));
  if (isWSL) {
    spawnChild('powershell.exe', ['-NoProfile', '-Command', `Start-Process '${url}'`], { stdio: 'ignore' });
  } else if (os.platform() === 'darwin') {
    spawnChild('open', [url], { stdio: 'ignore' });
  } else if (os.platform() === 'linux') {
    spawnChild('xdg-open', [url], { stdio: 'ignore' });
  }
}

async function start() {
  serverPort = await listenOnAvailablePort(httpServer, START_PORT);
  const url = `http://localhost:${serverPort}`;
  process.stderr.write(`PORT=${serverPort}\n`);
  process.stderr.write(`Claude Live Mirror: ${url}\n`);
  spawnPty();
  openBrowser(url);
}

start().catch(err => { console.error(err); process.exit(1); });
