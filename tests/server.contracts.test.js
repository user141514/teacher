const assert = require('node:assert/strict');
const test = require('node:test');

const {
  validateIntake,
  validateModelClassification,
  validateClassification,
  validatePlan,
  validatePlanStop,
  validateFeedback,
} = require('../server/contracts.js');

function completeClassification(overrides = {}) {
  return {
    ability: '高',
    will: '低',
    quadrant: 'B',
    type_id: 'B',
    status: '已判定',
    classification_confidence: '高',
    strategy: '激发意愿',
    coach_mode: '诱导式',
    reason: '能独立交付，但近期主动性不足。',
    evidence: ['能独立交付', '近期主动性不足'],
    questions: [],
    ...overrides,
  };
}

function modelClassification(overrides = {}) {
  const application = completeClassification();
  const { classification_confidence, ...rest } = application;
  return { ...rest, confidence: classification_confidence, ...overrides };
}

test('模型分类与应用分类分别使用 confidence 和 classification_confidence', () => {
  assert.equal(validateModelClassification(modelClassification()), true);
  assert.equal(validateClassification(completeClassification()), true);
  assert.equal(validateModelClassification(completeClassification()), false);
  assert.equal(validateClassification(modelClassification()), false);
});

test('已判定应用分类严格校验策略映射、模式与具体依据', () => {
  assert.equal(validateClassification(completeClassification()), true);
  assert.equal(validateClassification(completeClassification({ strategy: '委以重任' })), false);
  assert.equal(validateClassification(completeClassification({ coach_mode: '授权式' })), false);
  assert.equal(validateClassification(completeClassification({ reason: '  ' })), false);
  assert.equal(validateClassification(completeClassification({ matched_type: 'B' })), false);
  assert.equal(validateClassification(completeClassification({ sub_type: 'B' })), false);
  assert.equal(validateClassification(completeClassification({ alt_type: 'C' })), false);
});

test('待补充与待人工确认不得生成类型化策略', () => {
  const pending = completeClassification({
    ability: '未知',
    will: '低',
    quadrant: null,
    type_id: null,
    status: '待补充',
    classification_confidence: '低',
    strategy: null,
    coach_mode: null,
    reason: '缺少可用的能力证据。',
    evidence: [],
    questions: ['请补充近期绩效证据。'],
  });
  assert.equal(validateClassification(pending), true);
  assert.equal(validateClassification({ ...pending, strategy: '激发意愿' }), false);
  assert.equal(validateClassification({
    ...pending,
    ability: '高',
    quadrant: 'B',
    status: '待人工确认',
    reason: '能力与意愿证据存在冲突。',
  }), true);
});

test('模型与应用等待态均必须是低可信度且包含待确认问题', () => {
  const pendingApp = completeClassification({
    ability: '未知', quadrant: null, type_id: null, status: '待补充',
    classification_confidence: '低', strategy: null, coach_mode: null,
    reason: '缺少能力证据。', evidence: [], questions: ['请补充能力证据。'],
  });
  const { classification_confidence, ...pendingFields } = pendingApp;
  const pendingModel = { ...pendingFields, confidence: classification_confidence };
  const manualApp = {
    ...pendingApp,
    ability: '高',
    quadrant: 'B',
    status: '待人工确认',
    reason: '能力和意愿证据存在冲突。',
  };
  const { classification_confidence: manualConfidence, ...manualFields } = manualApp;
  const manualModel = { ...manualFields, confidence: manualConfidence };

  for (const [validate, payload, confidenceField] of [
    [validateClassification, pendingApp, 'classification_confidence'],
    [validateModelClassification, pendingModel, 'confidence'],
    [validateClassification, manualApp, 'classification_confidence'],
    [validateModelClassification, manualModel, 'confidence'],
  ]) {
    assert.equal(validate(payload), true);
    assert.equal(validate({ ...payload, [confidenceField]: '高' }), false);
    assert.equal(validate({ ...payload, questions: [] }), false);
  }
});

