const assert = require('node:assert/strict');
const {
  existsSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const sourceStartScript = path.join(projectRoot, 'scripts', 'start.ps1');
const sourceBatchScript = path.join(projectRoot, 'start.bat');

function writeFixtureServer(root) {
  const serverDir = path.join(root, 'server');
  mkdirSync(serverDir, { recursive: true });
  writeFileSync(path.join(serverDir, 'index.js'), [
    "const { writeFileSync } = require('node:fs');",
    "const http = require('node:http');",
    "const port = Number(process.env.PORT || 4173);",
    "const server = http.createServer((request, response) => {",
    "  if (request.url === '/api/health') {",
    "    response.writeHead(200, { 'Content-Type': 'application/json' });",
    "    response.end(JSON.stringify({ ok: true }));",
    "    return;",
    '  }',
    '  response.writeHead(404);',
    "  response.end('Not Found');",
    '});',
    "server.listen(port, '127.0.0.1', () => {",
    "  writeFileSync('server.pid', String(process.pid));",
    "  process.stdout.write('FIXTURE_READY\\n');",
    '});',
    "process.on('SIGTERM', () => server.close(() => process.exit(0)));",
  ].join('\n'), 'utf8');
}

async function getAvailablePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => (
    error ? reject(error) : resolve()
  )));
  return port;
}

async function isHealthy(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(500),
    });
    return response.ok && (await response.json()).ok === true;
  } catch {
    return false;
  }
}

async function waitFor(predicate, message, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}

function stopProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  spawnSync('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
    windowsHide: true,
    stdio: 'ignore',
  });
}

function stopRecordedService(root) {
  const pidPath = path.join(root, 'server.pid');
  if (!existsSync(pidPath)) return;
  stopProcessTree(Number(readFileSync(pidPath, 'utf8').trim()));
}

function createWorkspace(t, {
  withEnv = false,
  withNodeModules = false,
  withServer = false,
  port = 4173,
} = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'coach-start-script-'));
  const scriptsDir = path.join(root, 'scripts');

  mkdirSync(scriptsDir, { recursive: true });
  copyFileSync(path.join(projectRoot, '.env.example'), path.join(root, '.env.example'));
  if (existsSync(sourceStartScript)) {
    copyFileSync(sourceStartScript, path.join(scriptsDir, 'start.ps1'));
  } else {
    writeFileSync(path.join(scriptsDir, 'start.ps1'), 'exit 0\n', 'utf8');
  }
  if (existsSync(sourceBatchScript)) {
    copyFileSync(sourceBatchScript, path.join(root, 'start.bat'));
  }

  if (withEnv) {
    writeFileSync(path.join(root, '.env'), `DEEPSEEK_API_KEY=not-real\nPORT=${port}\n`, 'utf8');
  }
  if (withNodeModules) {
    mkdirSync(path.join(root, 'node_modules'));
  }
  if (withServer) {
    writeFixtureServer(root);
  }

  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function runStartScript(root, args) {
  return spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/start.ps1', ...args],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    },
  );
}

function runBatchScript(root, args) {
  return spawnSync(
    'cmd.exe',
    ['/d', '/c', 'start.bat', ...args],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    },
  );
}

function spawnBatchScript(root, args) {
  return spawn(
    'cmd.exe',
    ['/d', '/c', 'start.bat', ...args],
    {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
}

function waitForHealthServer(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('health server did not start')), 5_000);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.stdout.once('data', (chunk) => {
      clearTimeout(timeout);
      if (chunk.toString().includes('READY')) {
        resolve();
        return;
      }
      reject(new Error(`health server failed: ${chunk}`));
    });
  });
}

function startHealthServer(port = 4173) {
  const serverSource = [
    "const http = require('node:http');",
    "http.createServer((request, response) => {",
    "  if (request.url === '/api/health') {",
    "    response.writeHead(200, { 'Content-Type': 'application/json' });",
    "    response.end(JSON.stringify({ ok: true }));",
    "    return;",
    '  }',
    '  response.writeHead(404);',
    "  response.end('Not Found');",
    `}).listen(${port}, '127.0.0.1', () => process.stdout.write('READY\\n'));`,
  ].join('\n');
  const child = spawn(process.execPath, ['-e', serverSource], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  return { child, ready: waitForHealthServer(child) };
}

test('缺少 .env 时返回安全的修复提示', (t) => {
  const root = createWorkspace(t);
  const result = runStartScript(root, ['-CheckOnly', '-NoBrowser']);

  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /缺少 \.env/);
  assert.doesNotMatch(result.stdout, /DEEPSEEK_API_KEY=/);
});

test('缺少 node_modules 时提示安装依赖', (t) => {
  const root = createWorkspace(t, { withEnv: true });
  const result = runStartScript(root, ['-CheckOnly', '-NoBrowser']);

  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /npm\.cmd install/);
});

test('CheckOnly 在前置条件满足时不启动服务', async (t) => {
  const port = await getAvailablePort();
  const root = createWorkspace(t, { withEnv: true, withNodeModules: true, port });
  const result = runStartScript(root, ['-CheckOnly', '-NoBrowser']);

  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /环境检查通过/);
});

test('根目录批处理入口会转发参数并复用 PowerShell 启动脚本', async (t) => {
  const port = await getAvailablePort();
  const root = createWorkspace(t, { withEnv: true, withNodeModules: true, port });
  const result = runBatchScript(root, ['-CheckOnly', '-NoBrowser']);

  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /环境检查通过/);
});

test('端口已被占用时安全退出且不终止原服务', async (t) => {
  const port = await getAvailablePort();
  const root = createWorkspace(t, {
    withEnv: true,
    withNodeModules: true,
    withServer: true,
    port,
  });
  const { child, ready } = startHealthServer(port);
  t.after(() => child.kill());
  await ready;

  const result = runStartScript(root, ['-NoBrowser']);

  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /端口.*已被占用.*未启动服务/);
  assert.equal(child.exitCode, null);
  assert.equal(await isHealthy(port), true);
});

test('start.bat 在服务运行时占用终端且关闭后释放本次端口', async (t) => {
  const port = await getAvailablePort();
  const root = createWorkspace(t, {
    withEnv: true,
    withNodeModules: true,
    withServer: true,
    port,
  });
  let launcher;

  try {
    launcher = spawnBatchScript(root, ['-NoBrowser']);
    await waitFor(() => isHealthy(port), 'fixture service did not become healthy');

    assert.equal(launcher.exitCode, null);

    stopProcessTree(launcher.pid);
    await waitFor(() => launcher.exitCode !== null, 'startup terminal did not exit');
    await waitFor(async () => !(await isHealthy(port)), 'service port was not released');

    const probe = http.createServer();
    await new Promise((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(port, '127.0.0.1', resolve);
    });
    await new Promise((resolve) => probe.close(resolve));
  } finally {
    if (launcher && launcher.exitCode === null) stopProcessTree(launcher.pid);
    stopRecordedService(root);
  }
});
