# Coach Assistant Stage Layout and Feedback Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not parallelize these tasks because both tasks modify `frontend/views.js` and `tests/frontend.spec.js`.

**Goal:** 让 GROW 与 SBI 的每个阶段在页面中分别独立换行展示，并在生成下一步建议后保留用户提交的反馈文本。

**Architecture:** 不改变 DeepSeek 模型契约、服务端校验或安全 Markdown 渲染边界。在前端展示层对指定的 GROW/SBI 内容做确定性的 Markdown 换行规范化，继续交由现有 `renderMarkdown` 安全渲染；在内存会话状态中新增 `feedbackText`，由提交反馈流程在重新渲染前写入，并由现有 `resetSession()` 在返回首页时清空。

**Tech Stack:** Vanilla JavaScript、现有内存状态模块、markdown-it 安全渲染器、Playwright、Node.js test runner。

---

## 范围与验收标准

只实施以下两项，不扩大范围：

1. GROW 的 `Goal（目标）`、`Reality（现状）`、`Options（可选方案）`、`Will（行动承诺）` 分别显示在独立段落；SBI 的 `Situation（情境）`、`Behavior（行为）`、`Impact（影响）` 也分别显示在独立段落。
2. 用户在步骤 4 输入反馈并成功生成下一步建议后，反馈输入框仍显示原始提交文本；点击“返回首页”后仍由现有会话重置流程清空，刷新页面后也不保留。

同时必须满足：

- 不修改 `prompts/system.md`、服务端模型契约或 DeepSeek 请求逻辑。
- 不使用 `innerHTML` 直接渲染模型文本；继续通过现有 `window.renderMarkdown`。
- 不放宽 Markdown sanitizer（净化器）规则。
- 不增加 `localStorage`、`sessionStorage`、数据库或跨会话记忆。
- 自动化测试使用现有 fixture（测试夹具）和假接口，不调用真实 DeepSeek API，不产生费用。
- 不读取、显示、复制或提交 `.env` 中的真实密钥。
- 保留当前工作区已有的 `.env.example`、`README.md`、`package-lock.json`、`tests/start-script.test.js`、`start.bat` 和其他 `docs/` 改动；不得覆盖、回滚或纳入本任务提交。

## 开始前检查

- [x] 阅读 `AGENTS.md`（若存在）、`README.md`、`package.json`。
- [x] 阅读本计划并确认只处理上述两项。
- [x] 运行以下只读检查：

```powershell
git status --short
git diff
git log --oneline -15
```

- [x] 确认 `frontend/app.js`、`frontend/state.js`、`frontend/views.js`、`tests/frontend.spec.js` 没有需要保留的重叠改动；若执行时已有重叠改动，先理解并合并，禁止覆盖。

---

## Task 1：GROW/SBI 各阶段独立换行

**Files:**

- Modify: `tests/frontend.spec.js`
- Modify: `frontend/views.js`

### Step 1：先写失败的页面结构测试

- [x] 在 `tests/frontend.spec.js` 的通用 helper 区域新增一个断言函数，确保指定标签分别位于不同的 `<p>` 元素：

```js
async function expectStageLabelsInSeparateParagraphs(container, labels) {
  const paragraphs = await container.locator('p').allTextContents();

  for (const label of labels) {
    const matchingParagraphs = paragraphs.filter((text) => text.includes(label));
    expect(matchingParagraphs, `${label} 应单独占一个段落`).toHaveLength(1);

    const labelsInParagraph = labels.filter((candidate) =>
      matchingParagraphs[0].includes(candidate),
    );
    expect(labelsInParagraph, `${label} 所在段落不应包含其他阶段`).toEqual([label]);
  }
}
```

- [x] 新增 Playwright 测试，继续使用现有内联阶段 fixture，覆盖方案页的 GROW、方案页的 SBI，以及反馈页 `next_steps` 中的 SBI：

