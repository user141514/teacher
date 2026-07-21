const assert = require('node:assert/strict');
const test = require('node:test');

const {
  hasCompleteGrowScripts,
  hasCompleteSbi,
} = require('../server/coaching-methods.js');

test('GROW 要求两条话术分别按顺序包含非空 Goal/Reality 与 Options/Will', () => {
  assert.equal(hasCompleteGrowScripts([
    '**Goal（目标）**：本周独立推进客户评审。\n**Reality（现状）**：当前需要主管提醒才同步风险。',
    '- **Options（可选方案）**：可选择每日同步或在里程碑主动同步。\n- **Will（行动承诺）**：周五前完成首次主动同步。',
  ]), true);

  assert.equal(hasCompleteGrowScripts(['Goal（目标）：本周达成目标。', 'Options（可选方案）：先试一次。Will（行动承诺）：周五复盘。']), false);
  assert.equal(hasCompleteGrowScripts(['Reality（现状）：仍需提醒。Goal（目标）：主动同步。', 'Options（可选方案）：每日同步。Will（行动承诺）：周五执行。']), false);
  assert.equal(hasCompleteGrowScripts(['Reality（现状）：仍需提醒。Goal（目标）：主动同步。Reality（现状）：需要主管提醒。', 'Options（可选方案）：每日同步。Will（行动承诺）：周五执行。']), false);
  assert.equal(hasCompleteGrowScripts(['Options（可选方案）：每日同步。Goal（目标）：主动同步。Reality（现状）：仍需提醒。', 'Options（可选方案）：每日同步。Will（行动承诺）：周五执行。']), false);
  assert.equal(hasCompleteGrowScripts(['Goal（目标）：  \nReality（现状）：仍需提醒。', 'Options（可选方案）：每日同步。Will（行动承诺）：周五执行。']), false);
  assert.equal(hasCompleteGrowScripts(['Goal（目标）：主动同步。Reality（现状）：仍需提醒。', 'Will（行动承诺）：周五执行。Options（可选方案）：每日同步。']), false);
  assert.equal(hasCompleteGrowScripts(['Goal（目标）：主动同步。Reality（现状）：仍需提醒。', 'Goal（目标）：主动同步。Reality（现状）：仍需提醒。Options（可选方案）：每日同步。Will（行动承诺）：周五执行。']), false);
});

test('SBI 要求标签式 Situation/Behavior/Impact 按序且内容非空', () => {
  assert.equal(hasCompleteSbi('**Situation（情境）**：周一项目例会；**Behavior（行为）**：你在会前主动同步风险；**Impact（影响）**：团队提前协调了资源。'), true);
  assert.equal(hasCompleteSbi('Situation（情境）：周一例会。Impact（影响）：进度受影响。Behavior（行为）：未提前同步。'), false);
  assert.equal(hasCompleteSbi('Impact（影响）：团队临时调整。Situation（情境）：周一例会。Behavior（行为）：未提前同步。Impact（影响）：团队无法预排资源。'), false);
  assert.equal(hasCompleteSbi('Situation（情境）：周一例会。Behavior（行为）：。Impact（影响）：团队无法预排资源。'), false);
  assert.equal(hasCompleteSbi('正文讨论 Situation（情境）、Behavior（行为）和 Impact（影响）的定义。'), false);
  assert.equal(hasCompleteSbi('Situation（情境）：周一例会。Behavior（行为）：未提前同步。'), false);
});

test('严格双语阶段标签可出现在自然问句或感叹句之后', () => {
  assert.equal(hasCompleteGrowScripts([
    'Goal（目标）：本周独立推进客户评审！Reality（现状）：当前需要主管提醒才同步风险。',
    'Options（可选方案）：你还可以想到哪些办法？Will（行动承诺）：周五前完成首次主动同步。',
  ]), true);

  assert.equal(hasCompleteSbi(
    'Situation（情境）：周一项目例会！Behavior（行为）：你在会前主动同步了风险？Impact（影响）：团队提前协调了资源。',
  ), true);
});

test('放宽标点边界后仍拒绝中文简称标签', () => {
  assert.equal(hasCompleteGrowScripts([
    '目标：本周独立推进客户评审。现状：当前仍需主管提醒。',
    '可选方案：每日同步。行动承诺：周五执行。',
  ]), false);

  assert.equal(hasCompleteSbi(
    '情境：周一项目例会。行为：会前未同步风险。影响：团队临时调整资源。',
  ), false);
});
