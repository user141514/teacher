# 教练助手统一加载层与输入保留 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为四步教练流程的全部异步操作增加覆盖当前内容主体的统一转圈加载层，并修复选择员工特征关键词时重置前序未提交表单的问题。

**Architecture:** 保留现有单一内存会话、API 契约和 request epoch（请求版本号）机制。关键词选择改为局部 DOM 更新，不再触发整页重绘；加载状态在现有 `busy` 之外增加 `busyAction`，由统一请求包装器控制至少 300ms 的可见时间，再由 `views.js` 在 `.panel-body` 上渲染同一加载组件。

**Tech Stack:** Node.js 20、Express、Vanilla JavaScript、CSS、Playwright、现有 fixture/fake API。

---

## 1. 范围与约束

只实施以下两项：

1. 所有 AI/API 异步操作显示统一的内容面板加载层：首次审查、再次审查、类型判定、首次方案、换个角度、反馈建议。
2. 选择或取消员工特征关键词时，员工基础信息、目标与困扰以及自由补充文本保持不变。

不得修改：

- `server/`
- `prompts/`
- `knowledge/`
- DeepSeek 配置或请求格式
- Markdown 渲染器安全边界
- 数据库、`localStorage`、`sessionStorage` 或跨会话记忆
- 现有模型名称和后端超时策略

不得读取、显示、复制或提交 `.env` 中的真实密钥。自动化测试必须使用现有 Playwright fixture，不得调用真实 DeepSeek API。

## 2. 已确认的交互设计

### 2.1 加载层

- 覆盖右侧 `.panel-body`，不覆盖工作区页头和底部操作栏。
- 加载时内容主体不可点击、不可聚焦；“返回首页”和“上一步”仍可取消请求。
- 左侧步骤栏继续可见。
- 使用真实请求生命周期，不显示虚假百分比、倒计时或已完成勾选。
- 最短可见时间为 300ms，避免快速响应造成闪烁。
- 成功、失败、被拦截或取消后关闭加载层。
- 迟到响应继续由现有 request epoch 丢弃。
- `.panel-body` 设置 `aria-busy`；加载文案使用 `role="status"` 和 `aria-live="polite"`。
- `prefers-reduced-motion: reduce` 时停止持续旋转，保留静态加载圆环。

动作与文案固定为：

| `busyAction` | 标题 | 处理内容 |
| --- | --- | --- |
| `intake-review` | 正在审查员工信息 | 检查资料完整性；提取能力与意愿证据；整理需要补充的问题 |
| `classification-generate` | 正在匹配员工画像 | 分析能力与意愿证据；匹配最接近的员工画像；整理判断依据 |
| `plan-generate` | 正在生成教练方案 | 读取最终确认画像；组织 GROW/SBI 建议；生成沟通方案 |
| `plan-regenerate` | 正在重新生成方案 | 保留最终确认画像；避开上一版角度；生成新的沟通方案 |
| `feedback-generate` | 正在生成下一步建议 | 分析本次沟通反馈；识别进展与风险；整理下一步行动 |

### 2.2 关键词选择

- `selectedTraits` 继续作为唯一关键词状态。
- 点击和键盘激活关键词按钮时，只更新该按钮的 `.sel` 与 `aria-pressed`。
- `toggleTrait()` 不再调用全局 `render()`。
- 不新增 `intakeDraft`，不把所有表单字段改成实时受控输入。
- 关键词变更本身不调用 API，也不提前清理下游结果；用户重新提交员工信息时继续执行现有下游清理逻辑。

## 3. 文件职责

**新增：**

- `frontend/loading.js`：定义动作常量、300ms 最短显示时间和可独立测试的时间计算函数。

**修改：**

- `frontend/state.js`：增加 `busyAction`，确保开始加载时记录动作、结束或重置时清空。
- `frontend/app.js`：关键词局部切换；统一包装请求加载生命周期；为五类动作传入准确的 `busyAction`。
- `frontend/views.js`：局部更新关键词按钮；创建并应用统一加载层；设置 `aria-busy` 与 `inert`。
- `frontend/styles.css`：加载层、圆环、状态列表、响应式和减少动态效果样式。
- `tests/frontend.spec.js`：增加关键词不重置、动作文案、最短显示、错误关闭、取消请求和迟到响应测试。
- `docs/agent-plans/2026-07-21-coach-assistant-loading-overlay-and-intake-preservation-plan.md`：验证后勾选实际完成步骤。