```js
test('GROW 和 SBI 的每个阶段分别显示为独立段落', async ({ page }) => {
  await advanceToPlan(page);

  await expectStageLabelsInSeparateParagraphs(page.locator('#plan-scripts'), [
    'Goal（目标）',
    'Reality（现状）',
    'Options（可选方案）',
    'Will（行动承诺）',
  ]);

  await expectStageLabelsInSeparateParagraphs(page.locator('#plan-gap-fix'), [
    'Situation（情境）',
    'Behavior（行为）',
    'Impact（影响）',
  ]);

  await page.getByRole('button', { name: '去反馈' }).click();
  await page.getByLabel('本次沟通后的情况').fill(
    '员工本周主动同步了项目风险，并按约定提交了里程碑。',
  );
  await page.getByRole('button', { name: '生成下一步建议' }).click();

  await expectStageLabelsInSeparateParagraphs(page.locator('#feedback-next-steps'), [
    'Situation（情境）',
    'Behavior（行为）',
    'Impact（影响）',
  ]);
});
```

说明：若当前反馈建议容器的实际 `id` 与 `feedback-next-steps` 不同，应使用 `frontend/views.js` 中的真实 `id`，不要为了迁就测试新增重复容器。

### Step 2：确认测试因当前内联显示而失败

- [x] 运行聚焦测试：

```powershell
npx.cmd playwright test tests/frontend.spec.js --grep "GROW 和 SBI 的每个阶段分别显示为独立段落"
```

**Expected:** 测试失败；至少一个 `<p>` 同时包含多个 GROW 或 SBI 标签。若测试在实现前通过，先检查 fixture 是否仍是内联内容以及断言是否真正验证了独立段落。

### Step 3：实现展示层 Markdown 阶段分隔

- [x] 在 `frontend/views.js` 的 Markdown card helper 附近加入标签常量和纯文本格式化函数：

```js
const COACHING_STAGE_LABELS = Object.freeze([
  'Goal（目标）',
  'Reality（现状）',
  'Options（可选方案）',
  'Will（行动承诺）',
  'Situation（情境）',
  'Behavior（行为）',
  'Impact（影响）',
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeMarkdownSource(source) {
  return Array.isArray(source) ? source.join('\n') : String(source || '');
}

function formatCoachingStageMarkdown(source) {
  let markdown = normalizeMarkdownSource(source);

  for (const label of COACHING_STAGE_LABELS) {
    const escapedLabel = escapeRegExp(label);
    const separatorPattern = new RegExp(
      `[\\t ]*(?:\\r?\\n[\\t ]*)*(?=(?:\\*\\*)?${escapedLabel}(?:\\*\\*)?\\s*[：:](?:\\*\\*)?)`,
      'g',
    );

    markdown = markdown.replace(separatorPattern, (separator, offset) =>
      offset === 0 ? '' : '\n\n',
    );
  }

  return markdown;
}
```

实现说明：

- 格式化函数只插入 Markdown 空行，不生成 HTML。
- 同时兼容普通标签和 `**加粗标签**`。
- 已经换行的模型内容会被规范为两个换行，内联标签也会被拆开。
- 不删除模型原文，不改变阶段内容或阶段顺序。

- [x] 扩展现有 `markdownCard`，只为明确指定的卡片启用阶段分隔：

```js
function markdownCard(parent, id, title, source, options = {}) {
  const card = node('section', { className: 'content-card' });
  card.append(node('h3', {}, title));

  const content = node('div', { id });
  const markdown = options.separateCoachingStages
    ? formatCoachingStageMarkdown(source)
    : normalizeMarkdownSource(source);

  window.renderMarkdown(content, markdown);
  card.append(content);
  parent.append(card);
}
```

若当前 `markdownCard` 的元素结构略有不同，只增加 `options` 和输入格式化分支，保留原有 DOM 结构和 CSS class。

- [x] 仅在以下模型内容上设置 `{ separateCoachingStages: true }`：