test('D 类资料未齐可待补充，其他已知组合不得绕过映射', () => {
  const pendingD = completeClassification({
    ability: '低', will: '低', quadrant: null, type_id: null, status: '待补充',
    classification_confidence: '低', strategy: null, coach_mode: null,
    reason: '尚未补齐入职与辅导历史。',
    questions: ['补充入职时长、绩效周期和辅导历史。'],
  });
  assert.equal(validateClassification(pendingD), true);
  assert.equal(validateClassification({ ...pendingD, ability: '高' }), false);
});

test('证据冲突时仅接受待人工确认且不输出类型', () => {
  const manual = completeClassification({
    ability: '低', will: '低', quadrant: 'D', type_id: null, status: '待人工确认',
    classification_confidence: '低', strategy: null, coach_mode: null,
    reason: '绩效证据与辅导反馈存在冲突。', questions: ['请主管人工确认。'],
  });
  assert.equal(validateClassification(manual), true);
  assert.equal(validateClassification({ ...manual, type_id: 'D2' }), false);
  assert.equal(validateClassification({ ...manual, quadrant: 'A' }), false);
});

test('五类已判定结果必须遵循能力意愿和教练映射', () => {
  const cases = [
    ['A', '高', '高', 'A', '委以重任', '授权式'],
    ['B', '高', '低', 'B', '激发意愿', '诱导式'],
    ['C', '低', '高', 'C', '长期培养', '引导式'],
    ['D1', '低', '低', 'D', '手把手带', '教导式'],
    ['D2', '低', '低', 'D', '绩效改进/优化', '绩效面谈'],
  ];

  for (const [typeId, ability, will, quadrant, strategy, coachMode] of cases) {
    assert.equal(validateClassification(completeClassification({
      ability, will, quadrant, type_id: typeId, strategy, coach_mode: coachMode,
    })), true);
  }

  assert.equal(validateClassification(completeClassification({ quadrant: 'D', type_id: 'D2' })), false);
});

test('分类结果拒绝非法枚举、缺少证据和额外字段', () => {
  assert.equal(validateClassification(completeClassification({ ability: '中' })), false);
  assert.equal(validateClassification(completeClassification({ evidence: [] })), false);
  assert.equal(validateClassification(completeClassification({ internal_note: '不应通过' })), false);
});

test('接收响应接受提示词步骤 1 的正常 JSON，并拒绝结构、额外字段和数组越界', () => {
  const intake = {
    sufficient: false,
    status: '待补充',
    high_risk_personnel_action: false,
    missing: ['绩效周期', '辅导历史'],
    questions: ['请补充最近绩效周期结果和既往辅导历史'],
    normalized_profile: {
      ability_clues: '能力不足',
      will_clues: '意愿不足',
      tenure: '6个月',
      perf_history: '',
      performance_cycles: '',
      coaching_history: '',
      goal: '',
      pain: '',
    },
  };

  assert.equal(validateIntake(intake), true);
  assert.equal(validateIntake({ ...intake, extra: true }), false);
  assert.equal(validateIntake({ ...intake, normalized_profile: {} }), false);
  assert.equal(validateIntake({
    ...intake,
    questions: Array.from({ length: 8 }, () => '补充信息'),
  }), true);
  assert.equal(validateIntake({
    ...intake,
    questions: Array.from({ length: 9 }, () => '补充信息'),
  }), false);
});

