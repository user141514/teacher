export const TYPE_LABELS = Object.freeze({
  A: '高能力高意愿型',
  B: '成熟待激活型',
  C: '成长发展型',
  D1: '新入职适应型',
  D2: '绩效改进支持型',
});

export const CLASSIFICATION_LABELS = Object.freeze({
  status: '判定状态',
  classification_confidence: '判断可信度',
  ability: '能力',
  will: '意愿',
  strategy: '用人策略',
  coach_mode: '教练模式',
  reason: '判定说明',
});

export function typeLabel(typeId) {
  return TYPE_LABELS[typeId] || '未判定';
}
