import { CLASSIFICATION_LABELS, typeLabel } from './labels.js';

const STEPS = [
  ['员工信息输入', '特征 + 绩效期望'],
  ['类型判定', '匹配能力 × 意愿画像'],
  ['教练方案生成', '差异化建议'],
  ['辅导反馈', '会话内迭代'],
];

export const BLOCKED_MESSAGE = '该事项涉及高风险人事决策，请转交 HR 按公司制度处理。本工具仅可协助准备一般辅导沟通。';

function node(tag, { className, id, text, type, disabled, value, htmlFor } = {}) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (id) element.id = id;
  if (text !== undefined) element.textContent = text;
  if (type) element.type = type;
  if (disabled !== undefined) element.disabled = disabled;
  if (value !== undefined) element.value = value;
  if (htmlFor) element.htmlFor = htmlFor;
  return element;
}

function button(id, text, onClick, { accent = false, secondary = false, disabled = false } = {}) {
  const control = node('button', {
    id,
    text,
    type: 'button',
    disabled,
    className: `btn ${accent ? 'btn-accent' : secondary ? 'btn-ghost' : 'btn-primary'}`,
  });
  control.addEventListener('click', onClick);
  return control;
}

function appendPreviousButton(footer, handlers) {
  footer.append(button('go-previous', '返回上一步', handlers.goPrevious, { secondary: true }));
}

function fieldLabel(forId, text, hint) {
  const label = node('label', { className: 'flabel', text, htmlFor: forId });
  if (hint) label.append(node('span', { className: 'dim', text: hint }));
  return label;
}

function selectField(id, labelText, options, value) {
  const wrap = node('div', { className: 'field' });
  const select = node('select', { id, value: value || options[0] });
  for (const optionText of options) {
    select.append(node('option', { text: optionText, value: optionText }));
  }
  select.value = value || options[0];
  wrap.append(fieldLabel(id, labelText), select);
  return wrap;
}

function textAreaField(id, labelText, value, placeholder) {
  const wrap = node('div', { className: 'field' });
  const input = node('textarea', { id, value: value || '' });
  input.placeholder = placeholder;
  wrap.append(fieldLabel(id, labelText), input);
  return wrap;
}

function appendError(target, error) {
  if (!error) return;
  target.append(node('div', { className: 'reasoning', text: error }));
}

function appendQuestions(target, questions) {
  if (!Array.isArray(questions) || questions.length === 0) return;
  const list = node('ul', { className: 'rlist' });
  for (const question of questions) list.append(node('li', { text: question }));
  target.append(list);
}

function createWorkspace(state, title, description) {
  const fragment = document.createDocumentFragment();
  const header = node('div', { className: 'ws-head' });
  header.append(node('div', { className: 'ws-title', text: '教练助手' }));
  fragment.append(header);

  const grid = node('div', { className: 'ws-grid' });
  const stepper = node('nav', { className: 'stepper' });
  stepper.setAttribute('aria-label', '辅导流程');
  const stepList = node('ol');
  stepList.style.listStyle = 'none';
  stepList.style.margin = '0';
  stepList.style.padding = '0';
  stepList.style.display = 'contents';
  STEPS.forEach(([stepTitle, stepDescription], index) => {
    const number = index + 1;
    const step = node('li', { className: `step ${number === state.step ? 'active' : ''} ${number < state.step ? 'done' : ''}` });
    if (number === state.step) step.setAttribute('aria-current', 'step');
    step.append(
      node('div', { className: 'step-num', text: number < state.step ? '✓' : String(number) }),
      (() => {
        const copy = node('div');
        copy.append(node('div', { className: 'step-tt', text: stepTitle }), node('div', { className: 'step-sub', text: stepDescription }));
        return copy;
      })(),
    );
    stepList.append(step);
  });
  stepper.append(stepList);

  const panel = node('section', { className: 'panel' });
  const panelHead = node('div', { className: 'panel-head' });
  panelHead.append(node('div', { className: 'panel-h', text: title }), node('div', { className: 'panel-desc', text: description }));
  const body = node('div', { className: 'panel-body' });
  panel.append(panelHead, body);
  grid.append(stepper, panel);
  fragment.append(grid);
  return { fragment, body, panel };
}

