# Coach Assistant Back Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在辅导流程第 2、3、4 步增加“返回上一步”按钮，返回查看时保留当前会话数据，前序输入实际变化后只清除依赖它的后续结果。

**Architecture:** 视图层在三个工作区页脚渲染统一按钮，应用层使用单一 `goPrevious()` 完成相邻步骤导航，状态层使用内存中的稳定提交快照判断输入是否变化并按依赖关系失效下游数据。现有 `AbortController` 与 request epoch 继续负责取消请求和阻止迟到响应，不新增后端接口或浏览器持久化。

**Tech Stack:** Vanilla JavaScript ES modules、现有内存会话状态、Playwright 1.60.0、Node.js 20+。

---

## 实施边界与文件地图

| 文件 | 职责 |
|---|---|
| `frontend/views.js` | 在分类、方案、反馈页渲染返回按钮；已有结果存在时提供无 API 的继续入口。 |
| `frontend/app.js` | 相邻步骤导航、提交快照判断、API 调用编排和成功后的下游失效。 |
| `frontend/state.js` | 稳定提交键、提交快照和按阶段清理后续状态。 |
| `frontend/index.html` | 页脚返回按钮左右布局及窄屏样式。 |
| `tests/frontend.spec.js` | 导航、数据保留、变化失效、请求取消和窄屏回归。 |

明确不修改：`server/`、`prompts/`、`knowledge/`、API 请求格式、DeepSeek 配置、数据库或跨会话规则。

## Task 1：实现第 2、3、4 步的相邻返回导航

**Files:**

- Modify: `tests/frontend.spec.js`
- Modify: `frontend/app.js`
- Modify: `frontend/views.js`
- Modify: `frontend/index.html`

- [ ] **Step 1: 先写三步返回与数据保留的浏览器测试**

先让已有流程辅助函数返回它安装的请求记录；现有调用方忽略返回值时行为保持不变。

将 `advanceToClassification()` 的第一条语句：

```js
await mockCoachApi(page, fixtures);
```

替换为：

```js
const requests = await mockCoachApi(page, fixtures);
```

并在该函数最后一条 `expect` 后加入：

```js
return requests;
```

将 `advanceToPlan()` 的第一条语句：

```js
await advanceToClassification(page, fixtures);
```

替换为：

```js
const requests = await advanceToClassification(page, fixtures);
```

并在该函数最后一条 `expect` 后加入：

```js
return requests;
```

然后在 `tests/frontend.spec.js` 的顶部返回首页测试之后加入：

```js
test('第 2、3、4 步可以逐步返回且返回操作不重复调用 API', async ({ page }) => {
  const fixtures = defaultFixtures();
  const requests = await advanceToPlan(page, fixtures);
  const requestCountBeforeReturn = requests.length;

  await page.getByRole('button', { name: '返回上一步' }).click();
  await expect(page.locator('.panel-h')).toHaveText('类型判定');
  await expect(page.locator('#type-card-B')).toContainText('成熟待激活型');

  await page.getByRole('button', { name: '返回上一步' }).click();
  await expect(page.getByRole('heading', { name: '因材施教，给每个人对的辅导方式' })).toBeVisible();
  await expect(page.getByLabel('绩效目标 / 上层期望')).toHaveValue('独立承接三个项目');
  await expect(page.getByLabel('近期辅导困扰')).toHaveValue('交代的事不追就停');
  await expect(page.getByRole('button', { name: '返回上一步' })).toHaveCount(0);
  expect(requests).toHaveLength(requestCountBeforeReturn);
});

test('第 4 步返回方案后会保留尚未提交的反馈草稿', async ({ page }) => {
  await advanceToPlan(page);
  await page.getByRole('button', { name: '去反馈' }).click();
  await page.getByLabel('本次沟通后的情况').fill('已提交的反馈草稿');
  await page.getByRole('button', { name: '返回上一步' }).click();
  await expect(page.locator('.panel-h')).toHaveText('教练方案生成');
  await page.getByRole('button', { name: '去反馈' }).click();
  await expect(page.getByLabel('本次沟通后的情况')).toHaveValue('已提交的反馈草稿');
});
```