---

### Task 1: 修复关键词选择导致未提交表单重置

**Files:**

- Modify: `frontend/app.js:182-188`
- Modify: `frontend/views.js:482-499`
- Test: `tests/frontend.spec.js:176-248`

- [x] **Step 1: 先增加失败的回归测试**

在 `tests/frontend.spec.js` 的员工输入测试附近加入：

```js
test('选择关键词不会重置尚未提交的员工基础信息和目标困扰', async ({ page }) => {
  await page.goto('/');
  await openIntake(page);

  await page.getByLabel('岗位类别').selectOption({ label: '骨干/带教岗' });
  await page.getByLabel('在团队入职时长').selectOption({ label: '1 年以上' });
  await page.getByLabel('当前绩效状态').selectOption({ label: '波动 / 时好时坏' });
  await page.getByLabel('绩效目标 / 上层期望').fill('本季度独立承接三个项目');
  await page.getByLabel('近期辅导困扰').fill('任务需要反复提醒才推进');
  await page.getByLabel('员工特征补充').fill('最近开始主动提出改进建议。');

  const responsibility = page.locator('.chipset .chip').filter({ hasText: '责任心强' });
  await responsibility.click();
  const recognition = page.locator('.chipset .chip').filter({ hasText: '需要认可' });
  await recognition.focus();
  await page.keyboard.press('Enter');

  await expect(page.getByLabel('岗位类别')).toHaveValue('骨干/带教岗');
  await expect(page.getByLabel('在团队入职时长')).toHaveValue('1 年以上');
  await expect(page.getByLabel('当前绩效状态')).toHaveValue('波动 / 时好时坏');
  await expect(page.getByLabel('绩效目标 / 上层期望')).toHaveValue('本季度独立承接三个项目');
  await expect(page.getByLabel('近期辅导困扰')).toHaveValue('任务需要反复提醒才推进');
  await expect(page.getByLabel('员工特征补充')).toHaveValue('最近开始主动提出改进建议。');
  await expect(responsibility).toHaveAttribute('aria-pressed', 'true');
  await expect(recognition).toHaveAttribute('aria-pressed', 'true');
});
```

- [x] **Step 2: 运行测试并确认按正确原因失败**

```powershell
npx.cmd playwright test tests/frontend.spec.js -g "选择关键词不会重置"
```

预期：FAIL；点击第一个关键词后，岗位、绩效、目标或困扰至少一项恢复默认值或空值。

- [x] **Step 3: 让关键词处理函数只更新状态并返回选中结果**

将 `frontend/app.js` 中的 `toggleTrait()` 改为：

```js
function toggleTrait(trait) {
  const selected = session.selectedTraits.includes(trait)
    ? session.selectedTraits.filter((item) => item !== trait)
    : [...session.selectedTraits, trait];
  setSelectedTraits(selected);
  return session.selectedTraits.includes(trait);
}
```

- [x] **Step 4: 只更新被激活的关键词按钮**

将 `frontend/views.js` 中关键词按钮监听器改为：

```js
chip.addEventListener('click', () => {
  const isSelected = handlers.toggleTrait(keyword);
  chip.classList.toggle('sel', isSelected);
  chip.setAttribute('aria-pressed', String(isSelected));
});
```

不得在关键词点击路径调用 `render()`。浏览器对原生 `button` 的 Enter/Space 激活会继续触发同一个 `click` 监听器。

- [x] **Step 5: 运行聚焦测试**

```powershell
npx.cmd playwright test tests/frontend.spec.js -g "员工特征|关键词不会重置"
```

预期：新增测试和已有关键词测试全部 PASS。

- [x] **Step 6: 检查并提交本任务**

```powershell
git diff --check
git status --short
git add -- frontend/app.js frontend/views.js tests/frontend.spec.js
git commit -m "fix: preserve intake fields when selecting traits"
```

不得使用 `git add .`。

---

### Task 2: 建立可测试的加载动作与最短显示生命周期

**Files:**

- Create: `frontend/loading.js`
- Modify: `frontend/state.js:1-46`
- Test: `tests/frontend.spec.js`

- [x] **Step 1: 先增加加载状态和时间计算的失败测试**