const COACHING_STAGE_LABELS = [
  'Goal（目标）',
  'Reality（现状）',
  'Options（可选方案）',
  'Will（行动承诺）',
  'Situation（情境）',
  'Behavior（行为）',
  'Impact（影响）',
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeMarkdownSource(source) {
  return Array.isArray(source) ? source.join('\n') : source || '';
}

function rangeContaining(ranges, index) {
  return ranges.find(([start, end]) => index >= start && index < end);
}

function findBacktickRuns(markdown, excludedRanges) {
  const runs = [];
  let cursor = 0;
  while (cursor < markdown.length) {
    const opening = markdown.indexOf('`', cursor);
    if (opening === -1) break;
    const excluded = rangeContaining(excludedRanges, opening);
    if (excluded) {
      cursor = excluded[1];
      continue;
    }
    let length = 1;
    while (markdown[opening + length] === '`') length += 1;
    runs.push({ index: opening, length });
    cursor = opening + length;
  }
  return runs;
}

function findInlineCodeRanges(markdown, excludedRanges) {
  const runs = findBacktickRuns(markdown, excludedRanges);
  const ranges = [];
  let openingIndex = 0;
  while (openingIndex < runs.length) {
    const opening = runs[openingIndex];
    let closingIndex = openingIndex + 1;
    while (closingIndex < runs.length) {
      const closing = runs[closingIndex];
      const between = markdown.slice(opening.index + opening.length, closing.index);
      if (/\r?\n[ \t]*\r?\n/.test(between)) break;
      if (closing.length === opening.length) {
        ranges.push([opening.index, closing.index + closing.length]);
        openingIndex = closingIndex;
        break;
      }
      closingIndex += 1;
    }
    openingIndex += 1;
  }
  return ranges;
}

function consumeBlockquotePrefix(line, expectedDepth) {
  let cursor = 0;
  let depth = 0;
  while (expectedDepth === undefined || depth < expectedDepth) {
    const quote = line.slice(cursor).match(/^ {0,3}> ?/);
    if (!quote) break;
    cursor += quote[0].length;
    depth += 1;
  }
  if (expectedDepth !== undefined && depth !== expectedDepth) return null;
  return { cursor, depth };
}

function parseFenceOpening(line) {
  const quote = consumeBlockquotePrefix(line);
  let content = line.slice(quote.cursor);
  const leadingSpaces = content.match(/^ */)[0].length;
  if (leadingSpaces > 3) return null;
  content = content.slice(leadingSpaces);

  let listIndent = 0;
  const listPrefix = content.match(/^([-+*]|\d+[.)])( +)/);
  if (listPrefix) {
    listIndent = leadingSpaces + listPrefix[1].length + listPrefix[2].length;
    content = content.slice(listPrefix[0].length);
  }

  const opening = content.match(/^(`{3,}|~{3,})(.*)$/);
  if (!opening || (opening[1][0] === '`' && opening[2].includes('`'))) return null;
  return {
    marker: opening[1][0],
    length: opening[1].length,
    quoteDepth: quote.depth,
    listIndent,
  };
}

function isFenceClosingLine(line, fence) {
  const quote = consumeBlockquotePrefix(line, fence.quoteDepth);
  if (!quote) return false;
  let content = line.slice(quote.cursor);
  const leadingSpaces = content.match(/^ */)[0].length;
  if (fence.listIndent > 0) {
    if (leadingSpaces < fence.listIndent || leadingSpaces - fence.listIndent > 3) return false;
  } else if (leadingSpaces > 3) {
    return false;
  }
  content = content.slice(leadingSpaces);
  const closingFence = new RegExp(
    `^${escapeRegExp(fence.marker)}{${fence.length},}[ \\t]*$`,
  );
  return closingFence.test(content);
}

function inspectMarkdownLines(markdown) {
  const lines = [];
  const fencedRanges = [];
  let lineStart = 0;
  let fence = null;

  while (lineStart <= markdown.length) {
    const newline = markdown.indexOf('\n', lineStart);
    const lineEnd = newline === -1
      ? markdown.length
      : newline > lineStart && markdown[newline - 1] === '\r' ? newline - 1 : newline;
    const separatorEnd = newline === -1 ? markdown.length : newline + 1;
    const text = markdown.slice(lineStart, lineEnd);
    const line = { start: lineStart, end: lineEnd, text };
    lines.push(line);

    if (fence) {
      fencedRanges.push([lineStart, separatorEnd]);
      if (isFenceClosingLine(text, fence)) fence = null;
    } else {
      const openingFence = parseFenceOpening(text);
      if (openingFence) {
        fence = openingFence;
        fencedRanges.push([lineStart, separatorEnd]);
      }
    }

    if (newline === -1) break;
    lineStart = separatorEnd;
  }

  const protectedRanges = [
    ...fencedRanges,
    ...findInlineCodeRanges(markdown, fencedRanges),
  ];
  return { lines, protectedRanges };
}

function parseMarkdownPrefix(value, requireFullMatch = false) {
  const match = value.match(/^([ \t]*(?:(?:>[ \t]*)+)?)(?:([-+*]|\d+[.)])([ \t]+)|(#{1,6})([ \t]+))?/);
  if (!match || (requireFullMatch && match[0].length !== value.length)) return null;
  if (match[4]) return { continuation: match[1] };
  if (match[2]) {
    return { continuation: `${match[1]}${' '.repeat(match[2].length + match[3].length)}` };
  }
  return { continuation: match[1] };
}

function isCoachingStageBoundary(markdown, matchIndex, line) {
  if (parseMarkdownPrefix(markdown.slice(line.start, matchIndex), true)) return true;
  const before = markdown.slice(0, matchIndex).replace(/[ \t]+$/, '');
  return before.length === 0 || /[\r\n；;。]$/.test(before);
}

function formatCoachingStageMarkdown(source) {
  const markdown = normalizeMarkdownSource(source);
  const labels = COACHING_STAGE_LABELS.map(escapeRegExp).join('|');
  const stageLabel = new RegExp(
    `(?:(\\*\\*|__)(?:${labels})(?:\\1[ \\t]*[：:]|[ \\t]*[：:]\\1)|(?:${labels})[ \\t]*[：:])`,
    'g',
  );
  const lineBreak = markdown.includes('\r\n') ? '\r\n' : '\n';
  const { lines, protectedRanges } = inspectMarkdownLines(markdown);
  const insertions = [];
  let lineIndex = 0;
  let match;

  while ((match = stageLabel.exec(markdown)) !== null) {
    const matchIndex = match.index;
    if (protectedRanges.some(([start, end]) => matchIndex >= start && matchIndex < end)) continue;
    while (lineIndex + 1 < lines.length && matchIndex >= lines[lineIndex + 1].start) lineIndex += 1;

    const line = lines[lineIndex];
    if (!isCoachingStageBoundary(markdown, matchIndex, line)) continue;
    const prefix = parseMarkdownPrefix(markdown.slice(line.start, matchIndex), true);
    if (prefix) {
      const priorLineIsBlank = lineIndex === 0 || lines[lineIndex - 1].text.trim().length === 0;
      if (!priorLineIsBlank) insertions.push({ index: line.start, text: lineBreak });
      continue;
    }

    const continuation = parseMarkdownPrefix(line.text)?.continuation || '';
    insertions.push({ index: matchIndex, text: `${lineBreak}${lineBreak}${continuation}` });
  }

  let formatted = '';
  let cursor = 0;
  for (const insertion of insertions) {
    formatted += markdown.slice(cursor, insertion.index) + insertion.text;
    cursor = insertion.index;
  }
  formatted += markdown.slice(cursor);
  return formatted;
}

function markdownCard(parent, id, title, source, options = {}) {
  const card = node('section', { className: 'rcard' });
  card.append(node('h3', { className: 'rcard-h', text: title }));
  const content = node('div', { id });
  const markdown = normalizeMarkdownSource(source);
  window.renderMarkdown(
    content,
    options.separateCoachingStages ? formatCoachingStageMarkdown(markdown) : markdown,
  );
  card.append(content);
  parent.append(card);
}

function renderHome(root, state, handlers) {
  const section = node('section');
  section.append(
    node('div', { className: 'home-eyebrow', text: 'Management Compass · 管理团队' }),
    node('h1', { className: 'home-h1', text: '因材施教，给每个人对的辅导方式' }),
    node('p', { className: 'home-lead', text: '描述待辅导员工的表现与困扰。系统会先审查信息是否足够，再依次完成类型判定、方案生成和反馈迭代。' }),
  );
  const card = node('form', { className: 'hero-card', id: 'home-intake-form' });
  const basic = node('div', { className: 'grid2' });
  basic.append(
    selectField('home-role', '岗位类别', ['基层执行岗', '骨干/带教岗', '基层管理岗'], state.intake.role),
    selectField('home-tenure', '在团队入职时长', ['3 个月内（新人）', '3–12 个月', '1 年以上'], state.intake.tenure),
  );
  card.append(
    node('div', { className: 'home-eyebrow', text: '员工信息输入' }),
    basic,
    selectField('home-performance', '当前绩效状态', ['持续达标', '波动 / 时好时坏', '连续未达标'], state.intake.performance),
    textAreaField('home-goal', '绩效目标 / 上层期望', state.intake.goal, '例：季度内独立承接 3 个项目'),
    textAreaField('home-pain', '近期辅导困扰', state.intake.pain, '例：能力够但主动性差，交代的事不追就停'),
    textAreaField('home-traits', '员工特征补充', state.intake.traits, '补充可观察到的能力、意愿或行为证据'),
  );
  appendError(card, state.error);
  const submitLabel = state.intakeResult && state.intakeResult.sufficient
    ? '继续类型判定'
    : state.busy ? '正在审查…' : '审查信息';
  const submit = button('review-intake', submitLabel, () => {
    handlers.reviewIntake({
      role: document.getElementById('home-role').value,
      tenure: document.getElementById('home-tenure').value,
      performance: document.getElementById('home-performance').value,
      goal: document.getElementById('home-goal').value.trim(),
      pain: document.getElementById('home-pain').value.trim(),
      traits: document.getElementById('home-traits').value.trim(),
    });
  }, { accent: true, disabled: state.busy });
  card.append(submit);
  section.append(card);
  root.replaceChildren(section);
}

function renderIntake(root, state, handlers) {
  const { fragment, body, panel } = createWorkspace(state, '补充关键信息', '请补充系统列出的追问，以便继续完成类型判定。');
  const result = state.intakeResult || { questions: [] };
  body.append(node('div', { className: 'note', text: '请补充：' }));
  const note = body.lastElementChild;
  appendQuestions(note, result.questions);
  result.questions.forEach((question, index) => {
    const prior = state.answers.find((answer) => answer.question === question);
    body.append(textAreaField(`followup-${index}`, `追问 ${index + 1}`, prior ? prior.answer : '', question));
  });
  appendError(body, state.error);
  const footer = node('div', { className: 'panel-foot' });
  footer.append(button('review-intake-again', state.busy ? '正在审查…' : '再次审查', () => {
    const answers = result.questions.map((question, index) => ({
      question,
      answer: document.getElementById(`followup-${index}`).value.trim(),
    }));
    handlers.reviewAgain(answers);
  }, { accent: true, disabled: state.busy }));
  panel.append(footer);
  root.replaceChildren(fragment);
}

function renderClassification(root, state, handlers) {
  const { fragment, body, panel } = createWorkspace(state, '类型判定', '展示能力 × 意愿的结构化判定；类型名称始终来自预置标签。');
  const classification = state.classification;
  if (!classification) {
    body.append(node('div', { className: 'note', text: '信息已完整。请生成类型判定。' }));
    appendError(body, state.error);
    const footer = node('div', { className: 'panel-foot' });
    appendPreviousButton(footer, handlers);
    footer.append(button('generate-classification', state.busy ? '正在生成…' : '生成类型判定', handlers.generateClassification, { accent: true, disabled: state.busy }));
    panel.append(footer);
    root.replaceChildren(fragment);
    return;
  }

  const typeGrid = node('div', { className: 'typegrid' });
  if (classification.type_id) {
    const card = node('article', {
      id: `type-card-${classification.type_id}`,
      className: 'tcard match',
      text: typeLabel(classification.type_id),
    });
    card.setAttribute('aria-label', '判定类型');
    typeGrid.append(card);
  }
  body.append(typeGrid);

  const details = node('div', { className: 'rcard' });
  const rows = [
    [CLASSIFICATION_LABELS.status, classification.status],
    [CLASSIFICATION_LABELS.classification_confidence, classification.classification_confidence],
    [CLASSIFICATION_LABELS.ability, classification.ability],
    [CLASSIFICATION_LABELS.will, classification.will],
    [CLASSIFICATION_LABELS.strategy, classification.strategy],
    [CLASSIFICATION_LABELS.coach_mode, classification.coach_mode],
  ];
  rows.forEach(([label, value]) => {
    const row = node('p');
    row.append(node('strong', { text: `${label}：` }), document.createTextNode(value || '未提供'));
    details.append(row);
  });
  details.append(
    node('h3', { className: 'rcard-h', text: CLASSIFICATION_LABELS.reason }),
    node('p', { text: classification.reason || '未提供' }),
  );
  details.append(node('h3', { className: 'rcard-h', text: '判定证据' }));
  appendQuestions(details, classification.evidence);
  if (classification.questions.length > 0) {
    details.append(node('h3', { className: 'rcard-h', text: '仍需确认' }));
    appendQuestions(details, classification.questions);
  }
  body.append(details);
  appendError(body, state.error);

  const footer = node('div', { className: 'panel-foot' });
  appendPreviousButton(footer, handlers);
  if (classification.status === '已判定') {
    const label = state.plan ? '继续查看方案' : (state.busy ? '正在生成…' : '生成辅导方案');
    footer.append(button('generate-plan', label, handlers.generatePlan, {
      accent: true,
      disabled: state.busy,
    }));
  } else if (classification.status === '待人工确认') {
    footer.append(button('manual-confirmation', '人工确认', handlers.goHome, { secondary: true }));
  } else {
    footer.append(button('continue-supplement', '继续补充', handlers.continueSupplement, { secondary: true }));
  }
  panel.append(footer);
  root.replaceChildren(fragment);
}

function renderPlan(root, state, handlers) {
  const { fragment, body, panel } = createWorkspace(state, '教练方案生成', '方案按结构化字段展示；叙述性建议经过安全 Markdown 渲染。');
  const report = node('div', { className: 'report', id: 'coach-plan' });
  markdownCard(report, 'plan-entry', '沟通切入点', state.plan.entry);
  markdownCard(report, 'plan-cautions', '沟通注意事项', state.plan.cautions);
  const frequency = node('section', { className: 'rcard' });
  frequency.append(node('h3', { className: 'rcard-h', text: '建议沟通频率' }), node('p', { id: 'plan-frequency', text: state.plan.frequency || '' }));
  report.append(frequency);
  markdownCard(report, 'plan-gap-fix', '绩效差距修正方法', state.plan.gap_fix, { separateCoachingStages: true });
  markdownCard(report, 'plan-scripts', '话术示例', state.plan.scripts, { separateCoachingStages: true });
  body.append(report);
  appendError(body, state.error);
  const footer = node('div', { className: 'panel-foot' });
  appendPreviousButton(footer, handlers);
  footer.append(
    button('copy-plan', '复制方案', handlers.copyPlan, { secondary: true }),
    button('regenerate-plan', state.busy ? '正在生成…' : '换个角度', handlers.regeneratePlan, { secondary: true, disabled: state.busy }),
    button('go-feedback', '去反馈', handlers.goFeedback, { accent: true }),
  );
  panel.append(footer);
  root.replaceChildren(fragment);
}

function renderFeedback(root, state, handlers) {
  const { fragment, body, panel } = createWorkspace(state, '辅导反馈', '回填本次沟通后的情况，系统将给出下一步调整建议。');
  body.append(textAreaField('feedback-text', '本次沟通后的情况', state.feedbackText || '', '例：他愿意主动接一个模块，但仍担心做不好。'));
  appendError(body, state.error);
  if (state.feedback) {
    const output = node('div', { className: 'report', id: 'followout' });
    markdownCard(output, 'feedback-progress', '进展解读', state.feedback.progress_read);
    markdownCard(output, 'feedback-next-steps', '下一步建议', state.feedback.next_steps, { separateCoachingStages: true });
    markdownCard(output, 'feedback-watch-points', '观察要点', state.feedback.watch_points);
    body.append(output);
  } else {
    body.append(node('div', { id: 'followout' }));
  }
  const footer = node('div', { className: 'panel-foot' });
  appendPreviousButton(footer, handlers);
  footer.append(button('generate-feedback', state.busy ? '正在生成…' : '生成下一步建议', () => {
    handlers.generateFeedback(document.getElementById('feedback-text').value.trim());
  }, { accent: true, disabled: state.busy }));
  panel.append(footer);
  root.replaceChildren(fragment);
}

function renderBlocked(root, handlers) {
  const section = node('section', { className: 'hero-card' });
  section.append(
    node('div', { className: 'home-eyebrow', text: '需要人工处理' }),
    node('h1', { className: 'home-h1', text: '请暂停本次自动辅导' }),
    node('p', { className: 'home-lead', text: BLOCKED_MESSAGE }),
    button('blocked-back-home', '返回首页', handlers.goHome, { secondary: true }),
  );
  root.replaceChildren(section);
}

export function renderApp(root, state, handlers) {
  if (state.screen === 'home') return renderHome(root, state, handlers);
  if (state.screen === 'intake') return renderIntake(root, state, handlers);
  if (state.screen === 'classification') return renderClassification(root, state, handlers);
  if (state.screen === 'plan') return renderPlan(root, state, handlers);
  if (state.screen === 'feedback') return renderFeedback(root, state, handlers);
  return renderBlocked(root, handlers);
}
