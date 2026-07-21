# Teacher Foreground Startup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `start.bat` 启动的教练助手服务与终端保持同一生命周期，关闭终端后释放本次服务端口，并在端口已被占用时安全退出且不终止原进程。

**Architecture:** 保留 `start.bat → scripts/start.ps1` 的单一启动路径。PowerShell 动态读取 `PORT`、检查监听冲突，并用当前终端承载一个可追踪的 Node 子进程；脚本只清理本次 PID，不按端口杀进程。测试使用临时目录、随机本地端口和最小 HTTP fixture，不读取真实 `.env` 或调用外部 API。

**Tech Stack:** Windows Batch、PowerShell 5.1+、Node.js 20、`node:test`、本地 HTTP fixture

---

## 文件职责与范围

- Modify: `scripts/start.ps1`：环境检查、动态端口、安全冲突检查、健康检查、浏览器打开和前台 Node 生命周期。
- Modify: `tests/start-script.test.js`：随机端口、最小服务 fixture、安全冲突与终端生命周期回归测试。
- Modify: `README.md`：说明终端常驻、安全端口策略和关闭终端后的行为。
- Modify: `docs/agent-plans/2026-07-21-teacher-foreground-startup-implementation-plan.md`：验证完成后更新复选框。
- Test only, no expected code change: `start.bat`：继续负责项目目录切换、参数转发和失败暂停。

明确不修改：`frontend/`、`server/`、`prompts/`、`knowledge/`、依赖、API、`.env`、用户现有 Playwright 临时文件和其他未跟踪文档。

---

### Task 1: 动态解析端口并在占用时安全退出

**Files:**
- Modify: `tests/start-script.test.js`
- Modify: `scripts/start.ps1`

- [x] **Step 1: 为测试工作区增加随机端口和本地健康请求工具**

在 `tests/start-script.test.js` 的 `node:fs` 导入中增加 `readFileSync`，并把 `createWorkspace` 改为接受 `port` 与 `withServer`：

```js
const {
  existsSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs');

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
  copyFileSync(sourceStartScript, path.join(scriptsDir, 'start.ps1'));
  copyFileSync(sourceBatchScript, path.join(root, 'start.bat'));

  if (withEnv) {
    writeFileSync(
      path.join(root, '.env'),
      `DEEPSEEK_API_KEY=not-real\nPORT=${port}\n`,
      'utf8',
    );
  }
  if (withNodeModules) mkdirSync(path.join(root, 'node_modules'));
  if (withServer) writeFixtureServer(root);

  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
```

在 `createWorkspace` 前增加最小 fixture 和异步工具：

```js
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
    "  }",
    "  response.writeHead(404);",
    "  response.end('Not Found');",
    "});",
    "server.listen(port, '127.0.0.1', () => {",
    "  writeFileSync('server.pid', String(process.pid));",
    "  process.stdout.write('FIXTURE_READY\\n');",
    "});",
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
```

- [x] **Step 2: 把依赖完整的既有测试切换到随机空闲端口**

将 `CheckOnly 在前置条件满足时不启动服务` 和 `根目录批处理入口会转发参数并复用 PowerShell 启动脚本` 改为 `async` 测试，并在创建工作区前执行：

```js
const port = await getAvailablePort();
const root = createWorkspace(t, { withEnv: true, withNodeModules: true, port });
```

这样聚焦测试不依赖固定 `4173` 是否空闲。

- [x] **Step 3: 增加端口占用安全退出测试**

把 `startHealthServer` 改为接收 `port`：

```js
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
```

删除旧的“已运行的健康服务会被复用且不启动模型服务”测试，替换为：

```js
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
```

- [x] **Step 4: 运行聚焦测试并确认红灯**

Run:

```powershell
node --test --test-name-pattern="端口已被占用" tests/start-script.test.js
```

Expected: FAIL；当前脚本会输出“服务已在运行，复用现有服务”并以状态 `0` 返回。

- [x] **Step 5: 在 PowerShell 中动态解析并校验 PORT**

删除文件顶部硬编码的 `$serviceUrl` 与 `$healthUrl`，在 `Test-HealthyService` 前增加：

```powershell
function Get-ServicePort {
  $rawPort = & $nodeCommand.Source '--env-file=.env' '-p' 'process.env.PORT ?? 4173'
  if ($LASTEXITCODE -ne 0) {
    Stop-WithMessage '无法读取 .env 中的 PORT 配置。'
  }

  [int]$parsedPort = 0
  if (-not [int]::TryParse(([string]$rawPort).Trim(), [ref]$parsedPort)
    -or $parsedPort -lt 1
    -or $parsedPort -gt 65535) {
    Stop-WithMessage 'PORT 配置无效，请填写 1 至 65535 的整数。'
  }

  return $parsedPort
}

function Test-PortInUse {
  param([int]$Port)

  $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
  return $null -ne ($listeners | Where-Object { $_.Port -eq $Port } | Select-Object -First 1)
}
```

