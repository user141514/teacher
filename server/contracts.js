const Ajv = require('ajv');
const { hasCompleteGrowScripts, hasCompleteSbi } = require('./coaching-methods.js');

const ajv = new Ajv({ allErrors: true });

const shortText = { type: 'string', minLength: 1, maxLength: 160 };
const profileText = { type: 'string', maxLength: 500 };
const typeId = { enum: ['A', 'B', 'C', 'D1', 'D2'] };

const normalizedProfile = {
  type: 'object',
  additionalProperties: false,
  required: [
    'ability_clues',
    'will_clues',
    'tenure',
    'perf_history',
    'performance_cycles',
    'coaching_history',
    'goal',
    'pain',
  ],
  properties: {
    ability_clues: profileText,
    will_clues: profileText,
    tenure: profileText,
    perf_history: profileText,
    performance_cycles: profileText,
    coaching_history: profileText,
    goal: profileText,
    pain: profileText,
  },
};

const intakeResponse = {
  type: 'object',
  additionalProperties: false,
  required: [
    'sufficient',
    'status',
    'high_risk_personnel_action',
    'missing',
    'questions',
    'normalized_profile',
  ],
  properties: {
    sufficient: { type: 'boolean' },
    status: { enum: ['待补充', '可评估', '待人工确认', '高风险停止'] },
    high_risk_personnel_action: { type: 'boolean' },
    missing: {
      type: 'array',
      maxItems: 8,
      uniqueItems: true,
      items: {
        enum: [
          '能力线索',
          '意愿线索',
          '入职时长',
          '绩效历史',
          '绩效周期',
          '辅导历史',
        ],
      },
    },
    questions: {
      type: 'array',
      maxItems: 8,
      items: shortText,
    },
    normalized_profile: normalizedProfile,
  },
};

function classificationSchema(confidenceField) {
  return {
  type: 'object',
  additionalProperties: false,
  required: [
    'ability',
    'will',
    'quadrant',
    'type_id',
    'status',
    confidenceField,
    'strategy',
    'coach_mode',
    'reason',
    'evidence',
    'questions',
  ],
  properties: {
    ability: { enum: ['高', '低', '未知'] },
    will: { enum: ['高', '低', '未知'] },
    quadrant: { anyOf: [{ enum: ['A', 'B', 'C', 'D'] }, { type: 'null' }] },
    type_id: { anyOf: [typeId, { type: 'null' }] },
    status: { enum: ['待补充', '待人工确认', '已判定'] },
    [confidenceField]: { enum: ['高', '中', '低'] },
    strategy: { anyOf: [shortText, { type: 'null' }] },
    coach_mode: { anyOf: [shortText, { type: 'null' }] },
    reason: { type: 'string', minLength: 1, maxLength: 500 },
    evidence: {
      type: 'array',
      maxItems: 12,
      items: { type: 'string', minLength: 1, maxLength: 500 },
    },
    questions: {
      type: 'array',
      maxItems: 8,
      items: shortText,
    },
  },
  };
}

const modelClassificationResponse = classificationSchema('confidence');
const classificationResponse = classificationSchema('classification_confidence');

const planResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['entry', 'cautions', 'frequency', 'gap_fix', 'scripts'],
  properties: {
    entry: {
      type: 'array',
      minItems: 1,
      maxItems: 2,
      items: { type: 'string', minLength: 1, maxLength: 500 },
    },
    cautions: {
      type: 'array',
      minItems: 1,
      maxItems: 6,
      items: { type: 'string', minLength: 1, maxLength: 500 },
    },
    frequency: shortText,
    gap_fix: {
      type: 'array',
      minItems: 1,
      maxItems: 6,
      items: { type: 'string', minLength: 1, maxLength: 500 },
    },
    scripts: {
      type: 'array',
      minItems: 2,
      maxItems: 2,
      items: { type: 'string', minLength: 1, maxLength: 500 },
    },
  },
};

const planStopResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'type_id', 'steps', 'stop_reason'],
  properties: {
    status: { enum: ['停止生成'] },
    type_id: { type: 'null' },
    steps: {
      type: 'array',
      maxItems: 0,
      items: { type: 'string', minLength: 1, maxLength: 500 },
    },
    stop_reason: { type: 'string', minLength: 1, maxLength: 300 },
  },
};

const feedbackResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['progress_read', 'next_steps', 'watch_points'],
  properties: {
    progress_read: { type: 'string', minLength: 1, maxLength: 500 },
    next_steps: {
      type: 'array',
      minItems: 2,
      maxItems: 3,
      items: { type: 'string', minLength: 1, maxLength: 500 },
    },
    watch_points: {
      type: 'array',
      maxItems: 6,
      items: shortText,
    },
  },
};

