const STAGE_LABELS = Object.freeze({
  Goal: 'Goal（目标）',
  Reality: 'Reality（现状）',
  Options: 'Options（可选方案）',
  Will: 'Will（行动承诺）',
  Situation: 'Situation（情境）',
  Behavior: 'Behavior（行为）',
  Impact: 'Impact（影响）',
});

const LABEL_PATTERN = new RegExp(
  `(?:^|[\\r\\n；;。])\\s*(?:[-+>]\\s*)?(?:[*_\`#]+\\s*)?(${Object.values(STAGE_LABELS).join('|')})(?:\\s*[*_\`#]+)?\\s*[：:]`,
  'g',
);

function hasSubstantiveContent(value) {
  return value.replace(/[\s*_`#>~\-–—:：;；,.，。!?！？"'“”‘’()[\]{}]/g, '').length > 0;
}

function parseLabeledStages(value) {
  if (typeof value !== 'string') return [];

  const matches = [...value.matchAll(LABEL_PATTERN)];
  return matches.map((match, index) => ({
    label: match[1],
    content: value.slice(
      match.index + match[0].length,
      index + 1 < matches.length ? matches[index + 1].index : value.length,
    ),
  }));
}

function containsOrderedStages(value, requiredNames) {
  const stages = parseLabeledStages(value);
  let previousIndex = -1;

  for (const name of requiredNames) {
    const label = STAGE_LABELS[name];
    const index = stages.findIndex((stage, stageIndex) => (
      stageIndex > previousIndex && stage.label === label && hasSubstantiveContent(stage.content)
    ));
    if (index === -1) return false;
    previousIndex = index;
  }

  return true;
}

function hasCompleteGrowScripts(scripts) {
  return Array.isArray(scripts)
    && scripts.length >= 2
    && containsOrderedStages(scripts[0], ['Goal', 'Reality'])
    && containsOrderedStages(scripts[1], ['Options', 'Will']);
}

function hasCompleteSbi(value) {
  return containsOrderedStages(value, ['Situation', 'Behavior', 'Impact']);
}

module.exports = {
  hasCompleteGrowScripts,
  hasCompleteSbi,
  parseLabeledStages,
};
