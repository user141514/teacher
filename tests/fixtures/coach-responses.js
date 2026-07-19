function profile() {
  return {
    ability_clues: '能够独立交付复杂任务',
    will_clues: '近期主动性不足',
    tenure: '1 年以上',
    perf_history: '持续达标',
    performance_cycles: '2 个周期',
    coaching_history: '未做过针对性辅导',
    goal: '独立承接三个项目',
    pain: '交代的事不追就停',
  };
}

function envelope(data) {
  return { ok: true, blocked: false, data };
}

function intakeIncomplete() {
  return envelope({
    sufficient: false,
    status: '待补充',
    high_risk_personnel_action: false,
    missing: ['辅导历史'],
    questions: ['是否已做过针对性辅导？'],
    normalized_profile: profile(),
  });
}

function intakeComplete() {
  return envelope({
    sufficient: true,
    status: '可评估',
    high_risk_personnel_action: false,
    missing: [],
    questions: [],
    normalized_profile: profile(),
  });
}

function classified() {
  return envelope({
    ability: '高',
    will: '低',
    quadrant: 'B',
    type_id: 'B',
    status: '已判定',
    classification_confidence: '中',
    strategy: '激发意愿',
    coach_mode: '诱导式',
    reason: '员工已能独立交付复杂任务，但近期主动性不足。',
    evidence: ['已能独立交付复杂任务', '近期主动性不足'],
    questions: [],
  });
}

function coachingPlan() {
  return envelope({
    entry: ['**先认可**其交付能力，再约定挑战目标。'],
    cautions: ['避免把跟进变成查岗。'],
    frequency: '每周一次 1v1（15 分钟）',
    gap_fix: ['把主动同步拆成每周一个可观察行为。'],
    scripts: ['“这块你比我熟，想听你的方案。”', '“这次由你拍板，我会兜底。”'],
  });
}

function nextPlan() {
  return envelope({
    entry: ['从近期成果切入，邀请他选择挑战任务。'],
    cautions: ['保留决策空间。'],
    frequency: '每周一次复盘',
    gap_fix: ['用里程碑反馈强化主动行为。'],
    scripts: ['“你愿意先试哪一步？”', '“需要支持时及时告诉我。”'],
  });
}

function coachingFeedback() {
  return envelope({
    progress_read: '**进展：** 已愿意主动接一个模块。',
    next_steps: ['把任务拆成两个小阶段。', '一周后复盘主动性。'],
    watch_points: ['避免只关注结果，忽略主动行为。'],
  });
}

function defaultFixtures() {
  return {
    intake: [intakeIncomplete(), intakeComplete()],
    classify: [classified()],
    plan: [coachingPlan(), nextPlan()],
    feedback: [coachingFeedback()],
  };
}

module.exports = {
  coachingPlan,
  defaultFixtures,
  envelope,
  nextPlan,
};