```js
test('加载动作有固定枚举且结束 busy 时会清空当前动作', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const loading = await import('/loading.js');
    const state = await import('/state.js');
    state.resetSession();
    state.setBusy(true, loading.BUSY_ACTIONS.PLAN_REGENERATE);
    const active = {
      busy: state.session.busy,
      action: state.session.busyAction,
      remaining: loading.remainingLoadingDelay(100, 250),
    };
    state.setBusy(false);
    const finished = {
      busy: state.session.busy,
      action: state.session.busyAction,
    };
    return { active, finished };
  });

  expect(result).toEqual({
    active: { busy: true, action: 'plan-regenerate', remaining: 150 },
    finished: { busy: false, action: null },
  });
});
```

- [x] **Step 2: 运行测试并确认模块或字段缺失**

```powershell
npx.cmd playwright test tests/frontend.spec.js -g "加载动作有固定枚举"
```

预期：FAIL；`/loading.js` 不存在，或 `busyAction` 尚未定义。

- [x] **Step 3: 新增纯加载工具模块**

创建 `frontend/loading.js`：

```js
export const MIN_LOADING_MS = 300;

export const BUSY_ACTIONS = Object.freeze({
  INTAKE_REVIEW: 'intake-review',
  CLASSIFICATION_GENERATE: 'classification-generate',
  PLAN_GENERATE: 'plan-generate',
  PLAN_REGENERATE: 'plan-regenerate',
  FEEDBACK_GENERATE: 'feedback-generate',
});

export function remainingLoadingDelay(startedAt, now = performance.now()) {
  return Math.max(0, MIN_LOADING_MS - Math.max(0, now - startedAt));
}

export async function waitForMinimumLoading(startedAt) {
  const remaining = remainingLoadingDelay(startedAt);
  if (remaining > 0) {
    await new Promise((resolve) => window.setTimeout(resolve, remaining));
  }
}
```

- [x] **Step 4: 扩展内存状态但保持原有 `setBusy(false)` 调用兼容**

在 `frontend/state.js`：

```js
const SESSION_KEYS = new Set([
  'screen', 'step', 'busy', 'busyAction', 'intake', 'answers', 'intakeResult',
  'classification', 'plan', 'feedback', 'feedbackText', 'blocked', 'error',
  'submissionKeys', 'selectedProfileId', 'selectedTraits', 'traitNote',
]);
```

在 `createInitialState()` 中让 `busyAction` 初始为 `null`，并替换 setter：

```js
export function setBusy(busy, busyAction = null) {
  const active = Boolean(busy);
  updateSession({
    busy: active,
    busyAction: active ? String(busyAction || '') || null : null,
  });
}
```

`resetSession()` 必须继续通过 `createInitialState()` 清除加载动作。

- [x] **Step 5: 运行聚焦测试和语法检查**

```powershell
node --check frontend\loading.js
node --check frontend\state.js
npx.cmd playwright test tests/frontend.spec.js -g "加载动作有固定枚举"
```

预期：全部 PASS。

- [x] **Step 6: 提交加载状态基础设施**

```powershell
git add -- frontend/loading.js frontend/state.js tests/frontend.spec.js
git commit -m "feat: add coaching loading state model"
```

---

### Task 3: 实现共享内容面板加载层并接入步骤 1、2

**Files:**

- Modify: `frontend/app.js:92-171`
- Modify: `frontend/views.js:21-170,802-808`
- Modify: `frontend/styles.css`
- Test: `tests/frontend.spec.js`

- [x] **Step 1: 增加可控延迟 fixture helper**

在 `tests/frontend.spec.js` 顶部 helper 区域增加：

```js
function deferredFixture(response) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  return {
    handler: async () => {
      await gate;
      return response;
    },
    release,
  };
}
```

- [x] **Step 2: 先增加步骤 1 与步骤 2 的失败测试**