const validateIntakeSchema = ajv.compile(intakeResponse);
const validateNormalizedProfile = ajv.compile(normalizedProfile);
const validateModelClassificationSchema = ajv.compile(modelClassificationResponse);
const validateClassificationSchema = ajv.compile(classificationResponse);
const validatePlanSchema = ajv.compile(planResponse);
const validatePlanStop = ajv.compile(planStopResponse);
const validateFeedbackSchema = ajv.compile(feedbackResponse);

const classificationMappings = {
  '高|高': { quadrant: 'A', typeIds: ['A'] },
  '高|低': { quadrant: 'B', typeIds: ['B'] },
  '低|高': { quadrant: 'C', typeIds: ['C'] },
  '低|低': { quadrant: 'D', typeIds: ['D1', 'D2'] },
};

const coachingMappings = {
  A: { strategy: '委以重任', coachMode: '授权式' },
  B: { strategy: '激发意愿', coachMode: '诱导式' },
  C: { strategy: '长期培养', coachMode: '引导式' },
  D1: { strategy: '手把手带', coachMode: '教导式' },
  D2: { strategy: '绩效改进/优化', coachMode: '绩效面谈' },
};

function validateIntake(payload) {
  if (!validateIntakeSchema(payload)) {
    return false;
  }

  const isHighRisk = payload.status === '高风险停止';
  if (payload.high_risk_personnel_action !== isHighRisk) {
    return false;
  }

  if (payload.sufficient !== (payload.status === '可评估')) {
    return false;
  }

  if (payload.status === '可评估') {
    return payload.missing.length === 0 && payload.questions.length === 0;
  }

  if (isHighRisk) {
    return true;
  }

  if (payload.status === '待补充') {
    return payload.missing.length > 0 && payload.questions.length > 0;
  }

  return payload.questions.length > 0;
}

function validateClassificationSemantics(payload, confidenceField) {
  if (payload.reason.trim().length === 0) {
    return false;
  }

  const confidence = payload[confidenceField];

  if (payload.ability === '未知' || payload.will === '未知') {
    return payload.status === '待补充'
      && payload.quadrant === null
      && payload.type_id === null
      && confidence === '低'
      && payload.strategy === null
      && payload.coach_mode === null
      && payload.questions.length > 0;
  }

  const mapping = classificationMappings[`${payload.ability}|${payload.will}`];

  if (payload.status === '待补充') {
    return mapping.quadrant === 'D'
      && payload.quadrant === null
      && payload.type_id === null
      && confidence === '低'
      && payload.strategy === null
      && payload.coach_mode === null
      && payload.questions.length > 0;
  }

  if (payload.status === '待人工确认') {
    return payload.type_id === null
      && (payload.quadrant === null || payload.quadrant === mapping.quadrant)
      && confidence === '低'
      && payload.strategy === null
      && payload.coach_mode === null
      && payload.questions.length > 0;
  }

  const coaching = coachingMappings[payload.type_id];

  return payload.status === '已判定'
    && payload.quadrant === mapping.quadrant
    && mapping.typeIds.includes(payload.type_id)
    && coaching
    && payload.strategy === coaching.strategy
    && payload.coach_mode === coaching.coachMode
    && payload.evidence.length > 0;
}

function validateModelClassification(payload) {
  return validateModelClassificationSchema(payload)
    && validateClassificationSemantics(payload, 'confidence');
}

function validateClassification(payload) {
  return validateClassificationSchema(payload)
    && validateClassificationSemantics(payload, 'classification_confidence');
}

function validatePlan(payload, { typeId } = {}) {
  if (!validatePlanSchema(payload) || !hasCompleteGrowScripts(payload.scripts)) {
    return false;
  }

  if (typeId === 'B' || typeId === 'D2') {
    return payload.gap_fix.some(hasCompleteSbi) && payload.scripts.some(hasCompleteSbi);
  }

  return true;
}

function validateFeedback(payload, { requireSbi = false } = {}) {
  return validateFeedbackSchema(payload)
    && (!requireSbi || payload.next_steps.some(hasCompleteSbi));
}

module.exports = {
  intakeResponse,
  modelClassificationResponse,
  classificationResponse,
  planResponse,
  planStopResponse,
  feedbackResponse,
  validateNormalizedProfile,
  validateIntake,
  validateModelClassification,
  validateClassification,
  validatePlan,
  validatePlanStop,
  validateFeedback,
};
