const Ajv = require('ajv');

const ajv = new Ajv({ allErrors: true });

const shortText = { type: 'string', minLength: 1, maxLength: 160 };
const profileText = { type: 'string', maxLength: 500 };
const typeId = { enum: ['A', 'B', 'C', 'D1', 'D2'] };

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
    normalized_profile: {
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
    },
  },
};

const classificationResponse = {
  type: 'object',
  additionalProperties: false,
  required: [
    'ability',
    'will',
    'quadrant',
    'type_id',
    'status',
    'confidence',
    'evidence',
    'questions',
  ],
  properties: {
    ability: { enum: ['高', '低', '未知'] },
    will: { enum: ['高', '低', '未知'] },
    quadrant: { anyOf: [{ enum: ['A', 'B', 'C', 'D'] }, { type: 'null' }] },
    type_id: { anyOf: [typeId, { type: 'null' }] },
    status: { enum: ['待补充', '待人工确认', '已判定'] },
    confidence: { enum: ['高', '中', '低'] },
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
const validateClassificationSchema = ajv.compile(classificationResponse);
const validatePlan = ajv.compile(planResponse);
const validatePlanStop = ajv.compile(planStopResponse);
const validateFeedback = ajv.compile(feedbackResponse);

const classificationMappings = {
  '高|高': { quadrant: 'A', typeIds: ['A'] },
  '高|低': { quadrant: 'B', typeIds: ['B'] },
  '低|高': { quadrant: 'C', typeIds: ['C'] },
  '低|低': { quadrant: 'D', typeIds: ['D1', 'D2'] },
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

function validateClassification(payload) {
  if (!validateClassificationSchema(payload)) {
    return false;
  }

  if (payload.ability === '未知' || payload.will === '未知') {
    return payload.status === '待补充'
      && payload.quadrant === null
      && payload.type_id === null
      && payload.confidence === '低';
  }

  const mapping = classificationMappings[`${payload.ability}|${payload.will}`];

  if (payload.status === '待补充') {
    return mapping.quadrant === 'D'
      && payload.quadrant === null
      && payload.type_id === null
      && payload.confidence === '低';
  }

  if (payload.status === '待人工确认') {
    return payload.type_id === null
      && (payload.quadrant === null || payload.quadrant === mapping.quadrant);
  }

  return payload.status === '已判定'
    && payload.quadrant === mapping.quadrant
    && mapping.typeIds.includes(payload.type_id)
    && payload.evidence.length > 0;
}

module.exports = {
  intakeResponse,
  classificationResponse,
  planResponse,
  planStopResponse,
  feedbackResponse,
  validateIntake,
  validateClassification,
  validatePlan,
  validatePlanStop,
  validateFeedback,
};
