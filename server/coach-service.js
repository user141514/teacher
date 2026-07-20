const {
  validateIntake,
  validateModelClassification,
  validateClassification,
  validateNormalizedProfile,
  validatePlan,
  validateFeedback,
} = require('./contracts.js');
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

function createCoachService({ promptLoader, client } = {}) {
  async function completeStep(step, payload, validate, temperature, maxTokens) {
    if (!promptLoader || typeof promptLoader.buildMessages !== 'function'
      || !client || typeof client.complete !== 'function') {
      throw controlledError('MODEL_SERVICE_UNAVAILABLE');
    }

    const result = await client.complete({
      messages: promptLoader.buildMessages(step, payload),
      validate,
      temperature,
      maxTokens,
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

    return completeStep(1, {
      intake: request.intake,
      answers: request.answers || {},
    }, validateIntake, 0.25, 900);
  }

  async function classify(request) {
    if (!isPlainRecord(request)
      || !onlyHasKeys(request, ['normalizedProfile'])
      || !validateNormalizedProfile(request.normalizedProfile)) {
      return INVALID_REQUEST;
    }

    const modelResult = await completeStep(2, {
      normalized_profile: request.normalizedProfile,
    }, validateModelClassification, 0.25, 900);
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

    const requiresSbi = ['B', 'D2'].includes(request.classification.type_id);
    const validate = (payload) => validatePlan(payload, {
      typeId: request.classification.type_id,
    });
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
    }, validate, 0.55, 1400);
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
    const validate = (payload) => validateFeedback(payload, {
      requireSbi,
    });
    const result = await completeStep(4, {
      type_id: request.classification.type_id,
      strategy: request.classification.strategy,
      coach_mode: request.classification.coach_mode,
      classification_reason: request.classification.reason,
      plan_summary: request.planSummary,
      feedback_text: request.feedbackText,
      requires_sbi: requireSbi,
    }, validate, 0.55, 1000);
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
