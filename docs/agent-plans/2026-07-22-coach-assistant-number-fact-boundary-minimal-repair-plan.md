# 教练助手数字事实边界最小修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 B 类方案中“一次/1次”等等价数字表达被误判，以及模型在没有数字事实来源时反复生成具体频率数字而导致两次方案响应均无效的问题。

**Architecture:** 保持当前严格事实边界和唯一一次模型重试不变。先在事实边界层把中文数字与阿拉伯数字归一为相同 canonical form（规范形式），再让步骤 3 提示词与纠错消息在没有数字来源时使用定性节奏；运行时诊断只记录数字书写形式与单位，不记录具体数值、员工文本或模型原文。

**Tech Stack:** Node.js 20、CommonJS、Express、DeepSeek fake fetch/fake client、Node.js test runner、Playwright。

---

## 已确认生产证据

服务器版本和运行状态已经排除部署问题：

- 服务器提交：`fd798968c89c4a77f189a0bf240546db40bf7a68`；
- `main` 与 `origin/main` 一致；
- `teacher.service` 在更新后已经重启且为 `active (running)`；
- 步骤 1、步骤 2 正常，错误只发生在步骤 3；
- 方案两次响应均已进入语义校验，主要稳定诊断为 `UNSUPPORTED_NUMBER`；
- 首次响应偶尔同时出现 `UNSUPPORTED_RESULT`、`UNSUPPORTED_CAUSALITY`，纠错后可消失；
- 后续重写偶尔新增 `UNSUPPORTED_PERSON`、`UNSUPPORTED_CAUSALITY`，但持续阻塞项仍为 `UNSUPPORTED_NUMBER`。

当前规则可稳定复现：

```text
source:    每周主动汇报一次
generated: 建议每周汇报1次
result:    UNSUPPORTED_NUMBER
```

当前提示词同时要求 `frequency` “给具体节奏”，模型容易生成 `每周1次`、`15分钟`；数字事实检查却要求每个数字 token 在会话事实源中以完全相同文本出现。这是本计划要消除的最小冲突。

---

## 已确认产品与安全口径

1. `一次` 与 `1次`、`两个` 与 `2个`、`四周` 与 `4周`、`百分之三十` 与 `30%` 视为相同数字事实。
2. 只允许复述事实源中已有的数字；本计划不允许模型自行新增 `15分钟`、`3次` 等建议数字。
3. 没有可复用数字时，`frequency` 使用 `低频`、`中频`、`高频`、`持续跟进`、`按项目节点` 等定性节奏。
4. 不放宽日期、人物、结果、影响和因果关系边界。
5. 不增加重试次数，仍然只有首次生成和唯一一次纠错重试。
6. 不记录完整模型响应、用户输入、API Key 或具体数字值。
7. 诊断日志只允许出现如 `arabic:次`、`chinese:分钟` 的书写形式与单位，最多 5 项。
8. 不修改前端、API 路径、模型名称、temperature、max_tokens、依赖、数据库或持久化。

---

## 文件职责与严格范围

**允许修改：**

- `server/fact-boundary.js`：数字 canonical form、事实边界详情和安全数字种类。
- `server/coach-service.js`：无来源数字的纠错文案，并把安全诊断详情传给模型客户端。
- `server/deepseek-client.js`：白名单过滤并记录安全诊断详情。
- `prompts/system.md`：步骤 3 无数字来源时只使用定性频率。
- `tests/server.fact-boundary.test.js`：数字等价、未知建议数字及安全诊断测试。
- `tests/server.routes.test.js`：提示词、纠错消息、唯一重试和日志安全测试。
- `docs/agent-plans/2026-07-22-coach-assistant-number-fact-boundary-minimal-repair-plan.md`：验证后更新复选框。

**明确不修改：**