在确认 `.env` 与 `node_modules` 后、`$CheckOnly` 判断前增加：

```powershell
$servicePort = Get-ServicePort
$serviceUrl = "http://127.0.0.1:$servicePort/"
$healthUrl = "${serviceUrl}api/health"

if (Test-PortInUse -Port $servicePort) {
  Stop-WithMessage "端口 $servicePort 已被占用，未启动服务。请先关闭占用程序或修改 .env 中的 PORT。"
}
```

删除现有的健康服务复用分支：

```powershell
if (Test-HealthyService) {
  Write-Output '服务已在运行，复用现有服务。'
  Open-ServiceInBrowser
  exit 0
}
```

- [x] **Step 6: 运行启动脚本测试并确认绿灯**

Run:

```powershell
node --test tests/start-script.test.js
```

Expected: 所有测试通过；占用端口的 fixture 仍健康。

- [x] **Step 7: 检查并提交 Task 1**

```powershell
git diff --check
git diff -- scripts/start.ps1 tests/start-script.test.js
git status --short
git add -- scripts/start.ps1 tests/start-script.test.js
git commit -m "feat: reject occupied startup ports"
```

只暂存这两个文件，不得使用 `git add .`。

---

### Task 2: 让服务前台常驻并随终端关闭

**Files:**
- Modify: `tests/start-script.test.js`
- Modify: `scripts/start.ps1`
- Test: `start.bat`

- [x] **Step 1: 增加异步批处理启动器**

在 `runBatchScript` 后增加：

```js
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
```

- [x] **Step 2: 增加前台常驻与端口释放测试**

```js
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
```

该测试通过真实 `start.bat` 入口运行最小本地服务。红灯失败时 `finally` 使用 fixture 写入的 PID 清理后台残留，不按端口杀未知进程。

- [x] **Step 3: 运行生命周期聚焦测试并确认红灯**

Run:

```powershell
node --test --test-name-pattern="start.bat 在服务运行时" tests/start-script.test.js
```

Expected: FAIL；当前 PowerShell 在健康后退出，`launcher.exitCode` 已经是 `0`，后台 Node 仍占用端口。

- [x] **Step 4: 把隐藏后台启动替换为当前终端内的可追踪进程**

用以下主体替换 `scripts/start.ps1` 现有的隐藏 `Start-Process`、健康轮询和成功后 `exit 0` 逻辑：

```powershell
$serviceProcess = $null
try {
  try {
    $serviceProcess = Start-Process `
      -FilePath $nodeCommand.Source `
      -ArgumentList @('--env-file=.env', 'server/index.js') `
      -WorkingDirectory $projectRoot `
      -NoNewWindow `
      -PassThru
  } catch {
    Stop-WithMessage '服务启动失败。请检查 Node.js 安装和项目依赖后重试。'
  }

  $deadline = (Get-Date).AddSeconds(20)
  $healthy = $false
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    if (Test-HealthyService) {
      $healthy = $true
      break
    }
    if ($serviceProcess.HasExited) {
      break
    }
  }

  if (-not $healthy) {
    Stop-WithMessage '服务启动失败，20 秒内未通过健康检查。请检查终端输出后重试。'
  }

  Write-Output "服务已启动：$serviceUrl"
  Open-ServiceInBrowser
  $serviceProcess.WaitForExit()
  exit $serviceProcess.ExitCode
} finally {
  if ($serviceProcess -and -not $serviceProcess.HasExited) {
    Stop-Process -Id $serviceProcess.Id -Force -ErrorAction SilentlyContinue
    [void]$serviceProcess.WaitForExit(5000)
  }
}
```

保留外层 `Push-Location` 的 `try/finally` 和 `Pop-Location`。不得使用 `-WindowStyle Hidden`，不得在退出时按端口查杀进程。

- [x] **Step 5: 运行生命周期聚焦测试并确认绿灯**

Run:

```powershell
node --test --test-name-pattern="start.bat 在服务运行时" tests/start-script.test.js
```

Expected: PASS；启动进程在健康后仍存活，终止进程树后端口能够重新绑定。

- [x] **Step 6: 运行完整启动脚本测试**

Run:

```powershell
node --test tests/start-script.test.js
```

Expected: 全部通过，无残留 `server.pid` 对应进程或监听端口。

- [x] **Step 7: 检查并提交 Task 2**

```powershell
git diff --check
git diff -- scripts/start.ps1 tests/start-script.test.js start.bat
git status --short
git add -- scripts/start.ps1 tests/start-script.test.js
git commit -m "feat: keep startup service in foreground"
```

若 `start.bat` 无需修改，不得暂存它。

---

### Task 3: 更新本地启动说明

**Files:**
- Modify: `README.md:29-58`

- [x] **Step 1: 更新启动行为说明**

把原有“后台启动并复用现有服务”的段落替换为：

```markdown
`./scripts/start.ps1` 会检查 Node.js、`.env`、`node_modules` 和配置端口。启动成功后，Node 服务在当前终端前台运行并持续显示日志；请保持终端打开。关闭该终端或按 `Ctrl+C` 会停止本次启动的服务并释放端口。