```js
test('员工信息审查期间显示可访问的内容面板加载层', async ({ page }) => {
  const fixtures = defaultFixtures();
  const delayed = deferredFixture(fixtures.intake[0]);
  fixtures.intake[0] = delayed.handler;
  await mockCoachApi(page, fixtures);
  await page.goto('/');
  await fillHome(page);

  await page.getByRole('button', { name: '判定类型' }).click();
  const overlay = page.locator('.loading-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveAttribute('role', 'status');
  await expect(page.locator('.panel-body')).toHaveAttribute('aria-busy', 'true');
  await expect(overlay.getByText('正在审查员工信息')).toBeVisible();
  await expect(page.locator('#workspace-return-home')).toBeEnabled();

  delayed.release();
  await expect(overlay).toHaveCount(0);
  await expect(page.locator('.panel-body')).toHaveAttribute('aria-busy', 'false');
});

test('类型判定期间显示匹配画像文案且返回上一步会取消加载', async ({ page }) => {
  const fixtures = defaultFixtures();
  const delayed = deferredFixture(fixtures.classify[0]);
  fixtures.classify[0] = delayed.handler;
  await mockCoachApi(page, fixtures);
  await page.goto('/');
  await fillHome(page);
  await page.getByRole('button', { name: '判定类型' }).click();
  await page.getByLabel('追问 1').fill('尚未做过。');
  await page.getByRole('button', { name: '再次审查' }).click();
  await page.getByRole('button', { name: '生成类型判定' }).click();

  await expect(page.getByText('正在匹配员工画像')).toBeVisible();
  await page.getByRole('button', { name: '返回上一步' }).click();
  await expect(page.locator('.panel-h')).toHaveText('员工信息输入');
  await expect(page.locator('.loading-overlay')).toHaveCount(0);

  delayed.release();
  await page.waitForTimeout(350);
  await expect(page.locator('.panel-h')).toHaveText('员工信息输入');
});
```

- [x] **Step 3: 运行测试并确认加载层缺失**

```powershell
npx.cmd playwright test tests/frontend.spec.js -g "内容面板加载层|匹配画像文案"
```

预期：FAIL；找不到 `.loading-overlay` 或步骤 2 文案。

- [x] **Step 4: 添加统一请求包装器并接入审查与分类**

在 `frontend/app.js` 导入：

```js
import { BUSY_ACTIONS, waitForMinimumLoading } from './loading.js';
```

在 `consume()` 前增加：

```js
async function requestWithLoading(action, request) {
  const startedAt = performance.now();
  setBusy(true, action);
  render();
  const result = await request();
  await waitForMinimumLoading(startedAt);
  return result;
}
```

步骤 1 替换为：

```js
const result = await requestWithLoading(
  BUSY_ACTIONS.INTAKE_REVIEW,
  () => intake(payload),
);
```

步骤 2 替换为：

```js
const result = await requestWithLoading(
  BUSY_ACTIONS.CLASSIFICATION_GENERATE,
  () => classify(payload),
);
```

删除这两处原有的 `setBusy(true); render();`，保留 `consume()`、错误处理、request epoch 和结果写入顺序。

- [x] **Step 5: 在视图层定义固定文案并应用加载状态**

在 `frontend/views.js` 增加：

```js
const LOADING_CONTENT = Object.freeze({
  'intake-review': {
    title: '正在审查员工信息',
    items: ['检查资料完整性', '提取能力与意愿证据', '整理需要补充的问题'],
  },
  'classification-generate': {
    title: '正在匹配员工画像',
    items: ['分析能力与意愿证据', '匹配最接近的员工画像', '整理判断依据'],
  },
  'plan-generate': {
    title: '正在生成教练方案',
    items: ['读取最终确认画像', '组织 GROW/SBI 建议', '生成沟通方案'],
  },
  'plan-regenerate': {
    title: '正在重新生成方案',
    items: ['保留最终确认画像', '避开上一版角度', '生成新的沟通方案'],
  },
  'feedback-generate': {
    title: '正在生成下一步建议',
    items: ['分析本次沟通反馈', '识别进展与风险', '整理下一步行动'],
  },
});

function createLoadingOverlay(action) {
  const content = LOADING_CONTENT[action];
  if (!content) return null;
  const overlay = node('div', { className: 'loading-overlay' });
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  overlay.append(
    node('div', { className: 'loading-spinner' }),
    node('div', { className: 'loading-title', text: content.title }),
    node('div', { className: 'loading-subtitle', text: '正在处理，请稍候…' }),
  );
  const list = node('ul', { className: 'loading-items' });
  for (const item of content.items) list.append(node('li', { text: item }));
  overlay.append(list);
  return overlay;
}

function applyLoadingPresentation(root, state) {
  const body = root.querySelector('.panel-body');
  if (!body) return;
  body.setAttribute('aria-busy', String(state.busy));
  if (!state.busy) return;
  const overlay = createLoadingOverlay(state.busyAction);
  if (!overlay) return;
  for (const child of body.children) child.inert = true;
  body.append(overlay);
}
```

