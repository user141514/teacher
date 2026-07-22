# Coach Assistant Desktop Fact Boundary and Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在仅新增桌面端验收的前提下，完成产品名称回归、模型事实边界方案二、第二步内部信息隐藏和第三步标准列表紫色圆点展示。

**Architecture:** 保留现有四步接口、Ajv 契约和 DeepSeek 唯一一次重试。新增独立的高置信度事实边界诊断模块，用稳定错误码识别模型输出中无输入依据的日期、数字、人物、既成结果和因果断言；提示词负责区分事实、分析和建议，服务层负责把诊断接入步骤 1–4 的现有校验与纠错路径。前端只删除第二步内部信息行的 DOM，并用限定在方案页标准无序列表的 CSS `::marker` 设置紫色圆点。

**Tech Stack:** Node.js 20、CommonJS、Express、Ajv、DeepSeek Chat Completions、Vanilla JavaScript、Markdown-it、Playwright、Node.js built-in test runner

---

## 已确认范围

本计划以 `docs/agent-plans/2026-07-21-coach-assistant-requirements-draft.md` 和 2026-07-22 的确认结果为依据：

1. 只新增桌面端验收，不新增本轮移动端适配任务；已有移动端回归不得被删除或禁用。
2. 需求 1、2、4、5 进入本轮。
3. 需求 2 采用方案二：提示词强化、服务端校验、复用现有唯一一次纠错重试。
4. 需求 3“登录和历史记录”完全排除，不创建登录、数据库、持久化、权限或历史接口。
5. 紫色圆点只作用于第三步标准无序列表，不作用于普通段落、卡片标题、独立说明、GROW/SBI 阶段标签或有序列表。

## 当前实现事实

- `frontend/index.html` 已把浏览器标题和顶部品牌名称改为“管理团队-教练助手”。
- `tests/frontend.spec.js` 当前有用户未提交的两条品牌断言；执行前必须先检查差异，只能在确认仍是这两条断言时把它们纳入需求 1 提交。
- 步骤 3 已有严格 GROW/SBI、占位词诊断和固定纠错消息，但尚未通用检查无依据日期、数字、人物、结果与因果断言。
- `server/deepseek-client.js` 已支持 `diagnose` 与 `buildRetryMessage`，总尝试次数固定为两次，不得增加。
- 第二步仍由 `frontend/views.js` 创建 `.classification-meta`，展示判定状态、判断可信度、能力、意愿、用人策略和教练模式。
- 第三步数组内容经 `renderMarkdown` 生成标准 `<ul><li>`；安全 Markdown 渲染边界保持不变。

## 文件职责与范围

- Create: `server/fact-boundary.js`：纯函数提取文本、比较用户事实源、返回稳定事实边界诊断码。
- Create: `tests/server.fact-boundary.test.js`：覆盖日期、数字、人物、结果、因果、待确认表达和已知事实复用。
- Modify: `server/coach-service.js`：把事实诊断接入步骤 1–4 与现有一次纠错重试。
- Modify: `prompts/system.md`：明确事实、分析、建议三种表达边界。
- Modify: `tests/server.routes.test.js`：覆盖提示词、四步服务接入、纠错内容与两次失败安全边界。
- Modify: `frontend/views.js`：不再创建第二步内部信息行。
- Modify: `frontend/styles.css`：删除废弃信息行样式，增加方案页标准列表紫色 marker。
- Modify: `tests/frontend.spec.js`：固化品牌、隐藏信息行和标准列表 marker 的桌面端回归。
- Modify: `docs/agent-plans/2026-07-22-coach-assistant-desktop-fact-boundary-and-display-implementation-plan.md`：验证后更新复选框。

明确不修改：

- `frontend/state.js`、`frontend/app.js`、API 请求格式、Ajv JSON schema、知识库、DeepSeek 模型名称、依赖和部署配置；
- 登录、历史记录、数据库、权限、浏览器持久化和跨会话记忆；
- GROW/SBI 标签、用户最终画像选择、返回上一步、返回首页和反馈保留逻辑；
- Markdown 渲染器及其安全清洗逻辑；
- 现有重试次数和统一安全错误响应。

---

### Task 1: 固化已完成的产品名称回归

**Files:**
- Test: `frontend/index.html`
- Modify: `tests/frontend.spec.js:134-142`
- Test: `tests/server.routes.test.js:336-350`

- [x] **Step 1: 检查并确认现有未提交品牌测试差异**

Run:

```powershell
git diff -- tests/frontend.spec.js
```

Expected: 品牌相关差异仅为以下两条断言；若同一区域存在其他用户改动，停止并先拆分提交范围。