这里的两次 `intake` 是首次审查与追问后的再次审查；返回查看不得增加调用次数。

- [ ] **Step 2: 运行聚焦测试并确认失败**

Run:

```powershell
npx.cmd playwright test tests/frontend.spec.js --grep "逐步返回|保留尚未提交"
```

Expected: FAIL，页面尚不存在“返回上一步”按钮。

- [ ] **Step 3: 在应用层增加统一的相邻导航处理器**

在 `frontend/app.js` 的 `returnHome()` 之后加入：

```js
const PREVIOUS_SCREEN = Object.freeze({
  classification: ['home', 1],
  plan: ['classification', 2],
  feedback: ['plan', 3],
});

function goPrevious() {
  const target = PREVIOUS_SCREEN[session.screen];
  if (!target) return;
  setBusy(false);
  setError(null);
  setScreen(target[0], target[1]);
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
```

在 `handlers` 中加入：

```js
goPrevious,
```

本任务只完成相邻导航；请求取消和 epoch 失效在 Task 3 接入并验证。

- [ ] **Step 4: 在三个页脚加入返回按钮和已有结果继续入口**

在 `frontend/views.js` 的 `button()` 后加入：

```js
function appendPreviousButton(footer, handlers) {
  footer.append(button('go-previous', '返回上一步', handlers.goPrevious, { secondary: true }));
}
```

在 `renderClassification()` 的两个页脚创建后都先调用：

```js
appendPreviousButton(footer, handlers);
```

将“已判定”分支改成：

```js
if (classification.status === '已判定') {
  const label = state.plan ? '继续查看方案' : (state.busy ? '正在生成…' : '生成辅导方案');
  footer.append(button('generate-plan', label, handlers.generatePlan, {
    accent: true,
    disabled: state.busy,
  }));
}
```

在 `renderPlan()` 和 `renderFeedback()` 的页脚创建后、其他按钮之前调用同一个 `appendPreviousButton()`。

在 `renderHome()` 中将提交按钮文本改成：

```js
const submitLabel = state.intakeResult && state.intakeResult.sufficient
  ? '继续类型判定'
  : state.busy ? '正在审查…' : '审查信息';
const submit = button('review-intake', submitLabel, () => {
```

- [ ] **Step 5: 固定页脚按钮布局**

在 `frontend/index.html` 的 `.panel-foot` 样式后加入：

```css
#go-previous{margin-right:auto}
```

保留现有 `flex-wrap:wrap`，不要给返回按钮设置固定宽度；320px 和 375px 下由 flex 自动换行。

- [ ] **Step 6: 运行聚焦测试**

Run:

```powershell
npx.cmd playwright test tests/frontend.spec.js --grep "逐步返回|保留尚未提交"
```

Expected: PASS；第 2、3、4 步逐级返回，表单和反馈草稿保留，返回动作本身不增加 API 调用。

- [ ] **Step 7: 提交基础导航改动**

```powershell
git status --short
git diff -- frontend/app.js frontend/views.js frontend/index.html tests/frontend.spec.js
git add frontend/app.js frontend/views.js frontend/index.html tests/frontend.spec.js
git commit -m "feat: add previous-step navigation"
```

提交前确认未加入 `.env`、其他计划文档或用户已有的未跟踪文件。

## Task 2：实现提交快照与下游结果失效

**Files:**

- Modify: `tests/frontend.spec.js`
- Modify: `frontend/state.js`
- Modify: `frontend/app.js`

- [ ] **Step 1: 写“未变化复用”和“变化后清理”的失败测试**

在 `tests/frontend.spec.js` 加入：