```js
markdownCard(body, 'plan-gap-fix', '绩效差距修正方法', state.plan.gap_fix, {
  separateCoachingStages: true,
});

markdownCard(body, 'plan-scripts', '话术示例', state.plan.scripts, {
  separateCoachingStages: true,
});

markdownCard(body, 'feedback-next-steps', '下一步建议', state.feedback.next_steps, {
  separateCoachingStages: true,
});
```

使用现有实际标题和参数顺序；不要改变其他普通 Markdown 卡片。

### Step 4：运行聚焦回归

- [x] 重新运行：

```powershell
npx.cmd playwright test tests/frontend.spec.js --grep "GROW 和 SBI 的每个阶段分别显示为独立段落"
```

**Expected:** 1 个测试通过，Goal、Reality、Options、Will 以及 Situation、Behavior、Impact 分别位于独立段落。

- [x] 运行现有 GROW/SBI 与 Markdown 安全测试：

```powershell
npx.cmd playwright test tests/frontend.spec.js --grep "GROW|SBI|Markdown"
```

**Expected:** 全部通过；恶意 HTML/URL 仍由现有安全渲染边界拦截。

### Step 5：提交 Task 1（仅在用户要求提交时）

- [x] 检查并只暂存本任务文件：

```powershell
git diff -- frontend/views.js tests/frontend.spec.js
git add -- frontend/views.js tests/frontend.spec.js
git diff --cached --check
git diff --cached
git commit -m "feat: separate grow and sbi stage rendering"
```

禁止使用 `git add .`。

---

## Task 2：生成反馈后保留用户填写内容

**Files:**

- Modify: `tests/frontend.spec.js`
- Modify: `frontend/state.js`
- Modify: `frontend/app.js`
- Modify: `frontend/views.js`

### Step 1：先写失败的反馈保留测试

- [x] 在 `tests/frontend.spec.js` 新增测试：

```js
test('生成下一步建议后保留用户提交的反馈文本', async ({ page }) => {
  const feedbackText = '员工本周主动同步了项目风险，并按约定提交了里程碑。';

  await advanceToPlan(page);
  await page.getByRole('button', { name: '去反馈' }).click();

  const feedbackInput = page.getByLabel('本次沟通后的情况');
  await feedbackInput.fill(feedbackText);
  await page.getByRole('button', { name: '生成下一步建议' }).click();

  await expect(page.locator('#feedback-next-steps')).toContainText('Situation（情境）');
  await expect(feedbackInput).toHaveValue(feedbackText);
});
```

如果 Task 1 已经有完全相同的反馈提交步骤，可在不降低可读性和失败定位能力的前提下复用 helper；仍要保留一个标题明确的独立回归测试。

### Step 2：确认测试因重新渲染清空输入而失败

- [x] 运行：

```powershell
npx.cmd playwright test tests/frontend.spec.js --grep "生成下一步建议后保留用户提交的反馈文本"
```

**Expected:** 测试失败，输入框实际值为空字符串；这证明测试覆盖了当前缺陷。

### Step 3：把反馈文本纳入当前内存会话状态

- [x] 在 `frontend/state.js` 中：

1. 将 `feedbackText` 加入 `SESSION_KEYS`。
2. 在 `createInitialState()` 返回值中加入 `feedbackText: ''`。
3. 新增 setter：

```js
export function setFeedbackText(feedbackText) {
  updateSession({ feedbackText: String(feedbackText || '') });
}
```

不要写入浏览器存储。`resetSession()` 使用 `createInitialState()`，因此返回首页会自然清空该字段。

### Step 4：在重新渲染前保存并回填反馈文本

- [x] 在 `frontend/app.js` 从 `./state.js` 导入 `setFeedbackText`，并在 `generateFeedback(feedbackText)` 开始处、任何 `render()` 之前写入：

```js
async function generateFeedback(feedbackText) {
  setFeedbackText(feedbackText);
  setError(null);
  setBusy(true);
  render();

  // 保留现有请求、consume、setFeedback、setScreen 和 render 流程。
}
```