- `frontend/`；
- `server/contracts.js`、`server/coaching-methods.js`、`server/app.js`；
- `knowledge/ability-willingness-grid.md`；
- `package.json`、`package-lock.json`；
- `.env`、DeepSeek 模型名称、请求地址、重试次数、temperature、max_tokens；
- 部署脚本、systemd、Nginx 和服务器配置；
- 用户现有未跟踪文档、`.playwright-cli/`、`output/`、`playwright.reuse-existing.config.js`。

---

## 开始前检查

执行者先阅读：

```powershell
Get-Content README.md
Get-Content package.json
Get-Content server/fact-boundary.js
Get-Content server/coach-service.js
Get-Content server/deepseek-client.js
Get-Content prompts/system.md
Get-Content tests/server.fact-boundary.test.js
Get-Content tests/server.routes.test.js
git status --short
git diff
git log --oneline -15
```

约束：

- 不读取或显示 `.env` 的真实值；配置结构只能查看 `.env.example`。
- 当前工作区有用户未跟踪文档和输出目录，不得删除、修改、暂存或提交。
- 禁止 `git add .` 和 `git add -A`。
- 所有自动化使用 fake client/fake fetch，不调用真实 DeepSeek，不产生 API 费用。
- 每个任务按 TDD：先写失败测试并确认失败原因，再实现最小代码。

---

### Task 1: 归一化事实源与模型输出中的等价数字

**Files:**
- Modify: `tests/server.fact-boundary.test.js`
- Modify: `server/fact-boundary.js:7-58`

- [x] **Step 1: 增加数字等价与未知建议数字的失败测试**

在 `tests/server.fact-boundary.test.js` 末尾增加：

```js
test('中文与阿拉伯数字的等价数量表达共享同一事实来源', () => {
  const source = {
    goal: '未来四周内每周主动汇报一次进展。',
    history: '过去两个绩效周期均完成交付，返工比例为百分之三十。',
  };

  assert.deepEqual(findFactBoundaryIssues({
    source,
    generated: {
      goal: '未来4周内每周主动汇报1次进展。',
      history: '过去2个绩效周期均完成交付，返工比例为30%。',
    },
  }), []);
});

test('仍拒绝事实源中不存在的建议时长和次数', () => {
  assert.deepEqual(findFactBoundaryIssues({
    source: { goal: '提升主动同步意愿。' },
    generated: { frequency: '建议每周沟通3次，每次15分钟。' },
  }), [FACT_BOUNDARY_CODES.UNSUPPORTED_NUMBER]);
});
```

- [x] **Step 2: 运行聚焦测试并确认红灯**

```powershell
node --test tests/server.fact-boundary.test.js
```

Expected：第一个新增测试 FAIL，当前实现会把 `4周`、`1次`、`2个`、`30%` 判为 `UNSUPPORTED_NUMBER`；第二个新增测试继续 PASS，证明严格边界没有被测试预期放宽。

- [x] **Step 3: 实现中文整数与数量 token 的 canonical form**

在 `NUMBER_PATTERN` 后增加：

```js
const CHINESE_DIGITS = Object.freeze({
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9,
});
const CHINESE_UNITS = Object.freeze({ 十: 10, 百: 100, 千: 1000, 万: 10000 });
const CHINESE_QUANTITY_PATTERN = /^([零一二两三四五六七八九十百千万]+)(次|天|周|月|年|小时|分钟|人|项|个|分|元|周期)$/;

function parseChineseInteger(value) {
  let total = 0;
  let section = 0;
  let number = 0;

  for (const character of value) {
    if (Object.hasOwn(CHINESE_DIGITS, character)) {
      number = CHINESE_DIGITS[character];
      continue;
    }

    const unit = CHINESE_UNITS[character];
    if (unit === 10000) {
      section += number;
      total += section * unit;
      section = 0;
      number = 0;
    } else {
      section += (number || 1) * unit;
      number = 0;
    }
  }

  return total + section + number;
}

function normalizeNumberToken(token) {
  const value = compact(token);
  const percent = /^百分之([零一二两三四五六七八九十百千万]+)$/.exec(value);
  if (percent) return `${parseChineseInteger(percent[1])}%`;

  const quantity = CHINESE_QUANTITY_PATTERN.exec(value);
  if (quantity) return `${parseChineseInteger(quantity[1])}${quantity[2]}`;
  return value;
}
```

