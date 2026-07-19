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
    scripts: ['我们先一起明确本周最重要的目标。', '你愿意在周五前完成哪一步行动？'],
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