```js
test('返回后未修改员工信息会复用已有结果，修改后会重新审查并清除旧下游结果', async ({ page }) => {
  const fixtures = defaultFixtures();
  fixtures.intake = [...fixtures.intake, ...fixtures.intake];
  fixtures.classify = [...fixtures.classify, ...fixtures.classify];
  fixtures.plan = [coachingPlan(), coachingPlan()];
  const requests = await advanceToPlan(page, fixtures);

  await page.getByRole('button', { name: '返回上一步' }).click();
  await page.getByRole('button', { name: '返回上一步' }).click();
  await page.getByRole('button', { name: '继续类型判定' }).click();
  expect(requests.filter((item) => item.method === 'intake')).toHaveLength(2);
  await expect(page.locator('#type-card-B')).toBeVisible();

  await page.getByRole('button', { name: '返回上一步' }).click();
  await page.getByLabel('近期辅导困扰').fill('修改后的辅导困扰');
  await page.getByRole('button', { name: '继续类型判定' }).click();

  await expect.poll(() => requests.filter((item) => item.method === 'intake').length).toBe(3);
  await expect(page.locator('#type-card-B')).toHaveCount(0);
  await expect(page.locator('#coach-plan')).toHaveCount(0);
  await expect(page.locator('#feedback-next-steps')).toHaveCount(0);
});

test('方案重新生成成功后会清空旧反馈输入和结果', async ({ page }) => {
  const fixtures = defaultFixtures();
  fixtures.plan = [coachingPlan(), nextPlan()];
  fixtures.feedback = [...fixtures.feedback, ...fixtures.feedback];
  await advanceToPlan(page, fixtures);
  await page.getByRole('button', { name: '去反馈' }).click();
  await page.getByLabel('本次沟通后的情况').fill('旧反馈内容');
  await page.getByRole('button', { name: '生成下一步建议' }).click();
  await expect(page.locator('#feedback-next-steps')).toBeVisible();

  await page.getByRole('button', { name: '返回上一步' }).click();
  await page.getByRole('button', { name: '换个角度' }).click();
  await page.getByRole('button', { name: '去反馈' }).click();

  await expect(page.getByLabel('本次沟通后的情况')).toHaveValue('');
  await expect(page.locator('#feedback-next-steps')).toHaveCount(0);
});
```

- [ ] **Step 2: 运行聚焦测试并确认失败**

Run:

```powershell
npx.cmd playwright test tests/frontend.spec.js --grep "复用已有结果|重新生成成功"
```

Expected: FAIL；当前首页总会再次调用 intake，且新方案成功后仍保留旧反馈。

- [ ] **Step 3: 在状态层增加稳定提交快照**

在 `frontend/state.js` 的 `SESSION_KEYS` 加入 `submissionKeys`，并在 `createInitialState()` 中加入：

```js
submissionKeys: { intake: null, classification: null, plan: null },
```

在 `resetSession()` 前加入：

```js
function normalizedForKey(value) {
  if (Array.isArray(value)) return value.map(normalizedForKey);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, normalizedForKey(value[key])]),
    );
  }
  return value;
}

function submissionKey(payload) {
  return JSON.stringify(normalizedForKey(payload));
}

export function matchesSubmission(stage, payload) {
  return session.submissionKeys[stage] === submissionKey(payload);
}

export function markSubmission(stage, payload) {
  updateSession({
    submissionKeys: { ...session.submissionKeys, [stage]: submissionKey(payload) },
  });
}

export function clearDownstream(stage) {
  if (stage === 'intake') {
    updateSession({
      intakeResult: null,
      classification: null,
      plan: null,
      feedback: null,
      feedbackText: '',
      blocked: null,
      submissionKeys: { ...session.submissionKeys, classification: null, plan: null },
    });
    return;
  }
  if (stage === 'classification') {
    updateSession({
      plan: null,
      feedback: null,
      feedbackText: '',
      submissionKeys: { ...session.submissionKeys, plan: null },
    });
    return;
  }
  if (stage === 'plan') {
    updateSession({ feedback: null, feedbackText: '' });
    return;
  }
  throw new TypeError(`Unsupported downstream stage: ${stage}`);
}
```

快照只记录标准化后的请求输入，不保存到浏览器存储，也不包含 API Key。

- [ ] **Step 4: 在 intake 与 classify 成功边界使用快照**

在 `frontend/app.js` 导入：

```js
clearDownstream,
markSubmission,
matchesSubmission,
```

`reviewIntake()` 改为直接从本次 `answers` 参数构建请求体后，删除已无调用方的 `answersPayload()`，不要保留死代码。