将 `missingTokens` 替换为：

```js
function missingTokens(pattern, generatedText, sourceText, normalizeToken = compact) {
  const sourceTokens = new Set(
    (sourceText.match(pattern) || []).map((token) => normalizeToken(token)),
  );
  const generatedTokens = [...new Set(generatedText.match(pattern) || [])];
  return generatedTokens.filter((token) => !sourceTokens.has(normalizeToken(token)));
}
```

将数字检查改为：

```js
if (missingTokens(NUMBER_PATTERN, generatedText, sourceText, normalizeNumberToken).length > 0) {
  issues.push(FACT_BOUNDARY_CODES.UNSUPPORTED_NUMBER);
}
```

日期与人物继续使用默认 `compact` 比较，不改变原有边界。

- [x] **Step 4: 运行事实边界测试并确认绿灯**

```powershell
node --test tests/server.fact-boundary.test.js
```

Expected：全部 PASS；等价数字不再误判，`3次`、`15分钟` 仍被拒绝，既有日期、人物、结果、因果测试不回归。

- [x] **Step 5: 检查并提交 Task 1**

```powershell
git diff --check -- server/fact-boundary.js tests/server.fact-boundary.test.js
git diff -- server/fact-boundary.js tests/server.fact-boundary.test.js
git add -- server/fact-boundary.js tests/server.fact-boundary.test.js
git diff --cached --check
git commit -m "fix: normalize equivalent fact numbers"
```

---

### Task 2: 无数字来源时使用定性频率并强化纠错消息

**Files:**
- Modify: `tests/server.routes.test.js`
- Modify: `server/coach-service.js:108-122`
- Modify: `prompts/system.md:99-150`

- [x] **Step 1: 增加步骤 3 提示词和纠错消息失败测试**

在 `tests/server.routes.test.js` 的提示词测试附近增加：

```js
test('步骤 3 在没有数字来源时要求定性频率且数字纠错不增加重试', async () => {
  const loader = createPromptLoader({ rootDir: path.join(__dirname, '..') });
  const step3Prompt = loader.buildMessages(3, { requires_sbi: true })[0].content;
  assert.match(step3Prompt, /没有可复用的具体数字/);
  assert.match(step3Prompt, /低频|中频|高频|按项目节点/);

  let capturedOptions;
  const client = {
    complete: async (options) => {
      capturedOptions = options;
      return planResult();
    },
  };
  const service = createCoachService({
    promptLoader: createTestPromptLoader(),
    client,
  });
  const profile = intakeResult().normalized_profile;

  await service.plan({
    classification: classificationResult(),
    normalizedProfile: profile,
    pain: profile.pain,
    regenerate: false,
    previousPlan: null,
  });

  const correction = capturedOptions.buildRetryMessage(['UNSUPPORTED_NUMBER']);
  assert.match(correction, /frequency/);
  assert.match(correction, /没有可复用的数字时/);
  assert.match(correction, /定性节奏/);
  assert.doesNotMatch(correction, /15分钟|3次/);
});
```

- [x] **Step 2: 运行新增测试并确认红灯**

```powershell
node --test --test-name-pattern "步骤 3 在没有数字来源时要求定性频率" tests/server.routes.test.js
```

Expected：FAIL；当前步骤 3 提示词和 `UNSUPPORTED_NUMBER` 纠错文案没有明确要求定性节奏。

- [x] **Step 3: 收紧步骤 3 的 frequency 生成规则**

将 `prompts/system.md` 步骤 3 的 `frequency` 说明改为：

```text
- frequency:建议沟通频率(采用该格建议频率；只有 normalized_profile、pain、classification_reason 或 previous_plan 已提供可复用的具体数字时才能复述该数字，并优先沿用原书写形式；没有可复用的具体数字时，不得新增次数、时长、比例或数量，必须使用低频、中频、高频、持续跟进、按项目节点等定性节奏)
```