```js
await expect(page).toHaveTitle('管理团队-教练助手');
await expect(page.locator('.brand-name')).toHaveText('管理团队-教练助手');
```

- [x] **Step 2: 运行品牌聚焦测试**

```powershell
npx.cmd playwright test tests/frontend.spec.js --grep "桌面欢迎页在固定视口对齐参考品牌"
node --test --test-name-pattern="同源进程仅让 HTML 响应不可缓存" tests/server.routes.test.js
```

Expected: 两条命令均通过；生产页面无需再次修改。

- [x] **Step 3: 只提交品牌回归断言**

```powershell
git diff --check -- tests/frontend.spec.js
git add -- tests/frontend.spec.js
git diff --cached -- tests/frontend.spec.js
git commit -m "test: preserve coach assistant branding"
```

不得暂存 `.playwright-cli/`、`playwright.reuse-existing.config.js`、其他文档或 `output/`。

---

### Task 2: 建立独立的事实边界诊断模块

**Files:**
- Create: `tests/server.fact-boundary.test.js`
- Create: `server/fact-boundary.js`

- [x] **Step 1: 先写事实边界失败测试**

创建 `tests/server.fact-boundary.test.js`：

```js
const assert = require('node:assert/strict');
const test = require('node:test');
const {
  FACT_BOUNDARY_CODES,
  findFactBoundaryIssues,
} = require('../server/fact-boundary.js');

test('拒绝事实源中不存在的日期数字人物结果与因果断言', () => {
  const issues = findFactBoundaryIssues({
    source: {
      goal: '提升主动同步意识',
      pain: '员工通常需要主管提醒，实际影响尚未说明',
    },
    generated: {
      reason: '张经理指出员工在2026年7月15日导致项目进度下降30%，并且已连续三次完成整改。',
    },
  });

  assert.deepEqual(issues, [
    FACT_BOUNDARY_CODES.UNSUPPORTED_DATE,
    FACT_BOUNDARY_CODES.UNSUPPORTED_NUMBER,
    FACT_BOUNDARY_CODES.UNSUPPORTED_PERSON,
    FACT_BOUNDARY_CODES.UNSUPPORTED_RESULT,
    FACT_BOUNDARY_CODES.UNSUPPORTED_CAUSALITY,
  ]);
});

test('接受输入中已有的具体事实以及明确待确认或可能性表达', () => {
  const knownSentence = '张经理指出延期导致客户复核增加。';
  const source = {
    note: `${knownSentence} 复盘日期为2026年7月15日，返工比例为30%。`,
  };

  assert.deepEqual(findFactBoundaryIssues({
    source,
    generated: {
      evidence: [knownSentence, '复盘日期为2026年7月15日，返工比例为30%。'],
      impact: '需补充该行为造成的具体影响。',
      analysis: '根据现有信息判断，该行为可能导致协作风险，具体结果待确认。',
    },
  }), []);
});

test('稳定错误码不包含模型原文或用户事实', () => {
  const issues = findFactBoundaryIssues({
    source: { goal: '提升协作' },
    generated: { result: '2026年8月1日已经提升50%。' },
  });

  assert.equal(issues.every((code) => Object.values(FACT_BOUNDARY_CODES).includes(code)), true);
  assert.equal(issues.some((code) => code.includes('2026') || code.includes('提升协作')), false);
});
```

- [x] **Step 2: 运行测试并确认红灯**

```powershell
node --test tests/server.fact-boundary.test.js
```

Expected: FAIL，原因是 `server/fact-boundary.js` 尚不存在。

- [x] **Step 3: 实现高置信度、固定顺序的诊断器**

创建 `server/fact-boundary.js`。实现必须满足以下接口和规则：

