# Coach Assistant Strict Plan Contract Repair and Corrective Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在继续严格要求完整双语 GROW/SBI 标签的前提下，提高步骤 3 首次方案与“换个角度”的有效响应率，并让现有的一次重试根据具体校验失败原因纠正输出。

**Architecture:** 保留 Ajv schema 与现有语义校验边界，新增一个只返回稳定错误码的方案诊断层，使 `validatePlan` 继续提供布尔接口，同时为 DeepSeek 客户端的一次重试提供最小、可控的纠错指令。提示词使用精确的双语标签模板约束模型；解析器只扩展自然标点边界，不接受中文简称；服务端继续在两次均无效时返回统一安全错误，不向前端暴露原始模型输出或诊断细节。

**Tech Stack:** Node.js CommonJS、Express、Ajv、DeepSeek Chat Completions API、Node.js built-in test runner

---

## 背景与已确认决策

一次获准的真实 API 诊断显示，步骤 2 已成功完成，步骤 3 返回 HTTP 200 且 JSON 可解析，但未通过现有语义契约。真实响应形态包括：

- 使用中文简称“情境/行为/影响”，没有使用完整的 `Situation（情境）/Behavior（行为）/Impact（影响）`；
- B 类型的 `gap_fix` 与两条 `scripts` 都未形成完整 SBI；
- `Will（行动承诺）` 出现在中文问号 `？` 后，当前标签边界表达式没有识别；
- 出现 `XX项目`、`X月X日` 等占位内容；
- 现有客户端第二次请求与第一次完全相同，没有把校验失败原因反馈给模型。

本计划采用已确认的“方案三：分层修复”，决策如下：

1. GROW/SBI 继续严格要求完整双语标签，不接受“目标/现状/情境/行为/影响”等中文简称。
2. 解析器仅放宽标签前的自然标点边界，新增 `！`、`？`、`!`、`?`，不改变标签本身。
3. 第一次方案无效时，把稳定诊断错误码转换为服务端生成的纠错指令，再使用现有的唯一一次重试。
4. 禁止 `XX项目`、`XX模块`、`X月X日`、`某员工`、`某任务`；允许明确表达事实不足的“需补充具体情境/行为/影响”。
5. 首次方案温度使用 `0.3`，“换个角度”使用 `0.45`。
6. 自动化测试只用 fake client / fake fetch，不调用真实 DeepSeek API。执行过程中若仍需真实测试，必须重新获得用户明确授权。

## 文件职责与修改范围

仅修改以下文件：

- `server/coaching-methods.js`：识别严格双语 GROW/SBI 标签及允许的标签边界标点。
- `server/contracts.js`：维护步骤 3 schema、语义诊断错误码、占位内容检查和最终布尔校验。
- `prompts/system.md`：为步骤 3 提供可直接模仿的严格 JSON、GROW、SBI 输出模板。
- `server/deepseek-client.js`：在第一次语义校验失败后，将服务层提供的纠错消息加入第二次请求。
- `server/coach-service.js`：把步骤 3 诊断器与纠错消息构造器接入客户端，并区分首次/重出温度。
- `tests/server.coaching-methods.test.js`：覆盖自然标点边界及严格标签拒绝规则。
- `tests/server.contracts.test.js`：覆盖诊断错误码、B/D2 双 SBI 与占位内容拦截。
- `tests/server.routes.test.js`：覆盖提示词、纠错重试、两次无效的安全失败和温度选择。
- `docs/agent-plans/2026-07-21-coach-assistant-plan-contract-repair-and-corrective-retry-plan.md`：执行后更新本计划复选框。

明确不修改：

- `frontend/`、步骤 1/2/4 的接口契约、知识库、模型名称、API 路径、依赖和部署配置；
- 现有两次总尝试次数；
- 前端安全错误文案；
- `.env` 及任何真实密钥。

---

### Task 1: 在不降低标签严格性的前提下接受自然标点边界

**Files:**
- Modify: `tests/server.coaching-methods.test.js`
- Modify: `server/coaching-methods.js:11-14`

- [x] **Step 1: 增加失败测试，覆盖中文问号/感叹号边界与中文简称拒绝**

在 `tests/server.coaching-methods.test.js` 现有 GROW/SBI 测试后增加：

```js
test('严格双语阶段标签可出现在自然问句或感叹句之后', () => {
  assert.equal(hasCompleteGrowScripts([
    'Goal（目标）：本周独立推进客户评审！Reality（现状）：当前需要主管提醒才同步风险。',
    'Options（可选方案）：你还可以想到哪些办法？Will（行动承诺）：周五前完成首次主动同步。',
  ]), true);

  assert.equal(hasCompleteSbi(
    'Situation（情境）：周一项目例会！Behavior（行为）：你在会前主动同步了风险？Impact（影响）：团队提前协调了资源。',
  ), true);
});

test('放宽标点边界后仍拒绝中文简称标签', () => {
  assert.equal(hasCompleteGrowScripts([
    '目标：本周独立推进客户评审。现状：当前仍需主管提醒。',
    '可选方案：每日同步。行动承诺：周五执行。',
  ]), false);

  assert.equal(hasCompleteSbi(
    '情境：周一项目例会。行为：会前未同步风险。影响：团队临时调整资源。',
  ), false);
});
```