在步骤 3 的事实边界约束末尾增加：

```text
frequency 和未来行动同样受数字事实边界约束；“建议”语气不构成新增数字的依据。若输入没有具体次数或时长，只能给定性节奏，不得自行补充“每周1次”“15分钟”等数字。
```

- [x] **Step 4: 强化 `UNSUPPORTED_NUMBER` 固定纠错消息**

将 `FACT_RETRY_GUIDANCE` 中对应项替换为：

```js
[FACT_BOUNDARY_CODES.UNSUPPORTED_NUMBER]: '删除事实源中不存在的具体数字、比例或数量；frequency 和未来行动也不得新增数字。没有可复用的数字时，frequency 必须改为低频、中频、高频、持续跟进或按项目节点等定性节奏。',
```

不修改 `buildPlanRetryMessage` 的重试数量、其他错误码和安全错误边界。

- [x] **Step 5: 运行提示词、服务编排与纠错回归**

```powershell
node --test --test-name-pattern "步骤 3 在没有数字来源时要求定性频率|模型语义响应无效时第二次请求追加服务端纠错消息|事实边界两次无效时保持统一安全错误且不增加重试|步骤 3 首次方案使用" tests/server.routes.test.js
```

Expected：全部 PASS；提示词和纠错消息明确要求定性节奏，模型客户端仍只请求两次，temperature 仍为首次 `0.3`、换个角度 `0.45`。

- [x] **Step 6: 检查并提交 Task 2**

```powershell
git diff --check -- prompts/system.md server/coach-service.js tests/server.routes.test.js
git diff -- prompts/system.md server/coach-service.js tests/server.routes.test.js
git add -- prompts/system.md server/coach-service.js tests/server.routes.test.js
git diff --cached --check
git commit -m "fix: guide number-safe plan retries"
```

---

### Task 3: 增加不暴露具体数值的安全数字诊断

**Files:**
- Modify: `tests/server.fact-boundary.test.js`
- Modify: `tests/server.routes.test.js`
- Modify: `server/fact-boundary.js`
- Modify: `server/coach-service.js`
- Modify: `server/deepseek-client.js`

- [x] **Step 1: 增加安全数字种类失败测试**

把测试文件 import 扩展为：

```js
const {
  FACT_BOUNDARY_CODES,
  findFactBoundaryDiagnostics,
  findFactBoundaryIssues,
} = require('../server/fact-boundary.js');
```

增加：

```js
test('数字诊断只返回书写形式和单位而不返回数值或上下文', () => {
  const diagnostics = findFactBoundaryDiagnostics({
    source: { goal: '每周主动汇报一次进展。' },
    generated: {
      frequency: '建议每周1次，每次15分钟，由员工完成。',
    },
  });

  assert.deepEqual(diagnostics, {
    issues: [FACT_BOUNDARY_CODES.UNSUPPORTED_NUMBER],
    numberKinds: ['arabic:分钟'],
  });
  assert.doesNotMatch(JSON.stringify(diagnostics), /15|员工|进展/);
});
```

这里 `1次` 已与事实源中的 `一次` 等价，因此只剩新增的分钟单位。

- [x] **Step 2: 增加客户端日志白名单失败测试**

在 `tests/server.routes.test.js` 的稳定诊断日志测试附近增加：

