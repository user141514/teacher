const assert = require('node:assert/strict');
const test = require('node:test');

const { findHighRiskIntent } = require('../server/guardrails.js');

const HR_REVIEW_RESPONSE = {
  code: 'HR_REVIEW_REQUIRED',
  message: '该事项涉及高风险人事决策，请转交 HR 按公司制度处理。本工具仅可协助准备一般辅导沟通。',
};

function createDeeplyNestedJson(depth) {
  return `${'{"n":'.repeat(depth)}{}${'}'.repeat(depth)}`;
}

test('findHighRiskIntent 对辞退请求返回固定且不可变的 HR 审核结果', () => {
  const result = findHighRiskIntent({ pain: '请帮我制定辞退方案' });

  assert.deepEqual(result, HR_REVIEW_RESPONSE);
  assert.ok(Object.isFrozen(result));
});

test('findHighRiskIntent 识别预定义的人事处置短语', () => {
  for (const pain of [
    '部门裁员的沟通方案',
    '如何协商离职',
    '准备对员工进行纪律处分',
    '调岗降薪前需要准备什么',
    '怎样解除劳动合同',
  ]) {
    assert.deepEqual(findHighRiskIntent({ pain }), HR_REVIEW_RESPONSE);
  }
});

test('findHighRiskIntent 仅在长期不胜任和处置性动作同时出现时拦截', () => {
  assert.deepEqual(
    findHighRiskIntent({ pain: '员工长期不胜任，准备辞退' }),
    HR_REVIEW_RESPONSE,
  );
  assert.equal(findHighRiskIntent({ pain: '员工长期不胜任，想制定绩效改进计划' }), null);
});

test('findHighRiskIntent 识别长期不胜任相关的处置与解除建议', () => {
  assert.deepEqual(
    findHighRiskIntent({ pain: '请给出长期不胜任处置建议' }),
    HR_REVIEW_RESPONSE,
  );
  assert.deepEqual(
    findHighRiskIntent({ pain: '员工长期不胜任，建议解除' }),
    HR_REVIEW_RESPONSE,
  );
});

test('findHighRiskIntent 识别包含员工指代的明确人事解除', () => {
  for (const pain of [
    '员工长期不胜任，拟解除其劳动合同',
    '员工长期不胜任，建议解除该员工劳动关系',
    '员工长期不胜任，拟解除与该员工的劳动关系',
  ]) {
    assert.deepEqual(findHighRiskIntent({ pain }), HR_REVIEW_RESPONSE);
  }
});

test('findHighRiskIntent 识别长期不胜任相关的明确人事处置动作', () => {
  for (const pain of [
    '针对长期不胜任的员工进行人事处置',
    '员工长期不胜任，建议调岗',
    '员工长期不胜任，建议降薪',
  ]) {
    assert.deepEqual(findHighRiskIntent({ pain }), HR_REVIEW_RESPONSE);
  }
});

test('findHighRiskIntent 不将解除工作障碍视为人事解除', () => {
  assert.equal(
    findHighRiskIntent({ pain: '员工长期不胜任，想通过辅导解除工作障碍并改进绩效' }),
    null,
  );
});

test('findHighRiskIntent 不将项目障碍处置视为人事处置', () => {
  assert.equal(
    findHighRiskIntent({ pain: '员工长期不胜任，需处置当前项目障碍后继续改进' }),
    null,
  );
});

test('findHighRiskIntent 不拦截一般辅导与非处置性绩效改进', () => {
  for (const pain of [
    '如何给新同事安排带教',
    '如何和员工沟通季度目标并拆解',
    '怎样帮助员工制定非处置性绩效改进计划',
    '如何帮助团队解除障碍',
    '如何和员工沟通季度目标',
  ]) {
    assert.equal(findHighRiskIntent({ pain }), null);
  }
});

test('findHighRiskIntent 扫描嵌套对象和数组中的字符串', () => {
  const result = findHighRiskIntent({
    context: {
      notes: ['目标拆解', { followUp: '请协商离职' }],
    },
  });

  assert.deepEqual(result, HR_REVIEW_RESPONSE);
});

test('findHighRiskIntent 忽略空值、循环引用和原型链文本', () => {
  const circular = {};
  circular.self = circular;
  const inheritedText = Object.create({ pain: '辞退' });

  for (const input of [null, circular, inheritedText]) {
    let result;
    assert.doesNotThrow(() => {
      result = findHighRiskIntent(input);
    });
    assert.equal(result, null);
  }
});

test('findHighRiskIntent 可处理 5000 层自有嵌套对象', () => {
  const requestJson = createDeeplyNestedJson(5000);
  const request = JSON.parse(requestJson);

  assert.ok(Buffer.byteLength(requestJson, 'utf8') < 32 * 1024);
  let result;
  assert.doesNotThrow(() => {
    result = findHighRiskIntent(request);
  });
  assert.equal(result, null);
});