- [x] **Step 2: 运行聚焦测试并确认失败原因正确**

Run:

```powershell
node --test tests/server.coaching-methods.test.js
```

Expected: 第一条新测试失败，因为当前 `LABEL_PATTERN` 不把 `！`、`？`、`!`、`?` 视为下一标签的合法边界；原有测试继续通过。

- [x] **Step 3: 最小修改标签边界表达式**

将 `server/coaching-methods.js` 中的 `LABEL_PATTERN` 改为：

```js
const LABEL_PATTERN = new RegExp(
  `(?:^|[\\r\\n；;。！？!?])\\s*(?:[-+>]\\s*)?(?:[*_\`#]+\\s*)?(${Object.values(STAGE_LABELS).join('|')})(?:\\s*[*_\`#]+)?\\s*[：:]`,
  'g',
);
```

只修改边界字符集合；`STAGE_LABELS`、顺序检查和非空内容检查保持不变。

- [x] **Step 4: 运行聚焦测试并确认通过**

Run:

```powershell
node --test tests/server.coaching-methods.test.js
```

Expected: 全部通过，中文简称测试仍返回 `false`。

- [x] **Step 5: 检查差异并提交 Task 1**

```powershell
git diff -- server/coaching-methods.js tests/server.coaching-methods.test.js
git status --short
git add server/coaching-methods.js tests/server.coaching-methods.test.js
git commit -m "fix: accept natural plan label boundaries"
```

不得使用 `git add .`，不得暂存现有无关未跟踪文件。

---

### Task 2: 为严格方案契约增加稳定诊断错误码和占位内容拦截

**Files:**
- Modify: `tests/server.contracts.test.js`
- Modify: `server/contracts.js:298-329`

- [x] **Step 1: 在契约测试中导入诊断接口**

把 `tests/server.contracts.test.js` 顶部导入补充为：

```js
const {
  PLAN_VALIDATION_CODES,
  findPlanValidationIssues,
  validateNormalizedProfile,
  validateIntake,
  validateModelClassification,
  validateClassification,
  validatePlan,
  validatePlanStop,
  validateFeedback,
} = require('../server/contracts.js');
```

- [x] **Step 2: 增加真实失败形态的诊断测试**

在步骤 3 方案契约测试后增加：

```js
test('方案诊断报告真实响应形态中的 B 类型双 SBI 与占位内容问题', () => {
  const invalid = {
    entry: ['从XX项目切入。'],
    cautions: ['聚焦行为。'],
    frequency: 'X月X日复盘。',
    gap_fix: ['情境：周一例会。行为：未同步风险。影响：团队临时调整。'],
    scripts: [
      'Goal（目标）：完成XX模块。Reality（现状）：目前仍需主管提醒。',
      'Options（可选方案）：你还想到哪些方式？Will（行动承诺）：X月X日前执行。',
    ],
  };

  assert.deepEqual(findPlanValidationIssues(invalid, { typeId: 'B' }), [
    PLAN_VALIDATION_CODES.MISSING_GAP_FIX_SBI,
    PLAN_VALIDATION_CODES.MISSING_SCRIPT_SBI,
    PLAN_VALIDATION_CODES.PLACEHOLDER_CONTENT,
  ]);
  assert.equal(validatePlan(invalid, { typeId: 'B' }), false);
});

test('方案诊断单独报告确实缺失的 GROW 阶段', () => {
  const invalid = {
    entry: ['从本周协作目标切入。'],
    cautions: ['聚焦行为。'],
    frequency: '本周五复盘一次。',
    gap_fix: ['把主动同步拆成可观察的小步骤。'],
    scripts: [
      'Goal（目标）：本周主动同步一次风险。Reality（现状）：目前仍需主管提醒。',
      'Options（可选方案）：列出两个可选动作。',
    ],
  };

  assert.deepEqual(findPlanValidationIssues(invalid, { typeId: 'A' }), [
    PLAN_VALIDATION_CODES.INVALID_GROW,
  ]);
});
```

- [x] **Step 3: 增加有效方案、非 SBI 类型和事实不足表达测试**

继续增加：

```js
test('严格有效方案没有诊断问题，事实不足说明不被误判为占位内容', () => {
  const valid = {
    entry: ['从本周主动同步目标切入。'],
    cautions: ['只讨论已提供的可观察行为。'],
    frequency: '本周五复盘一次。',
    gap_fix: [
      'Situation（情境）：周一项目例会。Behavior（行为）：你没有在会前同步风险。Impact（影响）：需补充该行为造成的具体影响。',
    ],
    scripts: [
      'Goal（目标）：本周主动同步一次风险。Reality（现状）：目前通常要主管提醒后才同步。Situation（情境）：上周评审。Behavior（行为）：你没有提前同步风险。Impact（影响）：需补充该行为造成的具体影响。',
      'Options（可选方案）：可在例会前或里程碑当天同步。Will（行动承诺）：周五前完成首次主动同步。',
    ],
  };

  assert.deepEqual(findPlanValidationIssues(valid, { typeId: 'B' }), []);
  assert.equal(validatePlan(valid, { typeId: 'B' }), true);

  const nonSbiPlan = {
    ...valid,
    gap_fix: ['把主动同步拆成可观察的小步骤。'],
    scripts: [
      'Goal（目标）：本周主动同步一次风险。Reality（现状）：目前通常要主管提醒后才同步。',
      'Options（可选方案）：可在例会前或里程碑当天同步。Will（行动承诺）：周五前完成首次主动同步。',
    ],
  };
  for (const typeId of ['A', 'C', 'D1']) {
    assert.deepEqual(findPlanValidationIssues(nonSbiPlan, { typeId }), []);
  }
});

test('所有画像类型都拒绝约定的方案占位内容', () => {
  const base = {
    entry: ['从本周协作目标切入。'],
    cautions: ['聚焦行为。'],
    frequency: '本周五复盘一次。',
    gap_fix: ['把主动同步拆成可观察的小步骤。'],
    scripts: [
      'Goal（目标）：本周主动同步一次风险。Reality（现状）：目前通常要主管提醒后才同步。',
      'Options（可选方案）：可在例会前同步。Will（行动承诺）：周五前完成。',
    ],
  };

  for (const placeholder of ['XX项目', 'XX模块', 'X月X日', '某员工', '某任务']) {
    const candidate = { ...base, entry: [`围绕${placeholder}开始沟通。`] };
    assert.deepEqual(findPlanValidationIssues(candidate, { typeId: 'A' }), [
      PLAN_VALIDATION_CODES.PLACEHOLDER_CONTENT,
    ]);
  }
});
```

- [x] **Step 4: 运行契约测试并确认失败**

Run:

```powershell
node --test tests/server.contracts.test.js
```

Expected: FAIL，原因是 `PLAN_VALIDATION_CODES` 与 `findPlanValidationIssues` 尚未导出。

- [x] **Step 5: 实现稳定诊断接口并让布尔校验复用它**

在 `server/contracts.js` 的 `validatePlan` 前增加：

```js
const PLAN_VALIDATION_CODES = Object.freeze({
  INVALID_SCHEMA: 'INVALID_SCHEMA',
  INVALID_GROW: 'INVALID_GROW',
  MISSING_GAP_FIX_SBI: 'MISSING_GAP_FIX_SBI',
  MISSING_SCRIPT_SBI: 'MISSING_SCRIPT_SBI',
  PLACEHOLDER_CONTENT: 'PLACEHOLDER_CONTENT',
});

const PLAN_PLACEHOLDER_PATTERN = /(?:XX(?:项目|模块)|X月X日|某员工|某任务)/i;

function containsPlanPlaceholder(payload) {
  const values = [
    ...payload.entry,
    ...payload.cautions,
    payload.frequency,
    ...payload.gap_fix,
    ...payload.scripts,
  ];
  return values.some((value) => PLAN_PLACEHOLDER_PATTERN.test(value));
}

function findPlanValidationIssues(payload, { typeId } = {}) {
  if (!validatePlanSchema(payload)) {
    return [PLAN_VALIDATION_CODES.INVALID_SCHEMA];
  }

  const issues = [];
  if (!hasCompleteGrowScripts(payload.scripts)) {
    issues.push(PLAN_VALIDATION_CODES.INVALID_GROW);
  }

  if (typeId === 'B' || typeId === 'D2') {
    if (!payload.gap_fix.some(hasCompleteSbi)) {
      issues.push(PLAN_VALIDATION_CODES.MISSING_GAP_FIX_SBI);
    }
    if (!payload.scripts.some(hasCompleteSbi)) {
      issues.push(PLAN_VALIDATION_CODES.MISSING_SCRIPT_SBI);
    }
  }

  if (containsPlanPlaceholder(payload)) {
    issues.push(PLAN_VALIDATION_CODES.PLACEHOLDER_CONTENT);
  }
  return issues;
}

function validatePlan(payload, { typeId } = {}) {
  return findPlanValidationIssues(payload, { typeId }).length === 0;
}
```

删除原来的 `validatePlan` 实现，并在 `module.exports` 中增加：

```js
  PLAN_VALIDATION_CODES,
  findPlanValidationIssues,
```

诊断只返回稳定错误码，不包含员工输入或原始模型文本；schema 不合格时立即返回 `INVALID_SCHEMA`，避免访问不存在的数组。

- [x] **Step 6: 运行聚焦测试并确认通过**

Run:

```powershell
node --test tests/server.contracts.test.js
```

Expected: 全部通过。

- [x] **Step 7: 检查差异并提交 Task 2**

```powershell
git diff -- server/contracts.js tests/server.contracts.test.js
git status --short
git add server/contracts.js tests/server.contracts.test.js
git commit -m "feat: diagnose strict plan contract failures"
```

---

### Task 3: 用精确模板强化步骤 3 提示词

**Files:**
- Modify: `tests/server.routes.test.js`
- Modify: `prompts/system.md:91-125`

- [x] **Step 1: 为步骤 3 提示词增加失败断言**

在 `tests/server.routes.test.js` 现有 prompt loader 步骤 3 测试中，保留已有断言并增加：

```js
assert.match(step3Prompt, /script 1.*Goal（目标）.*Reality（现状）.*Situation（情境）.*Behavior（行为）.*Impact（影响）/s);
assert.match(step3Prompt, /script 2.*Options（可选方案）.*Will（行动承诺）/s);
assert.match(step3Prompt, /不得缩写为“目标/现状/可选方案/行动承诺”/);
assert.match(step3Prompt, /不得缩写为“情境/行为/影响”/);
assert.match(step3Prompt, /Impact（影响）：需补充该行为造成的具体影响/);
assert.match(step3Prompt, /XX项目、XX模块、X月X日、某员工、某任务/);
assert.match(step3Prompt, /scripts 必须恰好 2 条/);
```

如果现有测试变量名不是 `step3Prompt`，使用该测试中由 `promptLoader.buildMessages(3, payload)` 拼出的 system/user 文本变量，不能新增第二套 prompt loader。

- [x] **Step 2: 运行提示词聚焦测试并确认失败**

Run:

```powershell
node --test --test-name-pattern="prompt loader.*步骤 3|步骤 3.*prompt" tests/server.routes.test.js
```

Expected: 新断言失败，因为现有输出骨架只有空字符串，没有完整的条件模板和禁止简称规则。

- [x] **Step 3: 用精确双语模板替换步骤 3 的空输出骨架说明**

在 `prompts/system.md` 的步骤 3 中保留现有角色、知识库、停止生成和高风险规则，并把方法与输出要求强化为以下内容：

```markdown
【严格标签规则】
- scripts 必须恰好 2 条。
- 每个阶段都必须使用完整双语标签，标签后使用中文冒号：Goal（目标）：、Reality（现状）：、Options（可选方案）：、Will（行动承诺）：。
- 不得缩写为“目标/现状/可选方案/行动承诺”，不得改变英文或中文名称。
- script 1 固定按 Goal（目标）→ Reality（现状）的顺序；script 2 固定按 Options（可选方案）→ Will（行动承诺）的顺序。
- requires_sbi=true 时，script 1 在 Reality（现状）之后继续按 Situation（情境）→ Behavior（行为）→ Impact（影响）的顺序写出完整 SBI；gap_fix 至少一条也必须使用完整 SBI。
- SBI 必须使用完整双语标签 Situation（情境）：、Behavior（行为）：、Impact（影响）：，不得缩写为“情境/行为/影响”。
- 每个标签单独换行，或紧跟在句号、分号、问号、感叹号后；标签内容不得为空。
- Behavior（行为）只能引用 normalized_profile 中已提供的可观察行为。缺少影响事实时写“Impact（影响）：需补充该行为造成的具体影响”，不得编造结果。
- 禁止使用 XX项目、XX模块、X月X日、某员工、某任务。日期、项目或任务信息不足时，使用用户已提供的时间范围与描述，或明确说明需要管理者补充。

【输出模板】仅输出一个 JSON 对象，不要使用 Markdown 代码围栏，不要输出解释。

requires_sbi=false 时，scripts 必须采用：
{"entry":["具体沟通切入点"],"cautions":["具体注意事项"],"frequency":"具体沟通节奏","gap_fix":["具体差距修正动作"],"scripts":["Goal（目标）：结合实际输入的目标。\nReality（现状）：结合实际输入的当前行为或困难。","Options（可选方案）：基于实际任务提出两个可选动作。\nWill（行动承诺）：明确由谁在何时完成哪个动作并如何复盘。"]}

requires_sbi=true 时，scripts 与 gap_fix 必须采用：
{"entry":["具体沟通切入点"],"cautions":["具体注意事项"],"frequency":"具体沟通节奏","gap_fix":["Situation（情境）：引用员工输入中的具体场景。\nBehavior（行为）：引用员工输入中的可观察行为。\nImpact（影响）：引用已知影响；未知时写需补充该行为造成的具体影响。"],"scripts":["Goal（目标）：结合实际输入的目标。\nReality（现状）：结合实际输入的当前行为或困难。\nSituation（情境）：引用员工输入中的具体场景。\nBehavior（行为）：引用员工输入中的可观察行为。\nImpact（影响）：引用已知影响；未知时写需补充该行为造成的具体影响。","Options（可选方案）：基于实际任务提出两个可选动作。\nWill（行动承诺）：明确由谁在何时完成哪个动作并如何复盘。"]}
```

模板中的描述是格式示范；最终输出仍必须使用本次 `normalized_profile`、分类理由和用户困扰中的具体内容。

- [x] **Step 4: 运行提示词聚焦测试并确认通过**

Run:

```powershell
node --test --test-name-pattern="prompt loader.*步骤 3|步骤 3.*prompt" tests/server.routes.test.js
```

Expected: 聚焦测试通过。

- [x] **Step 5: 检查差异并提交 Task 3**

```powershell
git diff -- prompts/system.md tests/server.routes.test.js
git status --short
git add prompts/system.md tests/server.routes.test.js
git commit -m "fix: strengthen strict plan output template"
```

---

### Task 4: 让 DeepSeek 客户端的唯一一次重试接收纠错消息

**Files:**
- Modify: `tests/server.routes.test.js`
- Modify: `server/deepseek-client.js:17-91`

- [x] **Step 1: 增加诊断重试请求测试**

在 `tests/server.routes.test.js` 的 DeepSeek client 重试测试旁增加：

```js
test('模型语义响应无效时第二次请求追加服务端纠错消息', async () => {
  const requestBodies = [];
  let calls = 0;
  const client = createDeepSeekClient({
    apiKey: 'test-key',
    fetchImpl: async (_url, options) => {
      calls += 1;
      requestBodies.push(JSON.parse(options.body));
      return okModelResponse(JSON.stringify(
        calls === 1 ? { value: 'invalid' } : { value: 'valid' },
      ));
    },
  });

  const result = await client.complete({
    messages: [{ role: 'user', content: '生成严格 JSON' }],
    validate: (payload) => payload.value === 'valid',
    diagnose: () => ['INVALID_GROW', 'MISSING_SCRIPT_SBI'],
    buildRetryMessage: (issues) => `PLAN_CONTRACT_REPAIR\n${issues.join('\n')}`,
  });

  assert.deepEqual(result, { value: 'valid' });
  assert.equal(requestBodies.length, 2);
  assert.deepEqual(requestBodies[0].messages, [
    { role: 'user', content: '生成严格 JSON' },
  ]);
  assert.deepEqual(requestBodies[1].messages, [
    { role: 'user', content: '生成严格 JSON' },
    {
      role: 'user',
      content: 'PLAN_CONTRACT_REPAIR\nINVALID_GROW\nMISSING_SCRIPT_SBI',
    },
  ]);
});
```

- [x] **Step 2: 增加两次无效与不可解析响应的边界测试**

继续增加或扩展已有测试：

```js
test('两次语义响应均无效时保持统一安全错误', async () => {
  const requestBodies = [];
  const client = createDeepSeekClient({
    apiKey: 'test-key',
    fetchImpl: async (_url, options) => {
      requestBodies.push(JSON.parse(options.body));
      return okModelResponse(JSON.stringify({ value: 'invalid' }));
    },
  });

  await assert.rejects(client.complete({
    messages: [{ role: 'user', content: '生成严格 JSON' }],
    validate: () => false,
    diagnose: () => ['INVALID_GROW'],
    buildRetryMessage: (issues) => `PLAN_CONTRACT_REPAIR\n${issues.join('\n')}`,
  }), { code: 'INVALID_MODEL_RESPONSE' });

  assert.equal(requestBodies.length, 2);
  assert.match(requestBodies[1].messages.at(-1).content, /INVALID_GROW/);
});

test('JSON 不可解析时仍按原请求重试且不伪造诊断', async () => {
  const requestBodies = [];
  const client = createDeepSeekClient({
    apiKey: 'test-key',
    fetchImpl: async (_url, options) => {
      requestBodies.push(JSON.parse(options.body));
      return okModelResponse('{not-json');
    },
  });

  await assert.rejects(client.complete({
    messages: [{ role: 'user', content: '生成严格 JSON' }],
    validate: () => false,
    diagnose: () => ['INVALID_GROW'],
    buildRetryMessage: () => '不应加入',
  }), { code: 'INVALID_MODEL_RESPONSE' });

  assert.deepEqual(requestBodies[1].messages, requestBodies[0].messages);
});
```

若项目已有“两次无效返回安全错误”测试，扩展原测试而非创建语义重复用例。

- [x] **Step 3: 运行客户端聚焦测试并确认失败**

Run:

```powershell
node --test --test-name-pattern="模型语义响应无效|两次语义响应|JSON 不可解析" tests/server.routes.test.js
```

Expected: 第一条测试失败，第二次请求仍与第一次相同。

- [x] **Step 4: 实现可选诊断与纠错消息参数**

把 `server/deepseek-client.js` 的 `complete` 参数和重试主体调整为：

```js
async function complete({
  messages,
  validate,
  diagnose,
  buildRetryMessage,
  temperature = 0.2,
  maxTokens = 1200,
} = {}) {
  if (!Array.isArray(messages) || typeof validate !== 'function') {
    throw controlledError('INVALID_MODEL_REQUEST');
  }

  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw controlledError('MODEL_SERVICE_UNAVAILABLE');
  }

  let attemptMessages = messages;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const requestBody = JSON.stringify({
        model: 'deepseek-v4-pro',
        stream: false,
        temperature,
        max_tokens: maxTokens,
        thinking: { type: 'disabled' },
        response_format: { type: 'json_object' },
        messages: attemptMessages,
      });

      const response = await fetchImpl(DEEPSEEK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(30_000),
        body: requestBody,
      });

      if (!response || !response.ok) {
        throw modelServiceUnavailable();
      }

      let responseBody;
      try {
        responseBody = await response.json();
      } catch {
        throw invalidModelResponse();
      }

      const choice = responseBody && responseBody.choices && responseBody.choices[0];
      const content = choice && choice.message && choice.message.content;
      if (!choice || choice.finish_reason !== 'stop'
        || typeof content !== 'string' || content.trim() === '') {
        throw invalidModelResponse();
      }

      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw invalidModelResponse();
      }

      if (!validate(parsed)) {
        if (attempt === 0
          && typeof diagnose === 'function'
          && typeof buildRetryMessage === 'function') {
          const issues = diagnose(parsed);
          const retryMessage = buildRetryMessage(Array.isArray(issues) ? issues : []);
          if (typeof retryMessage === 'string' && retryMessage.trim() !== '') {
            attemptMessages = [
              ...messages,
              { role: 'user', content: retryMessage },
            ];
          }
        }
        throw invalidModelResponse();
      }

      return parsed;
    } catch (error) {
      if (error && error.retryable && attempt === 0) {
        continue;
      }

      if (error && error.code === 'INVALID_MODEL_RESPONSE') {
        throw controlledError('INVALID_MODEL_RESPONSE');
      }

      if (error && error.code === 'MODEL_SERVICE_UNAVAILABLE') {
        throw controlledError('MODEL_SERVICE_UNAVAILABLE');
      }

      throw modelServiceUnavailable();
    }
  }

  throw controlledError('INVALID_MODEL_RESPONSE');
}
```

关键边界：

- 第一次请求内容完全不变；
- 只有 JSON 已解析但语义校验失败时才生成纠错消息；
- 第二次请求不回传第一次原始模型内容，只附加服务端生成的稳定指令；
- 未传 `diagnose` / `buildRetryMessage` 的步骤 1、2、4 保持原有行为；
- 两次总尝试次数不变。

- [x] **Step 5: 运行聚焦测试并确认通过**

Run:

```powershell
node --test --test-name-pattern="模型语义响应无效|两次语义响应|JSON 不可解析" tests/server.routes.test.js
```

Expected: 全部通过。

- [x] **Step 6: 检查差异并提交 Task 4**

```powershell
git diff -- server/deepseek-client.js tests/server.routes.test.js
git status --short
git add server/deepseek-client.js tests/server.routes.test.js
git commit -m "feat: add corrective model retry messages"
```

---

### Task 5: 在步骤 3 接入诊断纠错，并区分首次与重出温度

**Files:**
- Modify: `tests/server.routes.test.js`
- Modify: `server/coach-service.js:1-12,104-120,162-204`

- [x] **Step 1: 增加真实失败形态到有效 B 方案的纠错重试测试**

把现有 `plan 用 type_id 语义校验触发模型客户端同一次重试并透传 normalized_profile` 测试扩展为记录两次请求体，并让第一次返回以下失败形态：

```js
const invalidBPlan = planResult({
  entry: ['从XX项目切入。'],
  frequency: 'X月X日复盘。',
  gap_fix: ['情境：周一例会。行为：员工未提前同步风险。影响：团队无法预排资源。'],
  scripts: [
    'Goal（目标）：本周主动同步风险。Reality（现状）：目前仍需主管提醒。',
    'Options（可选方案）：你还能想到哪些办法？Will（行动承诺）：X月X日前执行。',
  ],
});
```

在调用完成后增加：

```js
assert.equal(requestBodies.length, 2);
const correction = requestBodies[1].messages.at(-1);
assert.equal(correction.role, 'user');
assert.match(correction.content, /PLAN_CONTRACT_REPAIR/);
assert.match(correction.content, /MISSING_GAP_FIX_SBI/);
assert.match(correction.content, /MISSING_SCRIPT_SBI/);
assert.match(correction.content, /PLACEHOLDER_CONTENT/);
assert.doesNotMatch(correction.content, /XX项目/);
```

最后一条断言确保纠错消息不复制第一次模型的原文，只表达错误类别和固定修复要求。

- [x] **Step 2: 增加首次方案与“换个角度”的温度测试**

在服务层测试区增加：

```js
test('步骤 3 首次方案使用 0.3，换个角度使用 0.45', async () => {
  const calls = [];
  const validPlan = planResult();
  const client = {
    complete: async (options) => {
      calls.push(options);
      return validPlan;
    },
  };
  const promptLoader = createTestPromptLoader();
  const service = createCoachService({ promptLoader, client });
  const classification = classificationResult({ type_id: 'A', quadrant: 'A' });
  const normalizedProfile = intakeResult().normalized_profile;

  await service.plan({
    classification,
    normalizedProfile,
    pain: normalizedProfile.pain,
    regenerate: false,
    previousPlan: null,
  });
  await service.plan({
    classification,
    normalizedProfile,
    pain: normalizedProfile.pain,
    regenerate: true,
    previousPlan: validPlan,
  });

  assert.equal(calls[0].temperature, 0.3);
  assert.equal(calls[1].temperature, 0.45);
  assert.equal(typeof calls[0].diagnose, 'function');
  assert.equal(typeof calls[0].buildRetryMessage, 'function');
});
```

如果 `classificationResult()` 的默认 `strategy` / `coach_mode` 与 A 类型不一致，使用测试文件内现有 A 类型 fixture 字段覆盖，确保失败只来自未实现的温度与诊断接入。

- [x] **Step 3: 运行服务层聚焦测试并确认失败**

Run:

```powershell
node --test --test-name-pattern="plan 用 type_id|步骤 3 首次方案使用" tests/server.routes.test.js
```

Expected: FAIL；第二次请求尚无错误码纠错消息，且当前两个场景都使用 `0.55`。

- [x] **Step 4: 导入诊断接口并定义固定纠错文案映射**

在 `server/coach-service.js` 顶部从 `contracts.js` 的导入中增加：

```js
  PLAN_VALIDATION_CODES,
  findPlanValidationIssues,