test('接收响应强制高风险、充分性与缺失项状态一致', () => {
  const evaluable = {
    sufficient: true,
    status: '可评估',
    high_risk_personnel_action: false,
    missing: [],
    questions: [],
    normalized_profile: {
      ability_clues: '可独立交付',
      will_clues: '主动承担挑战',
      tenure: '18个月',
      perf_history: '连续达标',
      performance_cycles: '已完成两个周期',
      coaching_history: '无专项辅导',
      goal: '承担更高难度任务',
      pain: '',
    },
  };

  assert.equal(validateIntake(evaluable), true);
  assert.equal(validateIntake({ ...evaluable, high_risk_personnel_action: true }), false);
  assert.equal(validateIntake({ ...evaluable, sufficient: false }), false);
  assert.equal(validateIntake({
    ...evaluable,
    sufficient: false,
    status: '高风险停止',
    high_risk_personnel_action: false,
  }), false);
  assert.equal(validateIntake({
    ...evaluable,
    sufficient: false,
    status: '高风险停止',
    high_risk_personnel_action: true,
  }), true);
  assert.equal(validateIntake({
    ...evaluable,
    sufficient: false,
    status: '待补充',
    missing: ['绩效周期', '绩效周期'],
  }), false);
});

test('接收响应按状态约束缺失项与追问', () => {
  const evaluable = {
    sufficient: true,
    status: '可评估',
    high_risk_personnel_action: false,
    missing: [],
    questions: [],
    normalized_profile: {
      ability_clues: '可独立交付',
      will_clues: '主动承担挑战',
      tenure: '18个月',
      perf_history: '连续达标',
      performance_cycles: '已完成两个周期',
      coaching_history: '无专项辅导',
      goal: '承担更高难度任务',
      pain: '',
    },
  };

  assert.equal(validateIntake({
    ...evaluable,
    missing: ['绩效周期'],
  }), false);
  assert.equal(validateIntake({
    ...evaluable,
    questions: ['请补充绩效周期'],
  }), false);
  assert.equal(validateIntake({
    ...evaluable,
    sufficient: false,
    status: '待补充',
    missing: [],
    questions: ['请补充绩效周期'],
  }), false);
  assert.equal(validateIntake({
    ...evaluable,
    sufficient: false,
    status: '待补充',
    missing: ['绩效周期'],
    questions: [],
  }), false);
  assert.equal(validateIntake({
    ...evaluable,
    sufficient: false,
    status: '待人工确认',
    missing: [],
    questions: [],
  }), false);
  assert.equal(validateIntake({
    ...evaluable,
    sufficient: false,
    status: '高风险停止',
    high_risk_personnel_action: true,
    missing: [],
    questions: [],
  }), true);
});

test('方案响应接受提示词步骤 3 的正常 JSON，并将停止结果隔离校验', () => {
  const plan = {
    entry: ['先确认员工对目标和困难的理解'],
    cautions: ['避免将问题归因于个人态度'],
    frequency: '每周一次，连续四周复盘',
    gap_fix: ['将关键任务拆为可观察的小目标'],
    scripts: [
      'Goal（目标）：本周主动同步一次风险。Reality（现状）：目前通常要主管提醒后才同步。',
      'Options（可选方案）：可在例会前或里程碑当天同步。Will（行动承诺）：周五前完成首次主动同步。',
    ],
  };
  const stoppedPlan = {
    status: '停止生成',
    type_id: null,
    steps: [],
    stop_reason: '高风险人事处置需转人工处理',
  };

  assert.equal(validatePlan(plan), true);
  assert.equal(validatePlan({ ...plan, status: '已生成' }), false);
  assert.equal(validatePlan({ ...plan, scripts: [...plan.scripts, '多余话术'] }), false);
  assert.equal(validatePlanStop(stoppedPlan), true);
  assert.equal(validatePlan(stoppedPlan), false);
  assert.equal(validatePlanStop({ ...stoppedPlan, steps: ['不得生成步骤'] }), false);
});