```js
const FACT_BOUNDARY_CODES = Object.freeze({
  UNSUPPORTED_DATE: 'UNSUPPORTED_DATE',
  UNSUPPORTED_NUMBER: 'UNSUPPORTED_NUMBER',
  UNSUPPORTED_PERSON: 'UNSUPPORTED_PERSON',
  UNSUPPORTED_RESULT: 'UNSUPPORTED_RESULT',
  UNSUPPORTED_CAUSALITY: 'UNSUPPORTED_CAUSALITY',
});

const DATE_PATTERN = /(?:20\d{2}[年./-]\d{1,2}(?:[月./-]\d{1,2}日?)?|\d{1,2}月\d{1,2}日)/g;
const NUMBER_PATTERN = /(?:\d+(?:\.\d+)?(?:%|次|天|周|月|年|小时|分钟|人|项|个|分|元|周期)|百分之[零一二两三四五六七八九十百千万]+|[零一二两三四五六七八九十百千万]+(?:次|天|周|月|年|小时|分钟|人|项|个|分|元|周期))/g;
const SURNAME = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜谢邹苏潘葛范彭鲁韦马方任袁唐罗薛伍余姚孟顾尹江钟';
const PERSON_PATTERN = new RegExp(
  `(?:[${SURNAME}][\\u4e00-\\u9fff]{0,2}(?:经理|主管|总监|先生|女士|老师)|[${SURNAME}][\\u4e00-\\u9fff]{1,2}(?=表示|指出|认为|负责|完成|导致))`,
  'g',
);
const RESULT_PATTERN = /(?:已经|已)(?:[^。！？!?；;\r\n]{0,8})?(?:完成|提升|下降|改善|达成|解决|延期|延误)|(?:完成了|提升了|下降了|改善了|达成了|解决了|同步了|交付了|通过了|结果为|实际影响为)/;
const CAUSALITY_PATTERN = /(?:导致|造成|使得|因此|所以|从而)/;
const UNCERTAIN_PATTERN = /(?:可能|预计|假设|如果|若|建议|可以|可考虑|需补充|待确认|尚不确定|尚未确认)/;

function collectStrings(value) {
  const values = [];
  const stack = [value];
  const seen = new Set();
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === 'string') {
      values.push(current);
    } else if (Array.isArray(current)) {
      stack.push(...current);
    } else if (current && typeof current === 'object' && !seen.has(current)) {
      seen.add(current);
      stack.push(...Object.values(current));
    }
  }
  return values;
}

function compact(value) {
  return String(value || '').replace(/\s+/g, '');
}

function missingTokens(pattern, generatedText, sourceText) {
  const tokens = [...new Set(generatedText.match(pattern) || [])];
  return tokens.filter((token) => !sourceText.includes(compact(token)));
}

function findFactBoundaryIssues({ source, generated } = {}) {
  const sourceText = compact(collectStrings(source).join(' '));
  const generatedText = collectStrings(generated).join(' ');
  const issues = [];

  if (missingTokens(DATE_PATTERN, generatedText, sourceText).length > 0) {
    issues.push(FACT_BOUNDARY_CODES.UNSUPPORTED_DATE);
  }
  if (missingTokens(NUMBER_PATTERN, generatedText, sourceText).length > 0) {
    issues.push(FACT_BOUNDARY_CODES.UNSUPPORTED_NUMBER);
  }
  if (missingTokens(PERSON_PATTERN, generatedText, sourceText).length > 0) {
    issues.push(FACT_BOUNDARY_CODES.UNSUPPORTED_PERSON);
  }

  const sentences = generatedText.split(/[。！？!?；;\r\n]+/).filter(Boolean);
  const unsupported = (pattern) => sentences.some((sentence) => (
    pattern.test(sentence)
    && !UNCERTAIN_PATTERN.test(sentence)
    && !sourceText.includes(compact(sentence))
  ));

  if (unsupported(RESULT_PATTERN)) issues.push(FACT_BOUNDARY_CODES.UNSUPPORTED_RESULT);
  if (unsupported(CAUSALITY_PATTERN)) issues.push(FACT_BOUNDARY_CODES.UNSUPPORTED_CAUSALITY);
  return issues;
}

module.exports = { FACT_BOUNDARY_CODES, findFactBoundaryIssues };
```

诊断器只处理高置信度表面模式，不把原始文本写入错误码或日志。日期、数字和人物即使出现在建议中，也必须来自当前会话事实源；结果和因果表达只有在原句已存在于事实源，或明确使用“可能、需补充、待确认”等非既成事实表达时才通过。

- [x] **Step 4: 运行聚焦测试并确认绿灯**

```powershell
node --test tests/server.fact-boundary.test.js
```

Expected: 3 tests passed。

- [x] **Step 5: 检查并提交 Task 2**

```powershell
git diff --check -- server/fact-boundary.js tests/server.fact-boundary.test.js
git add -- server/fact-boundary.js tests/server.fact-boundary.test.js
git commit -m "feat: diagnose unsupported model facts"
```

---

### Task 3: 强化四步提示词中的事实、分析和建议边界

**Files:**
- Modify: `tests/server.routes.test.js`
- Modify: `prompts/system.md`

- [x] **Step 1: 先增加提示词失败断言**

在现有 `提示词加载器读取对应步骤并把用户输入编码为 JSON 数据` 测试中，先增加步骤 1 消息，再对四个 system message 增加以下断言：