```

在 `createCoachService` 前增加：

```js
const PLAN_RETRY_GUIDANCE = Object.freeze({
  [PLAN_VALIDATION_CODES.INVALID_SCHEMA]: '输出必须是且仅是包含 entry、cautions、frequency、gap_fix、scripts 的完整 JSON 对象，并满足既有字段类型与数组长度。',
  [PLAN_VALIDATION_CODES.INVALID_GROW]: 'scripts 必须恰好 2 条：第 1 条严格按 Goal（目标）→ Reality（现状），第 2 条严格按 Options（可选方案）→ Will（行动承诺），每段非空。',
  [PLAN_VALIDATION_CODES.MISSING_GAP_FIX_SBI]: 'gap_fix 至少一条必须严格按 Situation（情境）→ Behavior（行为）→ Impact（影响）且每段非空。',
  [PLAN_VALIDATION_CODES.MISSING_SCRIPT_SBI]: 'scripts 第 1 条必须在 Reality（现状）后加入完整 Situation（情境）→ Behavior（行为）→ Impact（影响）。',
  [PLAN_VALIDATION_CODES.PLACEHOLDER_CONTENT]: '删除所有占位内容，只能引用 normalized_profile 中的真实目标、行为、任务和时间；事实不足时明确说明需要补充。',
});