将 `reviewIntake()` 开头调整为（从首页继续时默认沿用当前会话的追问答案，避免把未修改的数据误判成新输入）：

```js
async function reviewIntake(values, answers = session.answers) {
  const payload = { intake: values, answers: Object.fromEntries(
    answers.map(({ question, answer }) => [question, answer]),
  ) };
  setIntake(values);
  setAnswers(answers);
  if (matchesSubmission('intake', payload) && session.intakeResult) {
    setError(null);
    setScreen(session.intakeResult.sufficient ? 'classification' : 'intake',
      session.intakeResult.sufficient ? 2 : 1);
    render();
    return;
  }
  clearDownstream('intake');
  setError(null);
  setBusy(true);
  render();
  const result = await intake(payload);
```

删除该函数中旧的重复 `setIntake()`、`setAnswers()` 和旧请求体。模型结果通过 `consume()` 且未进入高风险拦截后，在 `setIntakeResult(data)` 前加入：

```js
markSubmission('intake', payload);
```

在 `generateClassification()` 中构建：

```js
const payload = { normalizedProfile };
```

请求前若当前分类快照不匹配，则调用：

```js
clearDownstream('classification');
```

把请求改为 `classify(payload)`；成功后、`setClassification(data)` 前加入：

```js
markSubmission('classification', payload);
```

- [ ] **Step 5: 让已有方案前进不调用 API，并在新方案成功后清除反馈**

在 `requestPlan(regenerate)` 中用以下基础输入作为方案快照：

```js
const planInput = {
  classification: session.classification,
  normalizedProfile: session.intakeResult && session.intakeResult.normalized_profile,
  pain: session.intake.pain || '',
};
if (!regenerate && session.plan && matchesSubmission('plan', planInput)) {
  setError(null);
  setScreen('plan', 3);
  render();
  return;
}
```

模型请求继续使用：

```js
const result = await generatePlan({
  ...planInput,
  regenerate,
  previousPlan: regenerate ? session.plan : null,
});
```

只有在 `consume()` 返回新方案后执行：

```js
clearDownstream('plan');
setPlan(data);
markSubmission('plan', planInput);
```

失败或取消的重新生成不得清除原方案、反馈输入或反馈结果。

- [ ] **Step 6: 运行聚焦测试**

Run:

```powershell
npx.cmd playwright test tests/frontend.spec.js --grep "复用已有结果|重新生成成功|逐步返回"
```

Expected: PASS；无变化时不重复请求，变化后按依赖关系清除，新方案成功后反馈为空。

- [ ] **Step 7: 提交快照和失效逻辑**

```powershell
git status --short
git diff -- frontend/state.js frontend/app.js tests/frontend.spec.js
git add frontend/state.js frontend/app.js tests/frontend.spec.js
git commit -m "feat: invalidate downstream coaching state"
```

## Task 3：取消返回前请求并完成窄屏与全量回归

**Files:**

- Modify: `tests/frontend.spec.js`
- Modify: `frontend/app.js`
- Modify: `frontend/index.html`（仅当聚焦窄屏测试失败时调整）

- [ ] **Step 1: 写迟到响应和窄屏按钮测试**

在 `tests/frontend.spec.js` 加入：

```js
test('生成反馈期间返回方案页后，迟到响应不会恢复反馈页', async ({ page }) => {
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      const withoutSignal = { ...init };
      delete withoutSignal.signal;
      return nativeFetch(input, withoutSignal);
    };
  });
  let releaseFeedback;
  const delayedFeedback = new Promise((resolve) => { releaseFeedback = resolve; });
  const fixtures = defaultFixtures();
  fixtures.feedback = [() => delayedFeedback];
  const requests = await advanceToPlan(page, fixtures);
  await page.getByRole('button', { name: '去反馈' }).click();
  await page.getByLabel('本次沟通后的情况').fill('等待生成的反馈');
  await page.getByRole('button', { name: '生成下一步建议' }).click();
  await expect.poll(() => requests.filter((item) => item.method === 'feedback').length).toBe(1);

  await page.getByRole('button', { name: '返回上一步' }).click();
  await expect(page.locator('.panel-h')).toHaveText('教练方案生成');
  releaseFeedback(defaultFixtures().feedback[0]);
  await page.waitForTimeout(150);

  await expect(page.locator('.panel-h')).toHaveText('教练方案生成');
  await expect(page.locator('#feedback-next-steps')).toHaveCount(0);
});

for (const width of [320, 375]) {
  test(`${width}px 下返回上一步按钮可见且页面无横向溢出`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await advanceToPlan(page);
    await expect(page.getByRole('button', { name: '返回上一步' })).toBeVisible();
    const viewport = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(viewport.scrollWidth).toBe(viewport.clientWidth);
  });
}
```