```js
test('模型拒绝日志只接受白名单数字种类且不记录具体数字', async () => {
  const warnings = [];
  const client = createDeepSeekClient({
    apiKey: 'secret-key',
    logger: {
      warn(event, details) {
        warnings.push({ event, details });
      },
    },
    fetchImpl: async () => okModelResponse('{"value":"invalid"}'),
  });

  await assert.rejects(
    () => client.complete({
      messages: [{ role: 'user', content: 'private employee text' }],
      validate: () => false,
      diagnose: () => ['UNSUPPORTED_NUMBER'],
      diagnoseDetails: () => ({
        numberKinds: ['arabic:分钟', 'invalid:15分钟', 'private employee text'],
      }),
      buildRetryMessage: (issues) => `PLAN_CONTRACT_REPAIR\n${issues.join('\n')}`,
    }),
    { code: 'INVALID_MODEL_RESPONSE' },
  );

  assert.deepEqual(warnings, [
    {
      event: 'MODEL_RESPONSE_REJECTED',
      details: {
        attempt: 1,
        issues: ['UNSUPPORTED_NUMBER'],
        numberKinds: ['arabic:分钟'],
      },
    },
    {
      event: 'MODEL_RESPONSE_REJECTED',
      details: {
        attempt: 2,
        issues: ['UNSUPPORTED_NUMBER'],
        numberKinds: ['arabic:分钟'],
      },
    },
  ]);
  assert.doesNotMatch(
    JSON.stringify(warnings),
    /secret-key|private employee text|15分钟/,
  );
});
```

- [x] **Step 3: 运行两组测试并确认红灯**

```powershell
node --test --test-name-pattern "数字诊断只返回书写形式和单位" tests/server.fact-boundary.test.js
node --test --test-name-pattern "模型拒绝日志只接受白名单数字种类" tests/server.routes.test.js
```

Expected：FAIL；当前没有 `findFactBoundaryDiagnostics` 和 `diagnoseDetails`。

- [x] **Step 4: 在事实边界层生成安全数字种类**

增加：

```js
const NUMBER_UNIT_PATTERN = /(次|天|周|月|年|小时|分钟|人|项|个|分|元|周期)$/;

function describeNumberKind(token) {
  const value = compact(token);
  const style = /^\d/.test(value) ? 'arabic' : 'chinese';
  if (value.endsWith('%') || value.startsWith('百分之')) return `${style}:percent`;
  const unit = NUMBER_UNIT_PATTERN.exec(value)?.[1];
  return unit ? `${style}:${unit}` : null;
}
```

将现有主体整理为 `findFactBoundaryDiagnostics`：

```js
function findFactBoundaryDiagnostics({ source, generated } = {}) {
  const sourceText = compact(collectStrings(source).join(' '));
  const generatedText = collectStrings(generated).join(' ');
  const issues = [];
  const missingNumbers = missingTokens(
    NUMBER_PATTERN,
    generatedText,
    sourceText,
    normalizeNumberToken,
  );

  if (missingTokens(DATE_PATTERN, generatedText, sourceText).length > 0) {
    issues.push(FACT_BOUNDARY_CODES.UNSUPPORTED_DATE);
  }
  if (missingNumbers.length > 0) {
    issues.push(FACT_BOUNDARY_CODES.UNSUPPORTED_NUMBER);
  }
  if (missingTokens(PERSON_PATTERN, generatedText, sourceText).length > 0) {
    issues.push(FACT_BOUNDARY_CODES.UNSUPPORTED_PERSON);
  }

  const sentences = generatedText.split(/[。！？!?；;\r\n]+/).filter(Boolean);
  const unsupported = (pattern) => sentences.some((sentence) => (
    pattern.test(sentence)
    && !UNCERTAIN_PATTERN.test(sentence)
    && !sourceText.includes(compact(sentence.replace(STRUCTURED_LABEL_PATTERN, '')))
  ));

  if (unsupported(RESULT_PATTERN)) issues.push(FACT_BOUNDARY_CODES.UNSUPPORTED_RESULT);
  if (unsupported(CAUSALITY_PATTERN)) issues.push(FACT_BOUNDARY_CODES.UNSUPPORTED_CAUSALITY);

  return {
    issues,
    numberKinds: [...new Set(missingNumbers.map(describeNumberKind).filter(Boolean))].slice(0, 5),
  };
}

function findFactBoundaryIssues(options) {
  return findFactBoundaryDiagnostics(options).issues;
}
```

导出：