function buildPlanRetryMessage(issues) {
  const guidance = [...new Set(issues)]
    .map((code) => PLAN_RETRY_GUIDANCE[code])
    .filter(Boolean);

  return [
    'PLAN_CONTRACT_REPAIR',
    '上一输出未通过严格方案契约。请重新生成完整 JSON，不要解释，不要使用 Markdown 代码围栏。',
    ...guidance.map((item) => `- ${item}`),
    '- 保留原始请求中的画像类型、策略、教练模式和 normalized_profile，不得改变分类结论。',
  ].join('\n');
}
```

该映射只含固定规则，不拼接模型原文、员工信息或密钥。

- [x] **Step 5: 让 completeStep 可透传可选重试配置**

将 `completeStep` 改为：

```js
async function completeStep(
  step,
  payload,
  validate,
  temperature,
  maxTokens,
  retryOptions = {},
) {
  if (!promptLoader || typeof promptLoader.buildMessages !== 'function'
    || !client || typeof client.complete !== 'function') {
    throw controlledError('MODEL_SERVICE_UNAVAILABLE');
  }

  const result = await client.complete({
    messages: promptLoader.buildMessages(step, payload),
    validate,
    temperature,
    maxTokens,
    ...retryOptions,
  });

  if (!validate(result)) {
    throw controlledError('INVALID_MODEL_RESPONSE');
  }

  return result;
}
```

原有步骤 1、2、4 调用不传第六个参数，行为不变。

- [x] **Step 6: 在 plan 中接入诊断和温度选择**

在 `plan(request)` 内建立与布尔校验相同 `typeId` 的诊断器：

```js
const typeId = request.classification.type_id;
const requiresSbi = ['B', 'D2'].includes(typeId);
const validate = (payload) => validatePlan(payload, { typeId });
const diagnose = (payload) => findPlanValidationIssues(payload, { typeId });
const temperature = request.regenerate ? 0.45 : 0.3;
```

把步骤 3 的 `completeStep` 尾部参数改为：

```js
    }, validate, temperature, 1400, {
      diagnose,
      buildRetryMessage: buildPlanRetryMessage,
    });
