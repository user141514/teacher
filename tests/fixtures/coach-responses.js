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
    gap_fix: ['**Situation（情境）**：周一项目例会；**Behavior（行为）**：你在会前主动同步风险；**Impact（影响）**：团队提前协调了资源。'],
    scripts: [
      '**Goal（目标）**：本周独立推进一次项目同步。**Reality（现状）**：目前交代的事不追就停。**Situation（情境）**：上周项目评审；**Behavior（行为）**：你在提醒后才同步风险；**Impact（影响）**：团队只能临时调整资源。',
      '**Options（可选方案）**：可选择例会前或里程碑当天主动同步。**Will（行动承诺）**：周五前完成首次主动同步。',
    ],
  });
}

function nextPlan() {
  return envelope({
    entry: ['从近期成果切入，邀请他选择挑战任务。'],
    cautions: ['保留决策空间。'],
    frequency: '每周一次复盘',
    gap_fix: ['Situation（情境）：下次里程碑评审。Behavior（行为）：员工提前同步风险。Impact（影响）：团队可以预先安排支持。'],
    scripts: [
      'Goal（目标）：下次评审前主动同步风险。Reality（现状）：当前仍需要主管追问。Situation（情境）：本周协作。Behavior（行为）：你在提醒后完成同步。Impact（影响）：资源安排时间较紧。',
      'Options（可选方案）：可用固定模板或日历提醒。Will（行动承诺）：下次评审前一天完成同步。',
    ],
  });
}

function coachingFeedback() {
  return envelope({
    progress_read: '**进展：** 已愿意主动接一个模块。',
    next_steps: ['Situation（情境）：周五复盘。Behavior（行为）：你主动同步了项目风险。Impact（影响）：团队提前安排了支持。', '把任务拆成两个小阶段，一周后复盘主动性。'],
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
