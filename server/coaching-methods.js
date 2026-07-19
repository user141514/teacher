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

function containsExactStages(value, requiredNames, analyzedNames = requiredNames) {
  const requiredLabels = requiredNames.map((name) => STAGE_LABELS[name]);
  const analyzedLabels = analyzedNames.map((name) => STAGE_LABELS[name]);
  const stages = parseLabeledStages(value)
    .filter((stage) => analyzedLabels.includes(stage.label));

  return stages.length === requiredLabels.length
    && stages.every((stage, index) => (
      stage.label === requiredLabels[index] && hasSubstantiveContent(stage.content)
    ));
}

function hasCompleteGrowScripts(scripts) {
  const growNames = ['Goal', 'Reality', 'Options', 'Will'];
  return Array.isArray(scripts)
    && scripts.length >= 2
    && containsExactStages(scripts[0], ['Goal', 'Reality'], growNames)
    && containsExactStages(scripts[1], ['Options', 'Will'], growNames);
}

function hasCompleteSbi(value) {
  return containsExactStages(value, ['Situation', 'Behavior', 'Impact']);
}

module.exports = {
  hasCompleteGrowScripts,
  hasCompleteSbi,
  parseLabeledStages,
};