```

不得修改 `model: 'deepseek-v4-pro'`、`maxTokens`、步骤 1/2/4 温度或 API payload。

- [x] **Step 7: 运行服务层聚焦测试并确认通过**

Run:

```powershell
node --test --test-name-pattern="plan 用 type_id|步骤 3 首次方案使用" tests/server.routes.test.js
```

Expected: 全部通过；真实响应形态在放宽问号边界后不再误报 GROW，但第二次请求仍出现缺少双 SBI 与占位内容三个对应错误码；首次/重出温度分别为 `0.3` 和 `0.45`。

- [x] **Step 8: 检查差异并提交 Task 5**

```powershell
git diff -- server/coach-service.js tests/server.routes.test.js
git status --short
git add server/coach-service.js tests/server.routes.test.js
git commit -m "fix: correct invalid coaching plans on retry"
```

---

### Task 6: 全量回归、边界检查和计划收尾

**Files:**
- Modify: `docs/agent-plans/2026-07-21-coach-assistant-plan-contract-repair-and-corrective-retry-plan.md`

- [x] **Step 1: 运行三个服务端聚焦测试文件**

```powershell
node --test tests/server.coaching-methods.test.js
node --test tests/server.contracts.test.js
node --test tests/server.routes.test.js
```

Expected: 三条命令均 exit code `0`，没有真实网络请求。

- [x] **Step 2: 运行项目全量测试**

```powershell
npm.cmd test
```

Expected: 全部测试通过；Playwright 使用现有 fixture/fake API，不调用真实 DeepSeek API。

- [x] **Step 3: 检查空白错误和最终工作区**

```powershell
git diff --check
git status --short
git diff HEAD -- server/coaching-methods.js server/contracts.js prompts/system.md server/deepseek-client.js server/coach-service.js tests/server.coaching-methods.test.js tests/server.contracts.test.js tests/server.routes.test.js
```

Expected:

- `git diff --check` 无输出且 exit code `0`；
- 没有 `.env`、密钥、测试报告、缓存或无关文档进入提交；
- 开始前已有的未跟踪文档与 `output/` 仍保留且未暂存。

- [x] **Step 4: 人工审查严格契约边界**

仅审查代码和 fixture，不进行真实 API 调用：

1. 中文简称标签仍被拒绝。
2. `？Will（行动承诺）：` 可被识别。
3. B/D2 同时要求 `gap_fix` 与至少一条 `scripts` 有完整 SBI。
4. A/C/D1 不强制 SBI，但仍严格要求完整 GROW。
5. 五种约定占位内容在所有画像类型中被拒绝。
6. “Impact（影响）：需补充该行为造成的具体影响”被接受，不会诱导模型编造事实。
7. 纠错消息不复制模型原文、员工内容或密钥。
8. 两次均无效仍对前端返回统一 `INVALID_MODEL_RESPONSE` 映射，不泄露内部诊断。

- [x] **Step 5: 验证通过后更新本计划复选框并提交计划状态**

只把已经有命令证据的步骤由 `- [ ]` 改为 `- [x]`，再执行：

```powershell
git diff -- docs/agent-plans/2026-07-21-coach-assistant-plan-contract-repair-and-corrective-retry-plan.md
git add docs/agent-plans/2026-07-21-coach-assistant-plan-contract-repair-and-corrective-retry-plan.md
git commit -m "docs: record strict plan retry implementation"
git status --short
```

如果本计划文件在执行开始时尚未被 Git 跟踪，仅暂存该文件本身，不能暂存整个 `docs/agent-plans/`。

---

## 完成标准

全部条件同时满足才可声明完成：

- 严格双语 GROW/SBI 标签规则没有被降级；
- 中文问号、感叹号等自然分隔符不会造成误判；
- 步骤 3 第一次语义无效时，第二次请求包含精确的固定纠错要求；
- 第二次仍无效时，继续使用现有安全错误，不泄露模型原文；
- B/D2 保持双 SBI，A/C/D1 保持完整 GROW；
- 约定占位内容被契约拒绝，“需补充具体影响”仍可表达事实不足；
- 首次方案温度为 `0.3`，“换个角度”为 `0.45`；
- 全量测试和 `git diff --check` 通过；
- 无真实 API 测试、无新依赖、无部署、无 push、无无关文件提交。

## 执行 Prompt

```text
你是 executor，请接手并严格执行以下实施计划：

