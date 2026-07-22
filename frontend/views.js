import { CLASSIFICATION_LABELS } from './labels.js';
import {
  PUBLIC_PROFILES,
  publicProfileId,
  resolveFinalClassification,
} from './profile-selection.js';
import { composeTraits } from './state.js';

const STEPS = [
  ['员工信息输入', '特征 + 绩效期望'],
  ['类型判定', '匹配能力 × 意愿画像'],
  ['教练方案生成', '差异化建议'],
  ['辅导反馈', '会话内迭代'],
];

const TRAIT_KEYWORDS = [
  '学习能力强', '执行力弱', '主动性不足', '情绪易波动', '沟通抵触',
  '责任心强', '经验不足', '追求稳定', '有上进心', '需要认可',
];

const LOADING_CONTENT = Object.freeze({
  'intake-review': {
    title: '正在审查员工信息',
    items: ['检查资料完整性', '提取能力与意愿证据', '整理需要补充的问题'],
  },
  'classification-generate': {
    title: '正在匹配员工画像',
    items: ['分析能力与意愿证据', '匹配最接近的员工画像', '整理判断依据'],
  },
  'plan-generate': {
    title: '正在生成教练方案',
    items: ['读取最终确认画像', '组织 GROW/SBI 建议', '生成沟通方案'],
  },
  'plan-regenerate': {
    title: '正在重新生成方案',
    items: ['保留最终确认画像', '避开上一版角度', '生成新的沟通方案'],
  },
  'feedback-generate': {
    title: '正在生成下一步建议',
    items: ['分析本次沟通反馈', '识别进展与风险', '整理下一步行动'],
  },
});

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

function icon(name, className = 'ui-icon') {
  const image = document.createElement('img');
  image.className = className;
  image.src = `./assets/${name}.svg`;
  image.alt = '';
  image.setAttribute('aria-hidden', 'true');
  return image;
}

function appendIcon(control, name) {
  control.append(icon(name));
  return control;
}

function prependIcon(control, name) {
  control.prepend(icon(name));
  return control;
}

function appendPreviousButton(footer, handlers) {
  const previous = button('go-previous', '上一步', handlers.goPrevious, { secondary: true });
  previous.setAttribute('aria-label', '返回上一步');
  footer.append(previous);
}