将 `renderApp()` 改成先渲染目标页面，再统一应用加载状态：

```js
export function renderApp(root, state, handlers) {
  if (state.screen === 'home') renderHome(root, state, handlers);
  else if (state.screen === 'intake') renderIntake(root, state, handlers);
  else if (state.screen === 'classification') renderClassification(root, state, handlers);
  else if (state.screen === 'plan') renderPlan(root, state, handlers);
  else if (state.screen === 'feedback') renderFeedback(root, state, handlers);
  else renderBlocked(root, handlers);
  applyLoadingPresentation(root, state);
}
```

- [x] **Step 6: 添加加载层样式**

在 `frontend/styles.css` 增加：

```css
.panel-body {
  position: relative;
}

.loading-overlay {
  position: absolute;
  inset: 0;
  z-index: 8;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 280px;
  padding: 32px 24px;
  overflow: auto;
  background: rgba(255, 255, 255, .96);
  text-align: center;
}

.loading-spinner {
  width: 48px;
  height: 48px;
  margin-bottom: 14px;
  border: 5px solid var(--orange-tint);
  border-top-color: var(--purple);
  border-right-color: var(--orange);
  border-radius: 50%;
  animation: coach-loading-spin .85s linear infinite;
}

.loading-title {
  color: var(--ink);
  font-size: 15px;
  font-weight: 750;
}

.loading-subtitle {
  margin-top: 2px;
  color: var(--muted);
  font-size: 12px;
}

.loading-items {
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
  color: var(--muted);
  font-size: 12px;
  text-align: left;
}

.loading-items li::before {
  content: '';
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 8px;
  border-radius: 50%;
  background: var(--orange);
}

@keyframes coach-loading-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .loading-spinner { animation: none; }
}
```

在现有移动端媒体查询中确认加载层保持在面板宽度内，不设置固定宽度，不产生整页横向滚动。

- [x] **Step 7: 运行聚焦回归**

```powershell
node --check frontend\app.js
node --check frontend\views.js
npx.cmd playwright test tests/frontend.spec.js -g "内容面板加载层|匹配画像文案|返回上一步"
```

预期：全部 PASS。

- [x] **Step 8: 提交共享加载层**

```powershell
git add -- frontend/app.js frontend/views.js frontend/styles.css tests/frontend.spec.js
git commit -m "feat: add shared coaching loading overlay"
```

---

### Task 4: 接入方案、换角度和反馈，并验证失败与取消路径

**Files:**

- Modify: `frontend/app.js:202-247`
- Test: `tests/frontend.spec.js`

- [x] **Step 1: 先增加剩余动作的失败测试**

使用 `defaultFixtures()` 和 `deferredFixture()` 分别延迟对应响应，增加三个测试：

```js
test('首次方案生成期间显示教练方案加载文案', async ({ page }) => {
  const fixtures = defaultFixtures();
  const delayed = deferredFixture(fixtures.plan[0]);
  fixtures.plan[0] = delayed.handler;
  await advanceToClassification(page, fixtures);

  await page.getByRole('button', { name: '生成辅导方案' }).click();
  await expect(page.getByText('正在生成教练方案')).toBeVisible();
  delayed.release();
  await expect(page.locator('.panel-h')).toHaveText('教练方案生成');
  await expect(page.getByText('正在生成教练方案')).toHaveCount(0);
});

test('换个角度期间显示重新生成方案文案', async ({ page }) => {
  const fixtures = defaultFixtures();
  const delayed = deferredFixture(fixtures.plan[1]);
  fixtures.plan[1] = delayed.handler;
  await advanceToPlan(page, fixtures);
  await page.getByRole('button', { name: '换个角度' }).click();
  await expect(page.getByText('正在重新生成方案')).toBeVisible();
  delayed.release();
  await expect(page.getByText('正在重新生成方案')).toHaveCount(0);
});

test('反馈生成期间显示下一步建议文案并在接口失败后关闭', async ({ page }) => {
  const fixtures = defaultFixtures();
  const delayed = deferredFixture({ ok: false, blocked: false, message: '模型暂时不可用。' });
  fixtures.feedback[0] = delayed.handler;
  await advanceToPlan(page, fixtures);
  await page.getByRole('button', { name: '去反馈' }).click();
  await page.getByLabel('本次沟通后的情况').fill('员工愿意承担任务，但仍需要提醒。');
  await page.getByRole('button', { name: '生成下一步建议' }).click();
  await expect(page.getByText('正在生成下一步建议')).toBeVisible();
  delayed.release();
  await expect(page.locator('.loading-overlay')).toHaveCount(0);
  await expect(page.getByText('模型暂时不可用。')).toBeVisible();
});
```

