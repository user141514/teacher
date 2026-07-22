const {
  PLAN_VALIDATION_CODES,
  findPlanValidationIssues,
  validateIntake,
  validateModelClassification,
  validateClassification,
  validateNormalizedProfile,
  validateFeedback,
} = require('./contracts.js');
const {
  FACT_BOUNDARY_CODES,
  findFactBoundaryIssues,
} = require('./fact-boundary.js');
const { findHighRiskIntent } = require('./guardrails.js');

const INVALID_REQUEST = Object.freeze({
  ok: false,
  code: 'INVALID_REQUEST',
  message: '请求无效，请检查后重试。',
});

const CLASSIFICATION_NOT_READY = Object.freeze({
  ok: false,
  code: 'CLASSIFICATION_NOT_READY',
  message: '类型尚未完成判定，请先补充或人工确认。',
});

function controlledError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function onlyHasKeys(value, allowedKeys) {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function isBoundedData(value, { maxTextLength = 2000 } = {}) {
  const stack = [value];
  const seen = new Set();

  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === 'string') {
      if (current.length > maxTextLength) {
        return false;
      }
      continue;
    }

    if (current === null || typeof current === 'boolean' || typeof current === 'number') {
      continue;
    }

    if (Array.isArray(current)) {
      if (current.length > 12 || seen.has(current)) {
        return false;
      }
      seen.add(current);
      stack.push(...current);
      continue;
    }

    if (!isPlainRecord(current) || seen.has(current)) {
      return false;
    }

    seen.add(current);
    const values = Object.values(current);
    if (values.length > 24) {
      return false;
    }
    stack.push(...values);
  }

  return true;
}

function isInvalidRequestResult(value) {
  return value && value.ok === false && value.code === 'INVALID_REQUEST';
}

function hasNonEmptyPreviousPlan(value) {
  if (!isBoundedData(value)) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return isPlainRecord(value) && Object.keys(value).length > 0;
}

const PLAN_RETRY_GUIDANCE = Object.freeze({
  [PLAN_VALIDATION_CODES.INVALID_SCHEMA]: '输出必须是且仅是包含 entry、cautions、frequency、gap_fix、scripts 的完整 JSON 对象，并满足既有字段类型与数组长度。',
  [PLAN_VALIDATION_CODES.INVALID_GROW]: 'scripts 必须恰好 2 条：第 1 条严格按 Goal（目标）→ Reality（现状），第 2 条严格按 Options（可选方案）→ Will（行动承诺），每段非空。',
  [PLAN_VALIDATION_CODES.MISSING_GAP_FIX_SBI]: 'gap_fix 至少一条必须严格按 Situation（情境）→ Behavior（行为）→ Impact（影响）且每段非空。',
  [PLAN_VALIDATION_CODES.MISSING_SCRIPT_SBI]: 'scripts 第 1 条必须在 Reality（现状）后加入完整 Situation（情境）→ Behavior（行为）→ Impact（影响）。',
  [PLAN_VALIDATION_CODES.PLACEHOLDER_CONTENT]: '删除所有占位内容，只能引用 normalized_profile 中的真实目标、行为、任务和时间；事实不足时明确说明需要补充。',
});

