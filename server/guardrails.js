const HR_REVIEW_RESPONSE = Object.freeze({
  code: 'HR_REVIEW_REQUIRED',
  message: '该事项涉及高风险人事决策，请转交 HR 按公司制度处理。本工具仅可协助准备一般辅导沟通。',
});

const HIGH_RISK_PERSONNEL_PHRASES = Object.freeze([
  '辞退',
  '开除',
  '裁员',
  '协商离职',
  '纪律处分',
  '调岗降薪',
  '解除劳动合同',
  '解除劳动关系',
  '解除聘用',
]);

const SUGGESTED_TERMINATION_PATTERN = /建议解除(?:[，,。；;\s]|$)/;
const PERSONNEL_TERMINATION_PATTERN = /解除(?:其|该员工(?:的)?|与该员工的)?(?:劳动合同|劳动关系|聘用)/;

const LONG_TERM_UNDERPERFORMANCE_PERSONNEL_ACTIONS = Object.freeze([
  '人事处置',
  '长期不胜任处置',
  '建议调岗',
  '建议降薪',
  '实施调岗',
  '实施降薪',
  '解除劳动合同',
  '解除劳动关系',
  '解除聘用',
]);

function collectStrings(value, strings) {
  const stack = [value];
  const seen = new Set();

  while (stack.length > 0) {
    const current = stack.pop();

    if (typeof current === 'string') {
      strings.push(current);
      continue;
    }

    if (!current || typeof current !== 'object' || seen.has(current)) {
      continue;
    }

    seen.add(current);
    for (const nestedValue of Object.values(current)) {
      stack.push(nestedValue);
    }
  }
}

function findHighRiskIntent(requestBody) {
  const strings = [];
  collectStrings(requestBody, strings);

  const containsHighRiskPhrase = strings.some((value) => (
    HIGH_RISK_PERSONNEL_PHRASES.some((phrase) => value.includes(phrase))
  ));
  const containsPersonnelTermination = strings.some((value) => (
    PERSONNEL_TERMINATION_PATTERN.test(value)
  ));
  if (containsHighRiskPhrase || containsPersonnelTermination) {
    return HR_REVIEW_RESPONSE;
  }

  const mentionsLongTermUnderperformance = strings.some((value) => value.includes('长期不胜任'));
  const mentionsPersonnelAction = strings.some((value) => (
    LONG_TERM_UNDERPERFORMANCE_PERSONNEL_ACTIONS.some((action) => value.includes(action))
  ));
  const suggestsTermination = strings.some((value) => SUGGESTED_TERMINATION_PATTERN.test(value));

  return mentionsLongTermUnderperformance && (mentionsPersonnelAction || suggestsTermination)
    ? HR_REVIEW_RESPONSE
    : null;
}

module.exports = { findHighRiskIntent };