```js
const intakeMessages = loader.buildMessages(1, payload);
const stepPrompts = [
  intakeMessages[0].content,
  messages[0].content,
  planMessages[0].content,
  feedbackMessages[0].content,
];

for (const prompt of stepPrompts) {
  assert.match(prompt, /用户明确提供的事实/);
  assert.match(prompt, /分析或判断.*根据.*判断|根据.*判断.*分析或判断/s);
  assert.match(prompt, /建议.*建议.*可以.*可考虑/s);
  assert.match(prompt, /日期、数字、人物、行为、结果、影响和因果关系/);
  assert.match(prompt, /需补充|待确认/);
}
assert.match(planMessages[0].content, /首次生成和重新生成.*相同事实边界/);
assert.doesNotMatch(planMessages[0].content, /提出两个可选动作/);
assert.match(feedbackMessages[0].content, /建议必须表达为未来行动/);
```

- [x] **Step 2: 运行提示词聚焦测试并确认红灯**

```powershell
node --test --test-name-pattern="提示词加载器读取对应步骤" tests/server.routes.test.js
```

Expected: FAIL，当前提示词虽禁止臆造，但没有完整三分法和统一具体对象列表。

- [x] **Step 3: 在全局硬约束中加入统一三分法**

在 `prompts/system.md` 的全局规则中加入，并在四步各自约束中保留对应提醒：

```markdown
【事实边界】
- 用户明确提供的事实：只能复述当前输入、补充回答和已通过校验的会话内内容，不得新增未经提供或确认的日期、数字、人物、行为、结果、影响和因果关系。
- 分析或判断：必须使用“根据已提供信息判断”“可能”“倾向于”“仍需确认”等能够体现判断性质的表达，不得写成已经发生的事实。
- 后续建议：必须使用“建议”“可以”“可考虑”等表达，并写成尚未执行的未来行动，不得表述为已经完成。
- 信息不足时明确写“需补充”或“待确认”；允许写“需补充该行为造成的具体影响”，不得为了补齐 GROW/SBI 编造事实。
```

步骤 3 额外写明：“首次生成和重新生成遵守相同事实边界”；把模板中的“提出两个可选动作”改为“提出可选动作”，避免提示词主动引入用户未提供的数量。步骤 4 写明：“建议必须表达为未来行动”。不得放宽现有 GROW/SBI、画像映射、高风险拦截和 JSON-only 规则。

- [x] **Step 4: 运行提示词测试并确认绿灯**

```powershell
node --test --test-name-pattern="提示词加载器读取对应步骤" tests/server.routes.test.js
```

Expected: 聚焦测试通过。

- [x] **Step 5: 检查并提交 Task 3**

```powershell
git diff --check -- prompts/system.md tests/server.routes.test.js
git add -- prompts/system.md tests/server.routes.test.js
git commit -m "fix: clarify model fact boundaries"
```

---

### Task 4: 把事实诊断接入四步现有一次纠错重试

**Files:**
- Modify: `tests/server.routes.test.js`
- Modify: `server/coach-service.js`

- [x] **Step 1: 增加四步服务层失败测试**

使用现有 fake client 记录 `client.complete` 参数，分别调用 intake、classify、plan 和 feedback，断言每一步都传入事实感知的 `validate`、`diagnose` 和 `buildRetryMessage`：

```js
test('四步都用当前会话事实源校验模型输出并提供固定纠错消息', async () => {
  const calls = [];
  const expectedIntake = intakeResult();
  expectedIntake.normalized_profile.coaching_history = '每两周复盘一次。';
  expectedIntake.normalized_profile.goal = '本周主动完成一次跨部门风险同步，并在周五复盘。';
  const client = {
    complete: async (options) => {
      calls.push(options);
      if (calls.length === 1) return expectedIntake;
      if (calls.length === 2) return modelClassificationResult();
      if (calls.length === 3) return planResult();
      return feedbackResult();
    },
  };
  const service = createCoachService({ promptLoader: createTestPromptLoader(), client });
  const intake = {
    intake: { ...expectedIntake.normalized_profile },
    answers: {},
  };
  const intakeResponse = await service.intake(intake);
  const classification = await service.classify({
    normalizedProfile: intakeResponse.normalized_profile,
  });
  const plan = await service.plan({
    classification,
    normalizedProfile: intakeResponse.normalized_profile,
    pain: intakeResponse.normalized_profile.pain,
    regenerate: false,
    previousPlan: null,
  });
  await service.feedback({
    classification,
    planSummary: JSON.stringify(plan),
    feedbackText: '员工在周五主动同步了风险，团队提前安排了支持。',
  });

  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.equal(typeof call.validate, 'function');
    assert.equal(typeof call.diagnose, 'function');
    assert.equal(typeof call.buildRetryMessage, 'function');
  }
});
```

- [x] **Step 2: 增加纠错内容和安全失败测试**

扩展现有 DeepSeek fake fetch 测试：第一次返回包含无依据 `2026年8月1日`、`50%`、`张经理` 和“导致/已经完成”的 JSON，第二次返回合法响应。断言：