- [x] **Step 2: 运行测试并确认精确文案缺失**

```powershell
npx.cmd playwright test tests/frontend.spec.js -g "生成教练方案|重新生成方案文案|下一步建议文案"
```

预期：FAIL；方案或反馈仍使用没有动作名称的旧 `setBusy(true)` 路径。

- [x] **Step 3: 接入方案动作**

在 `requestPlan(regenerate)` 中替换请求启动部分：

```js
const result = await requestWithLoading(
  regenerate ? BUSY_ACTIONS.PLAN_REGENERATE : BUSY_ACTIONS.PLAN_GENERATE,
  () => generatePlan({
    ...planInput,
    regenerate,
    previousPlan: regenerate ? session.plan : null,
  }),
);
```

删除原有 `setBusy(true); render();` 和重复的 `generatePlan()` 调用。

- [x] **Step 4: 接入反馈动作**

在 `generateFeedback(feedbackText)` 中替换请求启动部分：

```js
const result = await requestWithLoading(
  BUSY_ACTIONS.FEEDBACK_GENERATE,
  () => submitFeedback({
    classification: finalClassification(),
    planSummary: planSummary(),
    feedbackText,
  }),
);
```

保留进入请求前的 `setFeedbackText(feedbackText)`，确保返回上一步仍能保留本轮反馈草稿。

- [x] **Step 5: 增加 300ms 最短显示与减少动态效果断言**

增加测试：

```js
test('快速响应时加载层仍避免闪烁且减少动态效果会停止旋转', async ({ page }) => {
  await mockCoachApi(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await fillHome(page);
  const startedAt = Date.now();
  await page.getByRole('button', { name: '判定类型' }).click();
  await expect(page.getByText('请补充：是否已做过针对性辅导？')).toBeVisible();
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(250);

  const animation = await page.evaluate(() => {
    const spinner = document.createElement('div');
    spinner.className = 'loading-spinner';
    document.body.append(spinner);
    const value = getComputedStyle(spinner).animationName;
    spinner.remove();
    return value;
  });
  expect(animation).toBe('none');
});
```

使用 250ms 作为测试下限，为调度误差保留余量；产品常量仍是 300ms。

- [x] **Step 6: 运行全部加载相关测试**

```powershell
npx.cmd playwright test tests/frontend.spec.js -g "加载|正在审查|正在匹配|正在生成|重新生成|减少动态"
```

预期：全部 PASS，无真实 API 请求。

- [x] **Step 7: 提交剩余动作接入**

```powershell
git add -- frontend/app.js tests/frontend.spec.js
git commit -m "feat: cover all coaching actions with loading feedback"
```

---

### Task 5: 全量回归、人工验收与计划收尾

**Files:**

- Modify: `docs/agent-plans/2026-07-21-coach-assistant-loading-overlay-and-intake-preservation-plan.md`

- [x] **Step 1: 运行前端全量测试**

```powershell
npx.cmd playwright test tests/frontend.spec.js
```

预期：全部 PASS。

- [x] **Step 2: 运行项目全量测试**

```powershell
npm.cmd test
```

预期：服务端与前端全部 PASS；测试只使用 fixture/fake API。

- [x] **Step 3: 运行静态与差异检查**

```powershell
node --check frontend\loading.js
node --check frontend\state.js
node --check frontend\app.js
node --check frontend\views.js
git diff --check
git status --short
```

预期：语法和 whitespace 检查通过；状态中不包含 `.env`、测试报告、缓存或无关用户文件的暂存记录。

- [x] **Step 4: 完成人工验收**

逐项确认：