- [ ] **Step 2: 运行聚焦测试并确认迟到响应测试失败**

Run:

```powershell
npx.cmd playwright test tests/frontend.spec.js --grep "迟到响应不会恢复反馈页|返回上一步按钮可见"
```

Expected: 迟到响应测试 FAIL，因为 Task 1 的 `goPrevious()` 尚未取消请求和递增 epoch；窄屏测试可能已经通过。

- [ ] **Step 3: 在 `goPrevious()` 接入现有请求取消机制**

将 `frontend/app.js` 的 `goPrevious()` 改为：

```js
function goPrevious() {
  const target = PREVIOUS_SCREEN[session.screen];
  if (!target) return;
  cancelPendingRequests();
  setBusy(false);
  setError(null);
  setScreen(target[0], target[1]);
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
```

`cancelPendingRequests()` 已经调用 `invalidateRequestEpoch()`；不要在 `goPrevious()` 中再次直接修改 epoch。

- [ ] **Step 4: 仅在窄屏测试失败时调整页脚样式**

如果 320px 或 375px 出现横向溢出，在 `frontend/index.html` 的现有媒体查询中加入：

```css
@media(max-width:820px){
  #go-previous{margin-right:0}
  .panel-foot .btn{max-width:100%}
}
```

如果聚焦测试已通过，不添加这段 CSS，避免无必要改动。

- [ ] **Step 5: 运行全部返回导航测试**

Run:

```powershell
npx.cmd playwright test tests/frontend.spec.js --grep "返回上一步|逐步返回|保留尚未提交|复用已有结果|重新生成成功|迟到响应"
```

Expected: 所有相关测试 PASS。

- [ ] **Step 6: 运行完整自动化回归**

Run:

```powershell
npm.cmd test
```

Expected: Node 服务端测试、启动脚本测试和全部 Playwright 测试均为 0 failures；测试不调用真实 DeepSeek，不产生 API 费用。

- [ ] **Step 7: 检查差异并提交最终改动**

```powershell
git status --short
git diff --check
git diff -- frontend/app.js frontend/state.js frontend/views.js frontend/index.html tests/frontend.spec.js
git add frontend/app.js frontend/state.js frontend/views.js frontend/index.html tests/frontend.spec.js
git commit -m "test: cover previous-step navigation boundaries"
```

若 `frontend/index.html` 在 Task 3 没有变化，不要把它重复加入提交。不得提交 `.env`、测试产物或其他未跟踪文档。

## 完成标准

- [ ] 第 2、3、4 步均有“返回上一步”，第 1 步没有。
- [ ] 返回只移动到相邻前一步，不返回首页、不调用 API、不立即清除数据。
- [ ] 返回后不修改数据，可以无 API 地继续查看旧分类、旧方案和旧反馈。
- [ ] 员工信息或追问答案实际变化后，旧信息审查、分类、方案和反馈按依赖关系清除。
- [ ] 新分类输入实际变化后，旧方案和反馈清除。
- [ ] 新方案成功生成后，旧反馈输入和反馈结果清除；生成失败时保留旧内容。
- [ ] 返回操作取消当前请求，迟到成功或失败响应均无法覆盖当前页面。
- [ ] 320px 和 375px 下按钮可见且无横向溢出。
- [ ] 不新增后端接口、持久化存储、跨会话记忆或外部系统集成。
- [ ] `npm.cmd test` 完整通过，且未调用真实模型。