```js
assert.equal(requestBodies.length, 2);
const correction = requestBodies[1].messages.at(-1).content;
assert.match(correction, /MODEL_FACT_BOUNDARY_REPAIR/);
assert.match(correction, /UNSUPPORTED_DATE/);
assert.match(correction, /UNSUPPORTED_NUMBER/);
assert.match(correction, /UNSUPPORTED_PERSON/);
assert.match(correction, /UNSUPPORTED_RESULT/);
assert.match(correction, /UNSUPPORTED_CAUSALITY/);
assert.doesNotMatch(correction, /2026年8月1日|50%|张经理/);
```

再让两次都返回无依据内容，断言仍抛出 `{ code: 'INVALID_MODEL_RESPONSE' }`，总请求数严格为 2。

- [x] **Step 3: 运行服务层聚焦测试并确认红灯**

```powershell
node --test --test-name-pattern="四步都用当前会话事实源|MODEL_FACT_BOUNDARY_REPAIR|事实边界" tests/server.routes.test.js
```

Expected: FAIL，当前只有步骤 3 传入方案契约诊断器，其他步骤没有事实诊断。

- [x] **Step 4: 增加固定纠错映射和事实感知校验 helper**

在 `server/coach-service.js` 导入：

```js
const {
  FACT_BOUNDARY_CODES,
  findFactBoundaryIssues,
} = require('./fact-boundary.js');
```

增加固定映射，不拼接用户输入或模型原文：

```js
const FACT_RETRY_GUIDANCE = Object.freeze({
  [FACT_BOUNDARY_CODES.UNSUPPORTED_DATE]: '删除事实源中不存在的具体日期；如确需日期，明确要求用户补充。',
  [FACT_BOUNDARY_CODES.UNSUPPORTED_NUMBER]: '删除事实源中不存在的具体数字、比例或数量。',
  [FACT_BOUNDARY_CODES.UNSUPPORTED_PERSON]: '删除事实源中不存在的人名或带姓名的角色。',
  [FACT_BOUNDARY_CODES.UNSUPPORTED_RESULT]: '不得把未经确认的结果写成已完成或已发生；改为需补充或待确认。',
  [FACT_BOUNDARY_CODES.UNSUPPORTED_CAUSALITY]: '不得断言未经提供的因果关系；只能写可能性并标注待确认。',
});

function buildFactBoundaryRetryMessage(issues) {
  const guidance = [...new Set(issues)]
    .map((code) => ({ code, guidance: FACT_RETRY_GUIDANCE[code] }))
    .filter((item) => item.guidance);
  if (guidance.length === 0) return '';
  return [
    'MODEL_FACT_BOUNDARY_REPAIR',
    '上一输出包含未被当前会话事实支持的内容。请仅重新输出完整 JSON，不要解释。',
    ...guidance.map(({ code, guidance: text }) => `- ${code}: ${text}`),
    '- 不得复制上一输出中的无依据内容。',
  ].join('\n');
}

function createFactAwareValidation({ baseValidate, source, selectGenerated }) {
  const diagnose = (payload) => {
    if (!baseValidate(payload)) return [];
    return findFactBoundaryIssues({
      source,
      generated: selectGenerated(payload),
    });
  };
  return {
    diagnose,
    validate: (payload) => baseValidate(payload) && diagnose(payload).length === 0,
  };
}
```

- [x] **Step 5: 按步骤提供准确事实源**

在四个 service 方法中使用以下边界：

```js
// Step 1: 只把 normalized_profile 当作模型生成的事实内容。
source = { intake: request.intake, answers: request.answers || {} };
selectGenerated = (payload) => payload && payload.normalized_profile;

// Step 2: strategy/coach_mode 是知识库映射，不做事实 token 检查。
source = request.normalizedProfile;
selectGenerated = (payload) => payload && ({ reason: payload.reason, evidence: payload.evidence });

// Step 3: 首次与重出使用相同边界；前版方案只有在已通过校验后才可进入 source。
source = {
  normalizedProfile: request.normalizedProfile,
  pain: request.pain,
  classificationReason: request.classification.reason,
  previousPlan: request.regenerate ? request.previousPlan : null,
};
selectGenerated = (payload) => payload;

// Step 4: 只信任已校验方案摘要、分类依据和本次反馈。
source = {
  classificationReason: request.classification.reason,
  planSummary: request.planSummary,
  feedbackText: request.feedbackText,
};
selectGenerated = (payload) => payload;
```

步骤 1、2、4 把 `diagnose` 和 `buildFactBoundaryRetryMessage` 作为 `completeStep` 第六个参数传入。步骤 3 的诊断结果必须合并：