const FACT_RETRY_GUIDANCE = Object.freeze({
  [FACT_BOUNDARY_CODES.UNSUPPORTED_DATE]: '删除事实源中不存在的具体日期；如确需日期，明确要求用户补充。',
  [FACT_BOUNDARY_CODES.UNSUPPORTED_NUMBER]: '删除事实源中不存在的具体数字、比例或数量；frequency 和未来行动也不得新增数字。没有可复用的数字时，frequency 必须改为低频、中频、高频、持续跟进或按项目节点等定性节奏。',
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

function buildPlanRetryMessage(issues) {
  const guidance = [...new Set(issues)]
    .map((code) => ({
      code,
      guidance: PLAN_RETRY_GUIDANCE[code] || FACT_RETRY_GUIDANCE[code],
    }))
    .filter((item) => item.guidance);

  return [
    'PLAN_CONTRACT_REPAIR',
    '上一输出未通过严格方案契约。请重新生成完整 JSON，不要解释，不要使用 Markdown 代码围栏。',
    ...guidance.map(({ code, guidance: item }) => `- ${code}: ${item}`),
    '- 保留原始请求中的画像类型、策略、教练模式和 normalized_profile，不得改变分类结论。',
  ].join('\n');
}

function createCoachService({ promptLoader, client } = {}) {
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

  async function intake(request) {
    if (!isPlainRecord(request)
      || !onlyHasKeys(request, ['intake', 'answers'])
      || !isPlainRecord(request.intake)
      || (request.answers !== undefined && !isPlainRecord(request.answers))
      || !isBoundedData(request)) {
      return INVALID_REQUEST;
    }

    const payload = {
      intake: request.intake,
      answers: request.answers || {},
    };
    const { validate, diagnose } = createFactAwareValidation({
      baseValidate: validateIntake,
      source: payload,
      selectGenerated: (result) => result && result.normalized_profile,
    });

    return completeStep(1, payload, validate, 0.25, 900, {
      diagnose,
      buildRetryMessage: buildFactBoundaryRetryMessage,
    });
  }

  async function classify(request) {
    if (!isPlainRecord(request)
      || !onlyHasKeys(request, ['normalizedProfile'])
      || !validateNormalizedProfile(request.normalizedProfile)) {
      return INVALID_REQUEST;
    }

    const payload = {
      normalized_profile: request.normalizedProfile,
    };
    const { validate, diagnose } = createFactAwareValidation({
      baseValidate: validateModelClassification,
      source: request.normalizedProfile,
      selectGenerated: (result) => result && ({
        reason: result.reason,
        evidence: result.evidence,
      }),
    });
    const modelResult = await completeStep(2, payload, validate, 0.25, 900, {
      diagnose,
      buildRetryMessage: buildFactBoundaryRetryMessage,
    });
    const { confidence, ...classification } = modelResult;
    const applicationResult = {
      ...classification,
      classification_confidence: confidence,
    };

    if (!validateClassification(applicationResult)) {
      throw controlledError('INVALID_MODEL_RESPONSE');
    }

    return applicationResult;
  }

  async function plan(request) {
    if (!isPlainRecord(request)
      || !onlyHasKeys(request, ['classification', 'normalizedProfile', 'pain', 'regenerate', 'previousPlan'])
      || !isPlainRecord(request.classification)
      || !validateNormalizedProfile(request.normalizedProfile)
      || typeof request.pain !== 'string'
      || request.pain.length > 2000
      || !Object.hasOwn(request, 'regenerate')
      || typeof request.regenerate !== 'boolean'
      || !Object.hasOwn(request, 'previousPlan')
      || (request.regenerate === false && request.previousPlan !== null)
      || (request.regenerate === true && !hasNonEmptyPreviousPlan(request.previousPlan))) {
      return INVALID_REQUEST;
    }

    if (!validateClassification(request.classification)) {
      return INVALID_REQUEST;
    }

    if (request.classification.status !== '已判定') {
      return CLASSIFICATION_NOT_READY;
    }

    const typeId = request.classification.type_id;
    const requiresSbi = ['B', 'D2'].includes(typeId);
    const source = {
      normalizedProfile: request.normalizedProfile,
      pain: request.pain,
      classificationReason: request.classification.reason,
      previousPlan: request.regenerate ? request.previousPlan : null,
    };
    const diagnose = (payload) => [
      ...findPlanValidationIssues(payload, { typeId }),
      ...findFactBoundaryIssues({ source, generated: payload }),
    ];
    const validate = (payload) => diagnose(payload).length === 0;
    const temperature = request.regenerate ? 0.45 : 0.3;
    const result = await completeStep(3, {
      classification_status: request.classification.status,
      type_id: request.classification.type_id,
      strategy: request.classification.strategy,
      coach_mode: request.classification.coach_mode,
      classification_reason: request.classification.reason,
      normalized_profile: request.normalizedProfile,
      requires_sbi: requiresSbi,
      high_risk_personnel_action: false,
      pain: request.pain,
      regenerate: request.regenerate === true,
      previous_plan: request.previousPlan,
    }, validate, temperature, 1400, {
      diagnose,
      buildRetryMessage: buildPlanRetryMessage,
    });
    const highRiskIntent = findHighRiskIntent(result);

    return highRiskIntent ? { blocked: true, ...highRiskIntent } : result;
  }

  async function feedback(request) {
    if (!isPlainRecord(request)
      || !onlyHasKeys(request, ['classification', 'planSummary', 'feedbackText'])
      || !isPlainRecord(request.classification)
      || typeof request.planSummary !== 'string'
      || request.planSummary.length > 2000
      || typeof request.feedbackText !== 'string'
      || request.feedbackText.length > 2000) {
      return INVALID_REQUEST;
    }

    if (!validateClassification(request.classification)) {
      return INVALID_REQUEST;
    }

    if (request.classification.status !== '已判定') {
      return CLASSIFICATION_NOT_READY;
    }

    const requireSbi = request.feedbackText.trim().length > 0;
    const { validate, diagnose } = createFactAwareValidation({
      baseValidate: (payload) => validateFeedback(payload, { requireSbi }),
      source: {
        classificationReason: request.classification.reason,
        planSummary: request.planSummary,
        feedbackText: request.feedbackText,
      },
      selectGenerated: (payload) => payload,
    });
    const result = await completeStep(4, {
      type_id: request.classification.type_id,
      strategy: request.classification.strategy,
      coach_mode: request.classification.coach_mode,
      classification_reason: request.classification.reason,
      plan_summary: request.planSummary,
      feedback_text: request.feedbackText,
      requires_sbi: requireSbi,
    }, validate, 0.55, 1000, {
      diagnose,
      buildRetryMessage: buildFactBoundaryRetryMessage,
    });
    const highRiskIntent = findHighRiskIntent(result);

    return highRiskIntent ? { blocked: true, ...highRiskIntent } : result;
  }

  return { intake, classify, plan, feedback };
}

module.exports = {
  createCoachService,
  INVALID_REQUEST,
  CLASSIFICATION_NOT_READY,
  isInvalidRequestResult,
};