项目目录：
D:\codex-pj\teacher

实施计划：
D:\codex-pj\teacher\docs\agent-plans\2026-07-21-coach-assistant-plan-contract-repair-and-corrective-retry-plan.md

开始前：

1. 使用 executing-plans skill。
2. 阅读项目内 AGENTS.md（如存在）、README.md、package.json 和上述计划全文。
3. 执行：
   git status --short
   git diff
   git log --oneline -15
4. 当前工作区存在用户已有的未跟踪文档和 output/，包括 docs/agent-plans/ 下的历史计划、docs/ 下的测试文档及参考资料。这些内容属于用户，不得删除、修改、暂存或提交。
5. 不得读取、显示、复制或提交 .env 中的真实密钥；了解配置只能看 .env.example。

严格按计划 Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 顺序执行，不得并行修改共享文件。

目标：

- 继续严格要求完整双语 Goal（目标）、Reality（现状）、Options（可选方案）、Will（行动承诺）标签；
- B、D2 继续严格要求 gap_fix 和至少一条 scripts 各自包含完整双语 Situation（情境）、Behavior（行为）、Impact（影响）；
- 只放宽标签前的自然标点边界，不接受中文简称；
- 第一次方案语义无效后，用稳定诊断错误码生成固定纠错消息，再执行现有的唯一一次重试；
- 禁止 XX项目、XX模块、X月X日、某员工、某任务，但允许“需补充该行为造成的具体影响”；
- 首次方案 temperature 为 0.3，“换个角度”为 0.45；
- 两次均无效时保持现有安全错误边界。

