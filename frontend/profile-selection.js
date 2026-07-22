export const PUBLIC_PROFILES = Object.freeze([
  Object.freeze({
    id: 'B',
    ability: '高',
    will: '低',
    name: '熟手待激活型',
    description: '能力够、干得动，但主动性与投入度不足',
    summary: '员工能力较高，但近期主动性和投入度不足，归入熟手待激活型。辅导重点是激发意愿。',
  }),
  Object.freeze({
    id: 'A',
    ability: '高',
    will: '高',
    name: '核心明星型',
    description: '能力强、意愿高，可授权与拔高',
    summary: '员工能力与意愿都较高，归入核心明星型。辅导重点是充分授权并提供更高挑战。',
  }),
  Object.freeze({
    id: 'C',
    ability: '低',
    will: '高',
    name: '潜力新兵型',
    description: '意愿足但经验不足，需带教补能力',
    summary: '员工意愿较高，但当前能力或经验仍需提升，归入潜力新兵型。辅导重点是结构化带教。',
  }),
  Object.freeze({
    id: 'D',
    ability: '低',
    will: '低',
    name: '待改进型',
    description: '能力与意愿双低，需明确要求与边界',
    summary: '员工当前能力与意愿都需要改善，归入待改进型。辅导重点是明确要求、边界与改进节奏。',
  }),
]);

const INTERNAL_COACHING = Object.freeze({
  A: Object.freeze({ quadrant: 'A', strategy: '委以重任', coach_mode: '授权式' }),
  B: Object.freeze({ quadrant: 'B', strategy: '激发意愿', coach_mode: '诱导式' }),
  C: Object.freeze({ quadrant: 'C', strategy: '长期培养', coach_mode: '引导式' }),
  D1: Object.freeze({ quadrant: 'D', strategy: '手把手带', coach_mode: '教导式' }),
  D2: Object.freeze({ quadrant: 'D', strategy: '绩效改进/优化', coach_mode: '绩效面谈' }),
});

export function publicProfileId(typeId) {
  if (typeId === 'D1' || typeId === 'D2') return 'D';
  return ['A', 'B', 'C'].includes(typeId) ? typeId : null;
}

function resolveInternalType(source, selectedProfileId, intake) {
  if (selectedProfileId !== 'D') return selectedProfileId;
  if (source.type_id === 'D1' || source.type_id === 'D2') return source.type_id;
  return intake.tenure === '3 个月内（新人）' ? 'D1' : 'D2';
}

export function resolveFinalClassification(source, selectedProfileId, intake = {}) {
  if (!source || source.status !== '已判定') return source;
  const selected = PUBLIC_PROFILES.find(({ id }) => id === selectedProfileId);
  if (!selected) return source;
  const internalType = resolveInternalType(source, selectedProfileId, intake);
  const coaching = INTERNAL_COACHING[internalType];
  const aiProfileId = publicProfileId(source.type_id);
  const reasonPrefix = aiProfileId === selectedProfileId
    ? ''
    : `用户最终选择“${selected.name}”，AI 原推荐为“${PUBLIC_PROFILES.find(({ id }) => id === aiProfileId)?.name || '未判定'}”。`;
  return {
    ...source,
    ability: selected.ability,
    will: selected.will,
    quadrant: coaching.quadrant,
    type_id: internalType,
    strategy: coaching.strategy,
    coach_mode: coaching.coach_mode,
    reason: `${reasonPrefix}${source.reason}`.slice(0, 500),
  };
}