```js
const diagnose = (payload) => [
  ...findPlanValidationIssues(payload, { typeId }),
  ...findFactBoundaryIssues({ source, generated: payload }),
];
const validate = (payload) => diagnose(payload).length === 0;
```

扩展现有 `buildPlanRetryMessage`，让它同时识别 `FACT_RETRY_GUIDANCE`；标题仍可保持 `PLAN_CONTRACT_REPAIR`，但必须包含对应事实错误码。不得修改 `server/deepseek-client.js` 的两次循环。

- [x] **Step 6: 对齐现有 fake fixture 的事实源，不降低校验规则**

在 `tests/server.routes.test.js` 中完成以下确定性调整：

1. 将共享 `intakeResult()` 的 `coaching_history` 改为“每两周复盘一次。”，`goal` 改为“本周主动完成一次跨部门风险同步，并在周五复盘。”，使默认 `planResult()` 中的具体频率和行动时间有会话来源。
2. 在“四步服务按 intake、classify、plan、feedback 顺序编排”测试中，把 intake 请求改为包含 `intakeResult().normalized_profile` 的全部字段；把反馈改为“员工在周五主动同步了风险，团队提前安排了支持。”，并同步更新 prompt payload 断言。
3. 在“feedback 仅在原始反馈非空时启用 SBI 语义校验”测试中，第一次使用上述完整反馈；第二次空反馈让 fake client 返回以下事实安全结果：

```js
const factSafeFeedback = feedbackResult({
  progress_read: '尚无新反馈，进展待确认。',
  next_steps: [
    '建议继续记录可观察行为。',
    '可考虑在获得反馈后再调整方案。',
  ],
  watch_points: ['需补充实际进展。'],
});
```

用 `factSafeFeedback` 作为 `withoutSbi`，继续断言非空反馈校验器返回 `false`、空反馈校验器返回 `true`，确保测试仍只验证 SBI 开关。

4. 在“模型生成的高风险方案或反馈被丢弃”测试中，把 feedback 请求的 `feedbackText` 改为空字符串，并把高风险 feedback fixture 改为：

```js
feedbackResult({
  progress_read: '建议解除劳动合同。',
  next_steps: ['建议转交 HR 审核。', '可考虑暂停当前辅导。'],
  watch_points: ['待确认合规边界。'],
})
```

这些调整只让 fake 输入与 fake 输出共享相同事实，不得通过给诊断器增加测试专用白名单来绕过校验。

- [x] **Step 7: 运行聚焦和既有契约测试**

```powershell
node --test tests/server.fact-boundary.test.js
node --test --test-name-pattern="四步都用当前会话事实源|模型语义响应无效|plan 用 type_id|事实边界" tests/server.routes.test.js
node --test tests/server.contracts.test.js
```

Expected: 三条命令均通过；现有 GROW/SBI、温度和安全错误测试继续通过。

- [x] **Step 8: 检查并提交 Task 4**

```powershell
git diff --check -- server/coach-service.js tests/server.routes.test.js
git add -- server/coach-service.js tests/server.routes.test.js
git commit -m "feat: retry unsupported model facts"
```

---

### Task 5: 隐藏第二步内部判定信息行

**Files:**
- Modify: `tests/frontend.spec.js`
- Modify: `frontend/views.js:678-693`
- Modify: `frontend/styles.css`

- [x] **Step 1: 先把现有可见断言改为隐藏断言**

将桌面类型判定测试中对 `.classification-meta` 的可见内容断言替换为：

```js
await expect(page.locator('.classification-meta')).toHaveCount(0);
for (const hiddenLabel of [
  '判定状态',
  '判断可信度',
  '能力：',
  '意愿：',
  '用人策略',
  '教练模式',
]) {
  await expect(page.locator('.panel[data-stage="classification"]'))
    .not.toContainText(hiddenLabel);
}
await expect(page.locator('.classification-reasoning')).toContainText('判定依据：');
await expect(page.locator('.classification-reasoning')).toContainText('员工已能独立交付复杂任务');
await expect(page.locator('.typegrid .tcard')).toHaveCount(4);
await expect(page.locator('#generate-plan')).toBeVisible();
```

把专用测试名称改为：`类型判定隐藏内部判定行但保留画像选择和具体依据`。继续使用桌面 viewport；不要新增移动端断言。

- [x] **Step 2: 运行聚焦测试并确认红灯**

```powershell
npx.cmd playwright test tests/frontend.spec.js --grep "桌面类型判定页|类型判定隐藏内部判定行"
```

Expected: FAIL，当前页面仍创建 `.classification-meta`。

- [x] **Step 3: 删除内部信息行 DOM，保留状态数据**

在 `frontend/views.js` 的 `renderClassification` 中删除以下展示构建逻辑：