function createPanelFooter() {
  const footer = node('div', { className: 'panel-foot' });
  const hint = node('span', { className: 'io-hint' });
  hint.append(icon('io'), document.createTextNode('输入 · AI动作 · 输出 均按功能清单落地'));
  footer.append(hint);
  return footer;
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

function createWorkspace(state, stage, kick, title, description, handlers) {
  const fragment = document.createDocumentFragment();
  const header = node('div', { className: 'ws-head' });
  const homeButton = node('button', {
    className: 'ws-back',
    id: 'workspace-return-home',
    type: 'button',
  });
  homeButton.setAttribute('aria-label', '返回首页');
  homeButton.append(icon('arrow-left'));
  homeButton.addEventListener('click', handlers.goHome);
  const workspaceTitle = node('div', { className: 'ws-title', text: '教练助手' });
  workspaceTitle.append(node('span', { className: 'tag', text: '管理团队' }));
  header.append(homeButton, workspaceTitle);
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
  panel.dataset.stage = stage;
  const panelHead = node('div', { className: 'panel-head' });
  panelHead.append(
    node('div', { className: 'panel-kick', text: kick }),
    node('div', { className: 'panel-h', text: title }),
    node('div', { className: 'panel-desc', text: description }),
  );
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
  const heading = node('h3', { className: 'rcard-h' });
  if (options.marker) heading.append(node('span', { className: 'n', text: options.marker }));
  heading.append(document.createTextNode(title));
  card.append(heading);
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
  const section = node('section', { className: 'welcome-page' });
  const flow = node('div', { className: 'hero-flow', id: 'welcome-flow' });
  ['信息输入', '类型判定', '方案生成', '辅导反馈'].forEach((label, index) => {
    flow.append(node('span', { className: 'flowchip', text: label }));
    if (index < 3) flow.append(node('span', { className: 'flowarr', text: '→' }));
  });
  const card = node('section', { className: 'hero-card welcome-card' });
  const startButton = button('start-coaching', '开始辅导', handlers.startCoaching, { accent: true });
  startButton.append(icon('arrow-right'));
  card.append(
    node('div', { className: 'home-eyebrow muted', text: '四步流程' }),
    flow,
    startButton,
  );
  section.append(
    node('div', { className: 'home-eyebrow', text: 'Management Compass · 管理团队' }),
    node('h1', { className: 'home-h1', text: '因材施教，给每个人对的辅导方式' }),
    node('p', {
      className: 'home-lead',
      text: '描述一位待辅导员工，AI 按“能力 × 意愿”匹配 4 类画像，输出差异化的沟通与教练方案：说什么、注意什么、多久沟通一次、如何修正绩效差距。',
    }),
    card,
  );
  root.replaceChildren(section);
}

function createLoadingOverlay(action) {
  const content = LOADING_CONTENT[action];
  if (!content) return null;
  const overlay = node('div', { className: 'loading-overlay' });
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  overlay.append(
    node('div', { className: 'loading-spinner' }),
    node('div', { className: 'loading-title', text: content.title }),
    node('div', { className: 'loading-subtitle', text: '正在处理，请稍候…' }),
  );
  const list = node('ul', { className: 'loading-items' });
  for (const item of content.items) list.append(node('li', { text: item }));
  overlay.append(list);
  return overlay;
}

function applyLoadingPresentation(root, state) {
  const body = root.querySelector('.panel-body');
  if (!body) return;
  body.setAttribute('aria-busy', String(state.busy));
  if (!state.busy) return;
  const overlay = createLoadingOverlay(state.busyAction);
  if (!overlay) return;
  for (const child of body.children) child.inert = true;
  body.append(overlay);
}

function intakeGroupTitle(number, title, hint, tone = 'pill-y') {
  const heading = node('div', { className: 'flabel intake-section-title' });
  heading.append(
    node('span', { className: `pill ${tone}`, text: String(number) }),
    document.createTextNode(title),
  );
  if (hint) heading.append(node('span', { className: 'dim', text: hint }));
  return heading;
}

function intakeSelectField(id, labelText, options, value) {
  const wrap = node('div', { className: 'intake-control' });
  const label = node('label', { className: 'step-sub', text: labelText, htmlFor: id });
  const select = node('select', { id, value: value || options[0] });
  for (const optionText of options) select.append(node('option', { text: optionText, value: optionText }));
  select.value = value || options[0];
  wrap.append(label, select);
  return wrap;
}

function intakeTextAreaField(id, labelText, value, placeholder) {
  const wrap = node('div', { className: 'intake-control' });
  const label = node('label', { className: 'step-sub', text: labelText, htmlFor: id });
  const input = node('textarea', { id, value: value || '' });
  input.placeholder = placeholder;
  wrap.append(label, input);
  return wrap;
}

function renderIntake(root, state, handlers) {
  const { fragment, body, panel } = createWorkspace(
    state,
    'intake',
    '节点 ① · 输入',
    '员工信息输入',
    '分三部分描述这位待辅导员工。信息不足时，系统会继续追问关键项。',
    handlers,
  );
  const basicSection = node('section', { className: 'field intake-section' });
  const basic = node('div', { className: 'grid2' });
  basic.append(
    intakeSelectField('home-role', '岗位类别', ['基层执行岗', '骨干/带教岗', '基层管理岗'], state.intake.role),
    intakeSelectField('home-tenure', '在团队入职时长', ['3 个月内（新人）', '3–12 个月', '1 年以上'], state.intake.tenure),
  );
  const performance = intakeSelectField('home-performance', '当前绩效状态', ['持续达标', '波动 / 时好时坏', '连续未达标'], state.intake.performance);
  performance.classList.add('intake-control-wide');
  basicSection.append(intakeGroupTitle(1, '员工基础信息'), basic, performance);

  const goalSection = node('section', { className: 'field intake-section' });
  const goal = intakeTextAreaField('home-goal', '绩效目标 / 上层期望', state.intake.goal, '例：季度内独立承接 3 个项目，达成 90% 交付准时率');
  const pain = intakeTextAreaField('home-pain', '近期辅导困扰', state.intake.pain, '例：能力够但主动性差，交代的事不追就停，沟通易抵触');
  pain.classList.add('intake-control-spaced');
  goalSection.append(intakeGroupTitle(2, '目标与困扰', '', 'pill-t'), goal, pain);

  const traitsSection = node('section', { className: 'field intake-section' });
  const chipset = node('div', { className: 'chipset' });
  for (const keyword of TRAIT_KEYWORDS) {
    const selected = state.selectedTraits.includes(keyword);
    const chip = node('button', {
      className: `chip ${selected ? 'sel' : ''}`,
      text: keyword,
      type: 'button',
    });
    chip.setAttribute('aria-pressed', String(selected));
    chip.addEventListener('click', () => {
      const isSelected = handlers.toggleTrait(keyword);
      chip.classList.toggle('sel', isSelected);
      chip.setAttribute('aria-pressed', String(isSelected));
    });
    chipset.append(chip);
  }
  const traitNote = node('textarea', { id: 'home-traits', value: state.traitNote || '' });
  traitNote.placeholder = '补充描述（选填）';
  traitNote.setAttribute('aria-label', '员工特征补充');
  traitNote.addEventListener('input', (event) => handlers.updateTraitNote(event.target.value));
  traitsSection.append(
    intakeGroupTitle(3, '员工特征描述', '勾选关键词，或补充自由文本'),
    chipset,
    traitNote,
  );
  body.append(
    basicSection,
    goalSection,
    traitsSection,
  );
  const result = state.intakeResult || { questions: [] };
  if (result.questions.length > 0) {
    body.append(node('div', { className: 'note', text: '请补充：' }));
    appendQuestions(body.lastElementChild, result.questions);
    result.questions.forEach((question, index) => {
      const prior = state.answers.find((answer) => answer.question === question);
      body.append(textAreaField(`followup-${index}`, `追问 ${index + 1}`, prior ? prior.answer : '', question));
    });
  }
  appendError(body, state.error);

  const intakeValues = () => ({
      role: document.getElementById('home-role').value,
      tenure: document.getElementById('home-tenure').value,
      performance: document.getElementById('home-performance').value,
      goal: document.getElementById('home-goal').value.trim(),
      pain: document.getElementById('home-pain').value.trim(),
      traits: composeTraits(state.selectedTraits, document.getElementById('home-traits').value),
  });

  const footer = createPanelFooter();
  if (result.questions.length > 0) {
    footer.append(button('review-intake-again', state.busy ? '正在审查…' : '再次审查', () => {
      const answers = result.questions.map((question, index) => ({
        question,
        answer: document.getElementById(`followup-${index}`).value.trim(),
      }));
      handlers.reviewIntake(intakeValues(), answers);
    }, { accent: true, disabled: state.busy }));
  } else {
    const submitLabel = result.sufficient
      ? '继续类型判定'
      : state.busy ? '正在判定…' : '判定类型';
    const submit = button('review-intake', submitLabel, () => {
      handlers.reviewIntake(intakeValues());
    }, { accent: true, disabled: state.busy });
    if (!result.sufficient && !state.busy) appendIcon(submit, 'arrow-right');
    footer.append(submit);
  }
  panel.append(footer);
  root.replaceChildren(fragment);
}

function renderClassification(root, state, handlers) {
  const { fragment, body, panel } = createWorkspace(
    state,
    'classification',
    '节点 ② · AI动作',
    '类型判定',
    '基于“能力 × 意愿”预置的 4 类画像，AI 匹配到最接近的一类并说明依据。你可确认或改选。',
    handlers,
  );
  const classification = state.classification;
  if (!classification) {
    body.append(node('div', { className: 'note', text: '信息已完整。请生成类型判定。' }));
    appendError(body, state.error);
    const footer = createPanelFooter();
    appendPreviousButton(footer, handlers);
    footer.append(button('generate-classification', state.busy ? '正在生成…' : '生成类型判定', handlers.generateClassification, { accent: true, disabled: state.busy }));
    panel.append(footer);
    root.replaceChildren(fragment);
    return;
  }

  let finalClassification = classification;
  if (classification.status !== '已判定') {
    body.append(node('div', {
      className: 'note classification-status',
      text: classification.status,
    }));
  }
  if (classification.status === '已判定') {
    const profileNote = node('div', { className: 'note classification-note' });
    profileNote.append(
      icon('info', 'ui-icon note-icon'),
      node('div', { text: '4 类画像名称与关键词来自知识库，最终方案以本次确认画像为准。' }),
    );
    body.append(profileNote);
    const typeGrid = node('div', { className: 'typegrid' });
    typeGrid.setAttribute('role', 'radiogroup');
    typeGrid.setAttribute('aria-label', '员工画像选择');
    const aiProfileId = publicProfileId(classification.type_id);
    const selectedProfileId = state.selectedProfileId || aiProfileId;

    for (const profile of PUBLIC_PROFILES) {
      const card = button(
        `type-card-${profile.id}`,
        '',
        () => handlers.selectProfile(profile.id),
        { secondary: true },
      );
      card.className = `tcard ${profile.id === selectedProfileId ? 'selected' : ''}`;
      card.dataset.profileId = profile.id;
      card.setAttribute('role', 'radio');
      card.setAttribute('aria-checked', String(profile.id === selectedProfileId));
      card.setAttribute('aria-label', `${profile.ability}能力${profile.will}意愿，${profile.name}`);
      card.append(
        node('div', { className: 'qbadge', text: `${profile.ability}能力 · ${profile.will}意愿` }),
        node('div', { className: 'tcard-name', text: profile.name }),
        node('div', { className: 'tcard-kw', text: profile.description }),
      );
      if (profile.id === aiProfileId) {
        card.append(node('span', {
          className: 'ai-matchflag',
          text: profile.id === selectedProfileId ? '最匹配' : 'AI推荐',
        }));
      }
      if (profile.id === selectedProfileId && profile.id !== aiProfileId) {
        card.append(node('span', { className: 'selected-flag', text: '已选' }));
      }
      typeGrid.append(card);
    }
    body.append(typeGrid);
    finalClassification = resolveFinalClassification(
      classification,
      selectedProfileId,
      state.intake,
    );
  }

  const details = node('section', { className: 'rcard classification-details' });
  const reasoning = node('div', { className: 'reasoning classification-reasoning' });
  reasoning.append(
    node('h3', { className: 'rcard-h classification-reason-title', text: CLASSIFICATION_LABELS.reason }),
    (() => {
      const reason = node('p');
      reason.append(
        node('strong', { text: '判定依据：' }),
        document.createTextNode(finalClassification.reason || '未提供'),
      );
      return reason;
    })(),
  );
  if (Array.isArray(classification.evidence) && classification.evidence.length > 0) {
    const evidence = node('p', { className: 'classification-evidence' });
    evidence.append(
      node('strong', { text: '判定证据：' }),
      document.createTextNode(classification.evidence.join('；')),
    );
    reasoning.append(evidence);
  }
  if (classification.questions.length > 0) {
    const questions = node('div', { className: 'classification-questions' });
    questions.append(node('h3', { className: 'rcard-h', text: '仍需确认' }));
    appendQuestions(questions, classification.questions);
    reasoning.append(questions);
  }
  details.append(reasoning);
  body.append(details);
  appendError(body, state.error);

  const footer = createPanelFooter();
  appendPreviousButton(footer, handlers);
  if (classification.status === '已判定') {
    const label = state.plan ? '查看方案' : (state.busy ? '正在生成…' : '生成方案');
    const generate = button('generate-plan', label, handlers.generatePlan, {
      accent: true,
      disabled: state.busy,
    });
    generate.setAttribute('aria-label', state.plan ? '继续查看方案' : '生成辅导方案');
    if (!state.busy) appendIcon(generate, 'arrow-right');
    footer.append(generate);
  } else if (classification.status === '待人工确认') {
    footer.append(button('manual-confirmation', '人工确认', handlers.goHome, { secondary: true }));
  } else {
    footer.append(button('continue-supplement', '继续补充', handlers.continueSupplement, { secondary: true }));
  }
  panel.append(footer);
  root.replaceChildren(fragment);
}

function renderPlan(root, state, handlers) {
  const profileId = state.selectedProfileId || publicProfileId(state.classification?.type_id);
  const profile = PUBLIC_PROFILES.find(({ id }) => id === profileId);
  const { fragment, body, panel } = createWorkspace(
    state,
    'plan',
    '节点 ③ · 输出',
    '教练方案生成',
    `针对“${profile?.name || '当前画像'}”生成的差异化方案。可复制，或让 AI 换个角度重出。`,
    handlers,
  );
  const report = node('div', { className: 'report', id: 'coach-plan' });
  markdownCard(report, 'plan-entry', '沟通切入点', state.plan.entry, { marker: '切' });
  markdownCard(report, 'plan-cautions', '沟通注意事项', state.plan.cautions, { marker: '注' });
  const frequency = node('section', { className: 'rcard' });
  const frequencyHeading = node('h3', { className: 'rcard-h' });
  frequencyHeading.append(node('span', { className: 'n', text: '频' }), document.createTextNode('建议沟通频率'));
  frequency.append(frequencyHeading, node('p', { id: 'plan-frequency', text: state.plan.frequency || '' }));
  report.append(frequency);
  markdownCard(report, 'plan-gap-fix', '绩效差距修正方法', state.plan.gap_fix, {
    marker: '修',
    separateCoachingStages: true,
  });
  markdownCard(report, 'plan-scripts', '话术示例', state.plan.scripts, {
    marker: '话',
    separateCoachingStages: true,
  });
  body.append(report);
  appendError(body, state.error);
  const footer = createPanelFooter();
  appendPreviousButton(footer, handlers);
  const copy = button('copy-plan', '复制方案', handlers.copyPlan, { secondary: true });
  copy.classList.add('btn-sm');
  prependIcon(copy, 'copy');
  const regenerate = button('regenerate-plan', state.busy ? '正在生成…' : '换个角度', handlers.regeneratePlan, { secondary: true, disabled: state.busy });
  regenerate.classList.add('btn-sm');
  if (!state.busy) prependIcon(regenerate, 'refresh');
  const feedback = button('go-feedback', '去反馈', handlers.goFeedback, { accent: true });
  appendIcon(feedback, 'arrow-right');
  footer.append(
    copy,
    regenerate,
    feedback,
  );
  panel.append(footer);
  root.replaceChildren(fragment);
}

function renderFeedback(root, state, handlers) {
  const { fragment, body, panel } = createWorkspace(
    state,
    'feedback',
    '节点 ④ · 会话内迭代',
    '辅导反馈',
    '回填本次沟通后的情况，AI 基于记录给出下一步调整建议。记录仅在本次会话内留存。',
    handlers,
  );
  body.append(textAreaField('feedback-text', '本次沟通后的情况', state.feedbackText || '', '例：按赋权式沟通谈了一次，他愿意主动接一个模块，但仍担心做不好。'));
  const generate = button('generate-feedback', state.busy ? '正在生成…' : '生成下一步建议', () => {
    handlers.generateFeedback(document.getElementById('feedback-text').value.trim());
  }, { accent: true, disabled: state.busy });
  generate.classList.add('btn-sm', 'feedback-generate');
  if (!state.busy) prependIcon(generate, 'refresh-light');
  body.append(generate);
  appendError(body, state.error);
  let output;
  if (state.feedback) {
    output = node('div', { className: 'report feedback-output', id: 'followout' });
    markdownCard(output, 'feedback-progress', '进展解读', state.feedback.progress_read);
    markdownCard(output, 'feedback-next-steps', '下一步建议', state.feedback.next_steps, { separateCoachingStages: true });
    markdownCard(output, 'feedback-watch-points', '观察要点', state.feedback.watch_points);
  } else {
    output = node('div', { className: 'feedback-output', id: 'followout' });
  }
  body.append(output);

  const finalClassification = resolveFinalClassification(
    state.classification,
    state.selectedProfileId || publicProfileId(state.classification?.type_id),
    state.intake,
  );
  const profile = PUBLIC_PROFILES.find(({ id }) => id === publicProfileId(finalClassification?.type_id));
  const rawEntry = Array.isArray(state.plan?.entry) ? state.plan.entry[0] : state.plan?.entry;
  const entrySummary = String(rawEntry || '').replace(/[\*_`#]/g, '').trim();
  const planRecord = [entrySummary, state.plan?.frequency].filter(Boolean).join(' · ');
  const log = node('section', { className: 'session-log' });
  log.append(node('div', { className: 'flabel session-log-title', text: '会话内辅导记录' }));
  const typeItem = node('div', { className: 'logitem' });
  typeItem.append(
    node('div', { className: 'who', text: '类型判定' }),
    document.createTextNode(`${profile?.name || '未判定'} · ${finalClassification?.ability || '未判定'}能力${finalClassification?.will || '未判定'}意愿`),
  );
  const planItem = node('div', { className: 'logitem' });
  planItem.append(
    node('div', { className: 'who', text: '首次方案' }),
    document.createTextNode(planRecord || '暂无方案摘要'),
  );
  log.append(typeItem, planItem);
  body.append(log);
  const footer = createPanelFooter();
  appendPreviousButton(footer, handlers);
  const complete = button('complete-coaching', '完成辅导', handlers.goHome, { accent: true });
  appendIcon(complete, 'arrow-right');
  footer.append(complete);
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
  if (state.screen === 'home') renderHome(root, state, handlers);
  else if (state.screen === 'intake') renderIntake(root, state, handlers);
  else if (state.screen === 'classification') renderClassification(root, state, handlers);
  else if (state.screen === 'plan') renderPlan(root, state, handlers);
  else if (state.screen === 'feedback') renderFeedback(root, state, handlers);
  else renderBlocked(root, handlers);
  applyLoadingPresentation(root, state);
}