```js
module.exports = {
  FACT_BOUNDARY_CODES,
  findFactBoundaryDiagnostics,
  findFactBoundaryIssues,
};
```

- [x] **Step 5: 在 DeepSeek 客户端白名单过滤诊断详情**

在 `SAFE_DIAGNOSTIC_CODES` 后增加：

```js
const SAFE_NUMBER_KIND_PATTERN = /^(?:arabic|chinese):(?:percent|次|天|周|月|年|小时|分钟|人|项|个|分|元|周期)$/;

function safeDiagnosticDetails(details) {
  const numberKinds = Array.isArray(details?.numberKinds)
    ? [...new Set(details.numberKinds
      .filter((value) => typeof value === 'string' && SAFE_NUMBER_KIND_PATTERN.test(value)))]
      .slice(0, 5)
    : [];
  return numberKinds.length > 0 ? { numberKinds } : {};
}
```

将日志函数改为：

```js
function reportValidationFailure(logger, attempt, issues, details = {}) {
  if (!logger || typeof logger.warn !== 'function') return;
  logger.warn('MODEL_RESPONSE_REJECTED', {
    attempt: attempt + 1,
    issues: issues.length > 0 ? issues : ['UNDIAGNOSED_MODEL_RESPONSE'],
    ...safeDiagnosticDetails(details),
  });
}
```

给 `complete` 参数增加 `diagnoseDetails`，并在 `validate(parsed)` 失败分支调用：

```js
const details = typeof diagnoseDetails === 'function'
  ? diagnoseDetails(parsed)
  : {};
reportValidationFailure(logger, attempt, issues, details);
```

原有调用没有 `diagnoseDetails` 时，日志结构保持不变。

- [x] **Step 6: 把安全数字种类从服务层传入客户端**

在 `server/coach-service.js` import `findFactBoundaryDiagnostics`，并让事实感知校验返回两个独立回调：

```js
function createFactAwareValidation({ baseValidate, source, selectGenerated }) {
  const inspect = (payload) => {
    if (!baseValidate(payload)) return { issues: [], numberKinds: [] };
    return findFactBoundaryDiagnostics({
      source,
      generated: selectGenerated(payload),
    });
  };
  const diagnose = (payload) => inspect(payload).issues;

  return {
    diagnose,
    diagnoseDetails: (payload) => ({ numberKinds: inspect(payload).numberKinds }),
    validate: (payload) => baseValidate(payload) && diagnose(payload).length === 0,
  };
}
```

步骤 1、2、4 将 `diagnoseDetails` 与 `diagnose` 一起传给 `completeStep`。

步骤 3 使用同一个 inspection（检查）结果组合方案契约与事实边界：

```js
const inspectPlan = (payload) => {
  const factDiagnostics = findFactBoundaryDiagnostics({ source, generated: payload });
  return {
    issues: [
      ...findPlanValidationIssues(payload, { typeId }),
      ...factDiagnostics.issues,
    ],
    numberKinds: factDiagnostics.numberKinds,
  };
};
const diagnose = (payload) => inspectPlan(payload).issues;
const diagnoseDetails = (payload) => ({
  numberKinds: inspectPlan(payload).numberKinds,
});
```

在步骤 3 的 `completeStep` options 中同时传入：

```js
{
  diagnose,
  diagnoseDetails,
  buildRetryMessage: buildPlanRetryMessage,
}
```

- [x] **Step 7: 运行安全日志与既有稳定诊断测试**

```powershell
node --test --test-name-pattern "数字诊断只返回书写形式和单位|稳定错误码不包含模型原文" tests/server.fact-boundary.test.js
node --test --test-name-pattern "模型拒绝日志只接受白名单数字种类|DeepSeek 客户端为两次语义拒绝只记录稳定诊断码|默认入口把两次模型拒绝的安全诊断" tests/server.routes.test.js
```

Expected：全部 PASS；日志可出现 `numberKinds`，但不包含具体数字、完整模型响应、员工文本或 API Key。