```js
const meta = node('div', { className: 'classification-meta' });
const rows = [
  [CLASSIFICATION_LABELS.status, finalClassification.status],
  [CLASSIFICATION_LABELS.classification_confidence, classification.classification_confidence],
  [CLASSIFICATION_LABELS.ability, finalClassification.ability],
  [CLASSIFICATION_LABELS.will, finalClassification.will],
  [CLASSIFICATION_LABELS.strategy, finalClassification.strategy],
  [CLASSIFICATION_LABELS.coach_mode, finalClassification.coach_mode],
];
rows.forEach(([label, value]) => {
  const row = node('span', { className: 'classification-meta-item' });
  row.append(node('strong', { text: `${label}：` }), document.createTextNode(value || '未提供'));
  meta.append(row);
});
details.append(meta);
```

不得删除 `state.classification` 字段、`finalClassification`、画像改选、判定依据、证据、待确认问题或生成方案按钮。同步删除 `frontend/styles.css` 中只服务于 `.classification-meta` 和 `.classification-meta-item` 的样式。

- [x] **Step 4: 运行聚焦测试并确认绿灯**

```powershell
npx.cmd playwright test tests/frontend.spec.js --grep "桌面类型判定页|类型判定隐藏内部判定行|生成方案使用用户最终选择的画像契约"
```

Expected: 聚焦测试全部通过，用户最终画像仍是步骤 3 唯一画像依据。

- [x] **Step 5: 检查并提交 Task 5**

```powershell
git diff --check -- frontend/views.js frontend/styles.css tests/frontend.spec.js
git add -- frontend/views.js frontend/styles.css tests/frontend.spec.js
git commit -m "feat: hide internal classification details"
```

---

### Task 6: 仅为第三步标准列表增加紫色圆点

**Files:**
- Modify: `tests/frontend.spec.js`
- Modify: `frontend/styles.css`
- Test only: `frontend/views.js`
- Test only: `frontend/markdown-renderer.js`

- [x] **Step 1: 增加桌面标准列表 marker 失败测试**

在方案页测试旁增加：

```js
test('桌面方案页仅为标准无序列表显示紫色圆点', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await advanceToPlan(page);

  const listItems = page.locator(
    '.panel[data-stage="plan"] .rcard .markdown-body ul > li',
  );
  await expect(listItems).not.toHaveCount(0);

  const markerStyles = await listItems.evaluateAll((items) => items.map((item) => ({
    listStyleType: getComputedStyle(item).listStyleType,
    markerColor: getComputedStyle(item, '::marker').color,
  })));
  expect(markerStyles.every(({ listStyleType }) => listStyleType === 'disc')).toBe(true);
  expect(markerStyles.every(({ markerColor }) => markerColor === 'rgb(108, 33, 109)')).toBe(true);

  await expect(page.locator('#plan-frequency')).toHaveCount(1);
  await expect(page.locator('#plan-frequency').locator('ul, li')).toHaveCount(0);
  await expect(page.locator('#plan-scripts li').first().locator('p')).not.toHaveCount(0);
});
```

最后一条确认 GROW/SBI 阶段仍作为列表条目内部段落展示，没有为每个阶段标签额外生成 `<li>`。

- [x] **Step 2: 运行聚焦测试并确认红灯**

```powershell
npx.cmd playwright test tests/frontend.spec.js --grep "桌面方案页仅为标准无序列表显示紫色圆点"
```

Expected: FAIL，当前标准 Markdown 列表 marker 没有被限定为产品紫色。

- [x] **Step 3: 增加限定到方案页无序列表的 CSS**

在 `frontend/styles.css` 中增加：

```css
.panel[data-stage="plan"] .rcard .markdown-body ul {
  padding-left: 1.4rem;
  list-style-type: disc;
}

.panel[data-stage="plan"] .rcard .markdown-body ul > li::marker {
  color: var(--purple);
}
```

不得使用通配伪元素给 `p`、标题或所有 Markdown 元素加圆点；不得修改 `renderMarkdown`、直接写 `innerHTML`，也不得给有序列表 `ol` 改成圆点。

- [x] **Step 4: 运行方案页聚焦测试并确认绿灯**

```powershell
npx.cmd playwright test tests/frontend.spec.js --grep "桌面方案页|标准无序列表|GROW 和 SBI 的每个阶段|Markdown 渲染会转义"
```

Expected: 紫色 marker、GROW/SBI 独立换行和 Markdown 安全测试全部通过。

- [x] **Step 5: 检查并提交 Task 6**

```powershell
git diff --check -- frontend/styles.css tests/frontend.spec.js
git add -- frontend/styles.css tests/frontend.spec.js
git commit -m "feat: style plan list markers"
```