test('方案契约拒绝缺失、乱序或空内容的 GROW 阶段', () => {
  const valid = {
    entry: ['从本周协作目标切入。'],
    cautions: ['只引用员工已提供的行为。'],
    frequency: '每周一次复盘。',
    gap_fix: ['把主动同步拆成可观察行为。'],
    scripts: [
      'Goal（目标）：本周主动同步一次风险。Reality（现状）：目前通常要主管提醒后才同步。',
      'Options（可选方案）：可在例会前或里程碑当天同步。Will（行动承诺）：周五前完成首次主动同步。',
    ],
  };

  assert.equal(validatePlan(valid, { typeId: 'A' }), true);
  assert.equal(validatePlan({ ...valid, scripts: ['Goal（目标）：主动同步。', valid.scripts[1]] }, { typeId: 'A' }), false);
  assert.equal(validatePlan({ ...valid, scripts: ['Reality（现状）：需提醒。Goal（目标）：主动同步。', valid.scripts[1]] }, { typeId: 'A' }), false);
  assert.equal(validatePlan({ ...valid, scripts: [valid.scripts[0], 'Options（可选方案）：。Will（行动承诺）：周五执行。'] }, { typeId: 'A' }), false);
});

test('B 与 D2 方案同时要求 gap_fix 和 scripts 至少一项完整 SBI', () => {
  const valid = {
    entry: ['从本周协作目标切入。'],
    cautions: ['避免人身评判。'],
    frequency: '每周一次复盘。',
    gap_fix: ['Situation（情境）：周一例会。Behavior（行为）：你会前主动同步风险。Impact（影响）：团队提前协调资源。'],
    scripts: [
      'Goal（目标）：本周主动同步一次风险。Reality（现状）：目前通常要主管提醒后才同步。Situation（情境）：上周评审。Behavior（行为）：你在会前整理了风险。Impact（影响）：团队及时调整了排期。',
      'Options（可选方案）：可在例会前或里程碑当天同步。Will（行动承诺）：周五前完成首次主动同步。',
    ],
  };

  for (const typeId of ['B', 'D2']) assert.equal(validatePlan(valid, { typeId }), true);
  assert.equal(validatePlan({ ...valid, gap_fix: ['把任务拆小。'] }, { typeId: 'B' }), false);
  assert.equal(validatePlan({ ...valid, scripts: [
    'Goal（目标）：本周主动同步一次风险。Reality（现状）：目前通常要主管提醒后才同步。',
    valid.scripts[1],
  ] }, { typeId: 'D2' }), false);
  assert.equal(validatePlan({ ...valid, gap_fix: ['把任务拆小。'], scripts: [
    'Goal（目标）：本周主动同步一次风险。Reality（现状）：目前通常要主管提醒后才同步。',
    valid.scripts[1],
  ] }, { typeId: 'C' }), true);
});

test('反馈响应接受提示词步骤 4 的正常 JSON，并拒绝额外字段和边界外数组', () => {
  const feedback = {
    progress_read: '意愿提升，但独立交付信心仍不足。',
    next_steps: ['将目标拆分为本周可完成的小步骤', '周五复盘执行结果'],
    watch_points: ['观察遇到困难时是否主动求助'],
  };

  assert.equal(validateFeedback(feedback), true);
  assert.equal(validateFeedback({ ...feedback, rating: 5 }), false);
  assert.equal(validateFeedback({ ...feedback, progress_read: '' }), false);
  assert.equal(validateFeedback({
    ...feedback,
    next_steps: [...feedback.next_steps, '补充第三步'],
  }), true);
  assert.equal(validateFeedback({
    ...feedback,
    next_steps: [...feedback.next_steps, '补充第三步', '超出边界'],
  }), false);
});

test('非空反馈要求 next_steps 至少一条完整 SBI，空反馈不额外强制', () => {
  const feedback = {
    progress_read: '员工已愿意主动同步风险。',
    next_steps: [
      'Situation（情境）：周五复盘。Behavior（行为）：你主动同步了风险。Impact（影响）：团队提前安排了支持。',
      '下周继续观察主动同步频率。',
    ],
    watch_points: ['观察是否持续主动同步。'],
  };

  assert.equal(validateFeedback(feedback, { requireSbi: true }), true);
  assert.equal(validateFeedback({ ...feedback, next_steps: ['拆分任务。', '周五复盘。'] }, { requireSbi: true }), false);
  assert.equal(validateFeedback({ ...feedback, next_steps: ['拆分任务。', '周五复盘。'] }, { requireSbi: false }), true);
});