如果 `.env` 配置的端口已经被其他程序占用，脚本会安全退出并保留原进程，不会复用或强制终止端口占用者。请先关闭原程序，或修改 `.env` 中的 `PORT` 后重试。
```

保留 `.env` 密钥安全提醒、`-NoBrowser` 和 `-CheckOnly` 示例。

- [x] **Step 2: 检查文档与实际脚本一致**

Run:

```powershell
Select-String -LiteralPath README.md -Pattern '前台运行','Ctrl\+C','端口已经被其他程序占用','不会复用或强制终止'
```

Expected: 四个约束均有匹配；README 不再包含“在后台启动服务”或“复用现有服务”。

- [x] **Step 3: 运行启动脚本聚焦测试**

Run:

```powershell
node --test tests/start-script.test.js
```

Expected: 全部通过。

- [x] **Step 4: 检查并提交 Task 3**

```powershell
git diff --check
git diff -- README.md
git status --short
git add -- README.md
git commit -m "docs: explain foreground startup lifecycle"
```

只暂存 `README.md`，保留用户现有其他改动。

---

### Task 4: 全量回归与计划收尾

**Files:**
- Modify: `docs/agent-plans/2026-07-21-teacher-foreground-startup-implementation-plan.md`

- [x] **Step 1: 确认测试前没有旧服务占用计划测试端口**

测试使用随机空闲端口，不要求关闭用户其他端口。只读检查是否存在本任务 fixture 残留：

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*coach-start-script-*server/index.js*' } | Select-Object ProcessId,CommandLine
```

Expected: 无输出。若有输出，只终止命令行明确位于 `coach-start-script-*` 临时目录的测试 fixture PID，不终止项目服务或其他 Node 进程。

- [x] **Step 2: 运行聚焦和全量测试**

```powershell
node --test tests/start-script.test.js
npm.cmd test
```

Expected: 两条命令均 exit code `0`；Playwright 使用现有 fixture/fake API，不调用真实 DeepSeek。

- [x] **Step 3: 检查空白错误、提交范围与用户改动**

```powershell
git diff --check
git status --short
git diff HEAD -- scripts/start.ps1 tests/start-script.test.js README.md start.bat
git log --oneline -8
```

Expected:

- 已跟踪的本任务代码和 README 已提交；
- `tests/frontend.spec.js`、`.playwright-cli/`、`playwright.reuse-existing.config.js`、其他历史文档和 `output/` 未被修改或暂存；
- `.env`、密钥、缓存和测试报告未进入提交；
- 没有执行部署、安装依赖或真实 API 请求。

- [x] **Step 4: 人工运行验收**

在确认当前 `PORT` 未占用后双击 `start.bat`，验证：

1. 终端保持打开并显示 Node 日志。
2. 页面健康后自动打开浏览器。
3. 关闭终端，随后执行以下命令无监听结果：

```powershell
$port = node --env-file=.env -p "process.env.PORT ?? 4173"
Get-NetTCPConnection -LocalPort ([int]$port) -State Listen -ErrorAction SilentlyContinue
```

该命令只读取 `PORT`，不得显示 `.env` 其他值。若自动化生命周期测试已在当前环境中完整证明同一行为，可记录自动化证据并跳过会打开浏览器的人工步骤。

执行记录（2026-07-21）：未打开浏览器；`start.bat 在服务运行时占用终端且关闭后释放本次端口` 自动化测试已证明服务健康后启动器持续运行、关闭测试进程树后端口可重新绑定。

- [x] **Step 5: 更新计划复选框并提交状态**

只将有命令或代码证据的步骤改为 `- [x]`，然后执行：

```powershell
git add -- docs/agent-plans/2026-07-21-teacher-foreground-startup-implementation-plan.md
git commit -m "docs: record foreground startup implementation"
git status --short
```

不得使用 `git add .`，不得暂存整个 `docs/agent-plans/`。

---

## 完成标准

- `start.bat` 启动的服务在终端前台常驻并输出日志。
- 关闭该终端后，本次 Node 进程结束且配置端口可以重新绑定。
- 端口已占用时脚本安全退出，不复用、不接管、不终止原进程。
- `-CheckOnly`、`-NoBrowser`、自动打开浏览器、环境检查和失败提示仍可用。
- README 与实际行为一致。
- 聚焦测试、全量测试和 `git diff --check` 通过。
- 用户现有工作区改动全部保留且不进入本任务提交。
