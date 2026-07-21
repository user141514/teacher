# 教练助手（teacher）

面向管理者的团队辅导智能体。它先收集员工的能力与意愿证据，再按知识库完成类型判定，随后用 GROW/SBI 组织辅导方案，并在本次会话内根据反馈迭代建议。

## 当前状态

- 前端由 Node 服务提供，并通过同源 `/api` 调用教练流程接口。
- Markdown 解析器已固定版本并随项目离线打包，预览时不请求 CDN。
- `prompts/system.md` 与 `knowledge/ability-willingness-grid.md` 是当前 v2 运行真源。
- `tests/prompt-cases.md` 是提示词行为验收集；服务端单元测试与 Playwright 端到端测试分别覆盖接口边界和前端流程。

## 目录

```text
teacher/
├─ frontend/                               # 前端页面、样式与 Markdown 渲染
├─ frontend/markdown-renderer.js          # 模型自由文本的安全渲染边界
├─ frontend/vendor/markdown-it.min.js     # 固定版本的离线解析器
├─ server/                                 # Express API 与教练服务
├─ scripts/start.ps1                       # PowerShell 一键启动脚本
├─ prompts/system.md                      # v2 全流程提示词
├─ knowledge/ability-willingness-grid.md  # 能力×意愿知识库（单一事实源）
├─ tests/                                 # 服务端与前端自动化测试
└─ docs/legacy-combined.md                # 旧版合并稿，仅供追溯
```

`docs/legacy-combined.md` 缺少 v2 新增的 D1/D2 区分、GROW/SBI 与合并知识库规则，不得用于生产配置。

## 本地启动

需要 Node.js 20 或更高版本。

首次使用时，在本目录执行：

```powershell
Copy-Item .env.example .env
# 在 .env 中仅填写本机的 API 密钥
npm.cmd install
./scripts/start.ps1
```

完成首次配置后，也可以直接双击项目根目录的 `start.bat`。该入口会复用同一份 PowerShell 启动逻辑，并自动处理当前进程的执行策略。

`./scripts/start.ps1` 会检查 Node.js、`.env`、`node_modules` 和配置端口。启动成功后，Node 服务在当前终端前台运行并持续显示日志；请保持终端打开。关闭该终端或按 `Ctrl+C` 会停止本次启动的服务并释放端口。

如果 `.env` 配置的端口已经被其他程序占用，脚本会安全退出并保留原进程，不会复用或强制终止端口占用者。请先关闭原程序，或修改 `.env` 中的 `PORT` 后重试。

只在本机的 `.env` 中填写 `DEEPSEEK_API_KEY`；该文件已被 Git 忽略，不要提交或在文档中粘贴真实密钥。服务启动后访问 `http://127.0.0.1:4173/`。

不希望自动打开浏览器时：

```powershell
./scripts/start.ps1 -NoBrowser
```

只检查启动前置条件、但不启动服务时：

```powershell
./scripts/start.ps1 -CheckOnly
```

## 教练 API 流程

页面按以下四步调用同源 API；每一步只传递所需的结构化字段，并校验返回数据：

1. `POST /api/coach/intake`：审查员工资料是否足以进入评估，并生成需要补充的问题。
2. `POST /api/coach/classify`：按能力 × 意愿证据完成类型判定，或返回待补充/待人工确认状态。
3. `POST /api/coach/plan`：根据判定生成 GROW/SBI 辅导方案；重新生成会携带上一次方案。
4. `POST /api/coach/feedback`：基于辅导反馈给出下一步建议。

运行状态可通过 `GET /api/health` 检查。

### 步骤 2 字段语义

DeepSeek 原始分类响应使用 `confidence`；服务端校验后会显式转换为应用/API 字段 `classification_confidence`，页面将其显示为“判断可信度”。该字段只表示类型判定的可靠程度，不是员工本人完成任务的信心。员工信心当前只在步骤 4 的 `progress_read` 叙述中描述，本期不新增 `employee_confidence` 字段。

已判定结果还会返回严格映射的 `strategy`、`coach_mode` 以及引用具体输入证据的 `reason`。当状态为“待补充”或“待人工确认”时，`type_id`、`strategy` 和 `coach_mode` 均不会生成，并且接口不允许进入方案生成。

## 测试

```powershell
npm.cmd install
npx.cmd playwright install chromium
npm.cmd test
```

只运行浏览器端到端测试时使用：

```powershell
npx.cmd playwright test
```

Playwright 会自动启动本项目的 Node 服务，并路由拦截 `/api/coach/*` 请求，因此测试不会发送真实模型请求或产生模型费用。

完整审查结论见 `docs/adversarial-review.md`。

## Markdown 渲染约定

模型返回的叙述性字段必须传入 `renderMarkdown(element, text)`，不得直接拼接到 `innerHTML`。当前覆盖标题、粗体/斜体、删除线、有序/无序列表、引用、表格、链接、行内代码和围栏代码块；原始 HTML 始终按文字显示。链接只允许 `http`、`https`、`mailto`，远程图片只显示替代文字，不发起图片请求。

生产接入仍须先校验提示词约定的 JSON Schema，再逐字段渲染；类型、状态、置信度等原子字段继续使用 `textContent`，不能把模型整段响应直接当 Markdown。

## 数据与集成边界

员工资料属于敏感职场数据，产品仅支持当前浏览器会话内的辅导流程：刷新页面后输入和方案不保留，服务端不提供跨会话记忆、员工档案或历史辅导记录。

当前不集成身份认证、权限管理、HRIS、绩效系统、企业消息或日历；也不把辅导建议用于自动化的人事决策。涉及晋升、淘汰、调薪、处分等高风险人事决策时，接口会转交 HR 处理。