开发约束：

- 严格使用 TDD：每个 Task 先写失败测试并运行确认失败原因正确，再做最小实现并确认通过。
- 只修改计划列出的服务端、提示词、测试和该计划文档。
- 不修改 frontend/、知识库、步骤 1/2/4 契约、API 路径、DeepSeek 模型名称或依赖。
- 不增加重试次数，不新增后端接口、数据库、浏览器持久化或跨会话记忆。
- 自动化测试必须使用现有 fixture、fake client 或 fake fetch，不得调用真实 DeepSeek API，不得产生 API 费用。
- 如认为仍需真实 API 测试，必须先停止并向用户重新申请明确授权。
- 不做无关重构，不绕过或禁用 Git hooks。
- PowerShell 命令不得使用 Bash 风格的 &&。
- 禁止使用 git add .；每个 Task 只暂存计划明确列出的文件。

每个 Task 完成后：

1. 运行计划指定的聚焦测试。
2. 检查 git status --short 和本 Task 文件差异。
3. 只暂存本 Task 对应文件。
4. 使用计划指定的英文 commit message 提交。
5. 测试通过后再更新相应复选框，不得提前勾选。

全部完成后运行：

node --test tests/server.coaching-methods.test.js
node --test tests/server.contracts.test.js
node --test tests/server.routes.test.js
npm.cmd test
git diff --check
git status --short

随后更新计划文档中实际完成的复选框，只暂存该计划文件本身并按计划提交。不要部署，不要 push，不要安装新依赖。

最终汇报：

- 各层修复如何完成；
- 实际修改的关键文件；
- 每条验证命令、测试数量与结果；
- 生成的 commit hash；
- 是否存在未完成项或剩余风险；
- 最终 Git 状态；
- 明确列出仍保留且未提交的用户原有改动。
```