---

### Task 7: 全量回归、边界验收与计划收尾

**Files:**
- Modify: `docs/agent-plans/2026-07-22-coach-assistant-desktop-fact-boundary-and-display-implementation-plan.md`

- [x] **Step 1: 运行服务端聚焦测试**

```powershell
node --test tests/server.fact-boundary.test.js
node --test tests/server.contracts.test.js
node --test tests/server.routes.test.js
```

Expected: 三条命令均 exit code `0`；测试全部使用 fake client / fake fetch，不产生真实 API 请求。

- [x] **Step 2: 运行前端和全量测试**

```powershell
npx.cmd playwright test tests/frontend.spec.js
npm.cmd test
```

Expected: 两条命令均 exit code `0`。本轮不新增移动端验收，但不能删除、跳过或破坏既有移动端测试。

- [x] **Step 3: 人工桌面端验收**

使用现有 fake API 或 Playwright fixture，在 1920×1080 桌面视口检查：

1. 浏览器标题和顶部品牌名称均为“管理团队-教练助手”。
2. 第二步不显示判定状态、判断可信度、能力、意愿、用人策略和教练模式。
3. 第二步仍显示四类画像、AI 推荐/最匹配、用户改选、判定依据和生成方案按钮。
4. 第三步标准无序列表每条只有一个紫色圆点；频率普通段落无圆点。
5. GROW/SBI 标签继续独立换行，但标签本身没有额外圆点。
6. 无依据日期、数字、人物、结果或因果响应第一次失败后触发固定纠错消息；第二次仍失败时不展示原始模型内容。

不得用真实 DeepSeek API 做人工验收。如执行者认为必须调用真实 API，必须停止并重新取得用户明确授权。

执行记录：使用现有 Playwright fixture 在桌面视口完成等价验收；品牌、四画像与改选、内部信息隐藏、等待态业务提示、标准无序列表紫色 marker、GROW/SBI 独立段落、Markdown 安全边界及事实纠错安全失败均由自动化测试覆盖。全量回归初次暴露计划中“数组已生成标准列表”的现状假设不成立；经用户授权扩大前端修复范围后，保留普通数组段落渲染，并用显式标准 Markdown 列表 fixture 验证 marker，不修改 `renderMarkdown`。

- [x] **Step 4: 检查提交范围和遗留用户文件**

```powershell
git diff --check
git status --short
git diff HEAD -- server/fact-boundary.js server/coach-service.js prompts/system.md frontend/views.js frontend/styles.css tests/server.fact-boundary.test.js tests/server.routes.test.js tests/frontend.spec.js
git log --oneline -12
```

Expected:

- 本计划代码和测试均已提交；
- `.env`、API Key、测试报告、缓存和无关文档未进入提交；
- `.playwright-cli/`、`playwright.reuse-existing.config.js`、`output/` 和其他用户文档仍被保留；
- 没有新增依赖、部署、数据库、登录、历史记录或移动端专项改动。

- [x] **Step 5: 验证后更新计划复选框并提交**

仅把已有命令证据的步骤改为 `- [x]`，然后执行：

```powershell
git add -- docs/agent-plans/2026-07-22-coach-assistant-desktop-fact-boundary-and-display-implementation-plan.md
git commit -m "docs: record desktop fact boundary implementation"
git status --short
```

不得使用 `git add .`，不得暂存整个 `docs/agent-plans/`。

---

## 完成标准

- 产品名称两个位置有自动化回归且均显示“管理团队-教练助手”。
- 步骤 1–4 的模型事实性文本都经过当前会话事实源校验。
- 无依据日期、数字、人物、既成结果和因果断言触发稳定错误码与现有唯一一次纠错重试。
- “需补充该行为造成的具体影响”、明确可能性和待确认表达继续允许。
- 两次仍无效时保持现有统一安全错误，不泄露模型原文、员工信息或内部诊断细节。
- 第二步内部判定信息行不进入 DOM，但服务端数据、前端状态和最终画像逻辑不变。
- 第三步只有标准无序列表条目显示紫色圆点，普通段落、标题、GROW/SBI 标签和有序列表不受影响。
- 不实施登录、历史记录、数据库、权限或跨会话记忆。
- 不新增移动端验收，既有移动端回归继续通过。
- 聚焦测试、`npm.cmd test` 和 `git diff --check` 全部通过。

## 剩余工程风险

方案二采用高置信度词法校验，目标是拦截明确的无依据硬事实并控制误判；它不能像“证据账本＋逐句引用”那样证明所有自然语言推断都有来源。若后续要求逐句可追溯或需要覆盖更隐晦的同义改写，应另立方案三需求，不在本轮扩大范围。