- [x] **Step 8: 检查并提交 Task 3**

```powershell
git diff --check -- server/fact-boundary.js server/coach-service.js server/deepseek-client.js tests/server.fact-boundary.test.js tests/server.routes.test.js
git diff -- server/fact-boundary.js server/coach-service.js server/deepseek-client.js tests/server.fact-boundary.test.js tests/server.routes.test.js
git add -- server/fact-boundary.js server/coach-service.js server/deepseek-client.js tests/server.fact-boundary.test.js tests/server.routes.test.js
git diff --cached --check
git commit -m "feat: add safe number rejection diagnostics"
```

---

### Task 4: 全量回归与计划收尾

**Files:**
- Modify: `docs/agent-plans/2026-07-22-coach-assistant-number-fact-boundary-minimal-repair-plan.md`

- [x] **Step 1: 运行服务端聚焦回归**

```powershell
node --test tests/server.fact-boundary.test.js
node --test tests/server.coaching-methods.test.js
node --test tests/server.contracts.test.js
node --test tests/server.routes.test.js
```

Expected：全部 PASS；数字等价、严格事实边界、GROW/SBI、唯一重试、温度和安全日志均无回归。

- [x] **Step 2: 运行项目全量测试**

```powershell
npm.cmd test
```

Expected：服务端与 Playwright 全部通过；所有接口使用 fake client/fake fetch，不调用真实 DeepSeek。

- [x] **Step 3: 完成 fixture 验收**

确认自动化覆盖：

- `一次` 与 `1次`、`两个` 与 `2个`、`四周` 与 `4周` 不再误判；
- 来源中没有 `15分钟` 时仍拒绝该新数字；
- 没有数字来源时，步骤 3 提示词与纠错消息要求定性频率；
- B 类 GROW/SBI 继续严格校验；
- 人物、结果、影响、因果、日期和真正的新数字继续被拒绝；
- 每次方案请求最多两次模型调用；
- 日志没有具体数值、员工文本、模型原文或 API Key；
- 两次无效时仍返回现有 `INVALID_MODEL_RESPONSE` 安全错误。

真实服务器测试会调用付费模型，不属于本计划自动化执行范围；如需上线后验证，必须由用户另行明确授权。

- [x] **Step 4: 审计范围和用户改动**

```powershell
git diff --check
git status --short
git diff HEAD -- server/fact-boundary.js server/coach-service.js server/deepseek-client.js prompts/system.md tests/server.fact-boundary.test.js tests/server.routes.test.js
git log --oneline -12
```

Expected：

- 没有 `frontend/`、契约、知识库、依赖、部署配置或 `.env` 改动；
- 用户未跟踪文档、`.playwright-cli/`、`output/` 和 `playwright.reuse-existing.config.js` 原样保留且未暂存；
- 本计划业务代码和测试已经按 Task 分提交。

- [x] **Step 5: 更新复选框并单独提交计划文档**

只有对应验证已有实际证据时才改为 `[x]`，然后执行：

```powershell
git add -- docs/agent-plans/2026-07-22-coach-assistant-number-fact-boundary-minimal-repair-plan.md
git diff --cached --check
git commit -m "docs: record number fact boundary repair"
git status --short
```

不得暂存整个 `docs/agent-plans/` 目录，不要 push。

---

## 完成标准

- 中文数字与阿拉伯数字的等价数量表达共享同一事实来源。
- 真正未提供的次数、时长、比例和数量继续被拒绝。
- 没有数字来源时，方案频率使用定性节奏而不是新增数字。
- 日期、人物、结果、影响和因果边界没有放宽。
- GROW/SBI、占位内容、temperature、唯一重试和安全错误边界没有改变。
- 运行日志最多记录 5 个数字书写形式与单位，不记录具体数值或上下文。
- 服务端聚焦测试、`npm.cmd test` 与 `git diff --check` 全部通过。
- 没有真实 DeepSeek 调用、依赖更新、前端改动或部署操作。