1. 先填写员工基础信息与目标困扰，再用鼠标和键盘选择关键词，所有内容保持不变。
2. 首次审查和再次审查显示“正在审查员工信息”。
3. 类型判定显示“正在匹配员工画像”。
4. 首次方案显示“正在生成教练方案”。
5. 换个角度显示“正在重新生成方案”。
6. 反馈建议显示“正在生成下一步建议”。
7. 加载层只覆盖右侧内容主体，左侧步骤栏、返回首页和上一步保持可用。
8. 返回上一步或首页后加载层消失，迟到响应不能恢复旧页面。
9. 接口错误后加载层消失，原有错误信息可见并可重试。
10. 390px、768px 和 1920px 宽度均无整页横向溢出。
11. `prefers-reduced-motion` 下圆环不旋转。
12. 刷新和返回首页仍清空当前会话；不存在浏览器持久化。

- [x] **Step 5: 验证后更新本计划复选框**

只勾选已有命令和人工检查实际通过的步骤，不得提前标记。

- [x] **Step 6: 提交计划执行记录**

```powershell
git add -- docs/agent-plans/2026-07-21-coach-assistant-loading-overlay-and-intake-preservation-plan.md
git commit -m "docs: record loading overlay implementation"
```

不得暂存整个 `docs/agent-plans/` 目录。

## 4. 完成标准

- 关键词点击不再重绘整个表单，未提交输入和焦点不被重置。
- 六类异步入口全部显示准确加载文案和旋转圆环。
- 加载层符合可访问性、取消、错误和最短显示要求。
- 不产生虚假进度，不修改后端和 API 契约。
- 新增回归测试先失败后通过。
- `npx.cmd playwright test tests/frontend.spec.js`、`npm.cmd test` 和 `git diff --check` 全部通过。
- 只提交本计划列出的文件，保留所有无关用户改动。

---

## 5. Executor 执行 Prompt

```text
你是 executor，请在项目 D:\codex-pj\teacher 中执行以下实施计划：

D:\codex-pj\teacher\docs\agent-plans\2026-07-21-coach-assistant-loading-overlay-and-intake-preservation-plan.md

开始前：

1. 使用 executing-plans skill。
2. 阅读项目中的 AGENTS.md（如存在）、README.md、package.json 和上述计划全文。
3. 执行：
   git status --short
   git diff
   git log --oneline -15
4. 当前工作区存在用户已有的未跟踪 docs/ 和 output/ 文件。不得删除、覆盖、回滚、暂存或提交无关文件；禁止使用 git add .。
5. 不读取、显示、复制或提交 .env 中的真实 Key。

严格按照计划 Task 1 → Task 2 → Task 3 → Task 4 → Task 5 的顺序实施，不要并行修改共享文件。

必须完成：

1. 关键词选择改为局部更新，不得重置员工基础信息、目标困扰或补充文本。
2. 首次审查、再次审查、类型判定、首次方案、换个角度和反馈建议全部显示覆盖右侧内容主体的统一加载层。
3. 加载层使用计划规定的 busyAction、固定文案、300ms 最短显示、aria-busy、role=status 和 reduced-motion 行为。
4. 加载期间保留返回首页与上一步；返回时取消请求并阻止迟到响应恢复旧页面。

实施约束：

- 严格使用 TDD：先写失败测试，确认失败原因正确，再做最小实现并确认通过。
- 只修改计划列出的 frontend、tests 和该计划文档。
- 不修改 server/、prompts/、knowledge/、API 格式、DeepSeek 配置、Markdown 安全渲染器或依赖。
- 不新增数据库、localStorage、sessionStorage 或跨会话记忆。
- 自动化测试必须使用现有 fixture/fake API，不得调用真实 DeepSeek API。
- 不做无关重构，不绕过或禁用 Git hooks。
- PowerShell 命令不得使用 Bash 风格的 &&。

每个 Task 完成后：

1. 运行计划规定的聚焦测试。
2. 检查 git status 和本 Task 差异。
3. 只暂存本 Task 明确列出的文件。
4. 使用计划规定的英文 commit message 提交。
5. 测试通过后再勾选对应复选框。

全部完成后运行：

npx.cmd playwright test tests/frontend.spec.js
npm.cmd test
git diff --check
git status --short

最终回复说明：

- 两项要求分别如何实现；
- 实际修改的关键文件；
- TDD 的失败与通过证据；
- 测试数量和结果；
- 人工验收结果；
- 是否存在未完成项或风险；
- 保留且未提交的用户原有文件；
- 生成的 commit hash。

不要部署、不要安装新依赖、不要自行 push。
```
