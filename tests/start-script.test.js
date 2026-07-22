const assert = require('node:assert/strict');
const { existsSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const sourceStartScript = path.join(projectRoot, 'scripts', 'start.ps1');
const sourceBatchScript = path.join(projectRoot, 'start.bat');

function createWorkspace(t, { withEnv = false, withNodeModules = false } = {}) {
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
    writeFileSync(path.join(root, '.env'), 'DEEPSEEK_API_KEY=not-real\nPORT=4173\n', 'utf8');
  }
  if (withNodeModules) {
    mkdirSync(path.join(root, 'node_modules'));
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

function startHealthServer() {
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
    "}).listen(4173, '127.0.0.1', () => process.stdout.write('READY\\n'));",
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

test('CheckOnly 在前置条件满足时不启动服务', (t) => {
  const root = createWorkspace(t, { withEnv: true, withNodeModules: true });
  const result = runStartScript(root, ['-CheckOnly', '-NoBrowser']);

  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /环境检查通过/);
});

test('根目录批处理入口会转发参数并复用 PowerShell 启动脚本', (t) => {
  const root = createWorkspace(t, { withEnv: true, withNodeModules: true });
  const result = runBatchScript(root, ['-CheckOnly', '-NoBrowser']);

  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /环境检查通过/);
});

test('已运行的健康服务会被复用且不启动模型服务', async (t) => {
  const root = createWorkspace(t, { withEnv: true, withNodeModules: true });
  const { child, ready } = startHealthServer();
  t.after(() => child.kill());
  await ready;

  const result = runStartScript(root, ['-NoBrowser']);

  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /服务已在运行/);
});