- [x] 在 `frontend/views.js` 的 `renderFeedback` 中，将反馈输入框默认值从空字符串改为当前内存状态：

```js
body.append(
  textAreaField(
    'feedback-text',
    '本次沟通后的情况',
    state.feedbackText || '',
    '例：他愿意主动接一个模块，但仍担心做不好。',
  ),
);
```

沿用当前函数真实参数顺序和 placeholder 原文；核心要求是第三个“值”参数使用 `state.feedbackText || ''`。

### Step 5：运行聚焦测试和会话清理回归

- [x] 运行：

```powershell
npx.cmd playwright test tests/frontend.spec.js --grep "生成下一步建议后保留用户提交的反馈文本"
```

**Expected:** 测试通过，反馈结果出现后 textarea 仍保留原始值。

- [x] 运行返回首页、刷新、反馈相关测试：

```powershell
npx.cmd playwright test tests/frontend.spec.js --grep "返回首页|刷新|反馈"
```

**Expected:** 全部通过；返回首页和刷新仍不保留上一轮员工信息或反馈文本。

### Step 6：提交 Task 2（仅在用户要求提交时）

- [x] 检查并只暂存本任务文件：

```powershell
git diff -- frontend/state.js frontend/app.js frontend/views.js tests/frontend.spec.js
git add -- frontend/state.js frontend/app.js frontend/views.js tests/frontend.spec.js
git diff --cached --check
git diff --cached
git commit -m "feat: retain submitted coaching feedback"
```

若 Task 1 与 Task 2 由同一执行对话连续完成且用户只需要一个提交，可在全部验证通过后使用一个英文提交；仍不得暂存无关文件。

---

## Task 3：全量回归与人工验收

### Step 1：自动化回归

- [x] 运行完整前端端到端测试：

```powershell
npx.cmd playwright test tests/frontend.spec.js
```

- [x] 运行项目全量测试：

```powershell
npm.cmd test
```

- [x] 检查差异格式与工作区：

```powershell
git diff --check
git status --short
git diff -- frontend/state.js frontend/app.js frontend/views.js tests/frontend.spec.js
```

**Expected:** 所有测试通过，`git diff --check` 无输出；无 `.env`、API Key、测试报告、缓存或其他用户改动进入本任务提交。

### Step 2：真实 Key 人工验收（由用户执行）

自动化测试不得调用真实 API。用户可使用本机已有 `.env` 手动验证：

- [ ] 生成一份包含完整 GROW 的方案，确认 Goal、Reality、Options、Will 分别独立换行，顺序不变且内容不丢失。
- [ ] 对 B 或 D2 场景生成包含完整 SBI 的方案，确认 Situation、Behavior、Impact 分别独立换行。
- [ ] 在步骤 4 填入真实反馈并生成下一步建议，确认 SBI 三阶段分别独立换行。
- [ ] 确认生成结果后，反馈输入框仍显示刚才提交的完整文本。
- [ ] 点击“返回首页”，重新进入步骤 4 时不出现上一轮反馈；刷新页面也不出现上一轮内容。
- [ ] 确认 Markdown 内容正常、安全，页面没有脚本执行、危险链接或原始 HTML 注入。

### Step 3：完成计划

- [x] 将实际完成的复选框改为 `[x]`，未完成项保持 `[ ]` 并说明原因。
- [x] 最终回复列出：完成内容、关键文件、测试命令与数量/结果、人工验收状态、未完成项、保留但未提交的用户改动。
- [x] 不自行 push，除非用户明确要求。

## 最终文件范围

预期业务/测试改动仅限：

- `frontend/views.js`
- `frontend/state.js`
- `frontend/app.js`
- `tests/frontend.spec.js`
- `docs/agent-plans/2026-07-20-coach-assistant-stage-layout-and-feedback-retention-plan.md`（仅更新任务复选框）

任何服务端、prompt、依赖、配置、启动脚本或其他文档改动都不属于本计划。
