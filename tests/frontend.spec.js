const { test, expect } = require('@playwright/test');
const {
  coachingPlan,
  classifiedAs,
  defaultFixtures,
  envelope,
  nextPlan,
} = require('./fixtures/coach-responses.js');

async function mockCoachApi(page, fixtures = defaultFixtures()) {
  const requests = [];
  await page.route('**/api/coach/**', async (route) => {
    const request = route.request();
    const method = new URL(request.url()).pathname.split('/').pop();
    const body = request.postDataJSON();
    requests.push({ method, body });
    const queue = fixtures[method] || [
      { ok: false, code: 'NOT_FOUND', message: '接口不存在。' },
    ];
    const candidate = queue.length > 1 ? queue.shift() : queue[0];
    const response = typeof candidate === 'function'
      ? await candidate({ route, request })
      : candidate;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) });
  });
  return requests;
}

function deferredFixture(response) {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  return {
    handler: async () => {
      await gate;
      return response;
    },
    release,
  };
}

async function openIntake(page) {
  await expect(page.getByRole('heading', { name: '因材施教，给每个人对的辅导方式' }))
    .toBeVisible();
  await page.getByRole('button', { name: '开始辅导' }).click();
  await expect(page.locator('.panel-h')).toHaveText('员工信息输入');
}

async function fillHome(page) {
  await openIntake(page);
  await page.getByLabel('岗位类别').selectOption({ label: '骨干/带教岗' });
  await page.getByLabel('在团队入职时长').selectOption({ label: '1 年以上' });
  await page.getByLabel('当前绩效状态').selectOption({ label: '持续达标' });
  await page.getByLabel('绩效目标 / 上层期望').fill('独立承接三个项目');
  await page.getByLabel('近期辅导困扰').fill('交代的事不追就停');
  await page.getByLabel('员工特征补充').fill('能够独立交付复杂任务，但近期主动性不足。');
}

async function advanceToClassification(page, fixtures) {
  const requests = await mockCoachApi(page, fixtures);
  await page.goto('/');
  await fillHome(page);
  await page.getByRole('button', { name: '判定类型' }).click();
  await expect(page.getByText('请补充：是否已做过针对性辅导？')).toBeVisible();
  await page.getByLabel('追问 1').fill('尚未做过。');
  await page.getByRole('button', { name: '再次审查' }).click();
  await expect(page.getByRole('button', { name: '生成类型判定' })).toBeEnabled();
  await page.getByRole('button', { name: '生成类型判定' }).click();
  await expect(page.locator('.panel-h')).toHaveText('类型判定');
  return requests;
}

async function advanceToPlan(page, fixtures) {
  const requests = await advanceToClassification(page, fixtures);
  await page.getByRole('button', { name: '生成辅导方案' }).click();
  await expect(page.locator('.panel-h')).toHaveText('教练方案生成');
  return requests;
}

async function mountMarkdownFixture(page, markdown) {
  await page.goto('/');
  await page.evaluate((source) => {
    const fixture = document.createElement('section');
    fixture.id = 'markdown-fixture';
    document.body.appendChild(fixture);
    window.renderMarkdown(fixture, source);
  }, markdown);
}

async function expectStageLabelsInSeparateParagraphs(container, labels) {
  await expect(container.locator('p').first()).toBeVisible();
  const paragraphTexts = await container.locator('p').allTextContents();
  for (const label of labels) {
    const matchingParagraphs = paragraphTexts.filter((text) => text.includes(label));
    expect(matchingParagraphs).toHaveLength(1);
    for (const otherLabel of labels.filter((candidate) => candidate !== label)) {
      expect(matchingParagraphs[0]).not.toContain(otherLabel);
    }
  }
}

async function expectRectNear(locator, expected, tolerance = 2) {
  const rect = await locator.evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  });
  for (const [key, value] of Object.entries(expected)) {
    expect(Math.abs(rect[key] - value), `${key}: expected ${value}, received ${rect[key]}`)
      .toBeLessThanOrEqual(tolerance);
  }
}

test('页面和健康检查由同一服务提供', async ({ page, request }) => {
  const health = await request.get('/api/health');

  expect(health.ok()).toBe(true);
  expect(await health.json()).toEqual({ ok: true });
  await page.goto('/');
  expect(new URL(page.url()).origin).toBe(new URL(health.url()).origin);
});

test('欢迎页展示四步流程并在点击后进入员工信息输入', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '因材施教，给每个人对的辅导方式' }))
    .toBeVisible();
  await expect(page.locator('.hero-flow .flowchip')).toHaveText([
    '信息输入', '类型判定', '方案生成', '辅导反馈',
  ]);
  await expect(page.getByLabel('绩效目标 / 上层期望')).toHaveCount(0);

  await openIntake(page);
  await expect(page.getByLabel('绩效目标 / 上层期望')).toBeVisible();
});

test('桌面欢迎页在固定视口对齐参考品牌、文案、流程颜色和关键几何', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');

  await expect(page).toHaveTitle('管理团队-教练助手');
  await expect(page.locator('.brand-mark img')).toHaveAttribute('src', /coach-team\.svg$/);
  await expect(page.locator('#start-coaching img')).toHaveAttribute('src', /arrow-right\.svg$/);
  await expect(page.locator('.brand-name')).toHaveText('管理团队-教练助手');
  await expect(page.locator('.brand-sub')).toHaveText('能力 × 意愿画像 · 差异化辅导');
  await expect(page.locator('.home-lead')).toHaveText(
    '描述一位待辅导员工，AI 按“能力 × 意愿”匹配 4 类画像，输出差异化的沟通与教练方案：说什么、注意什么、多久沟通一次、如何修正绩效差距。',
  );

  const colors = await page.locator('.hero-flow').evaluate((flow) => {
    const chip = getComputedStyle(flow.querySelector('.flowchip'));
    const arrow = getComputedStyle(flow.querySelector('.flowarr'));
    return {
      chipBackground: chip.backgroundColor,
      chipColor: chip.color,
      arrowColor: arrow.color,
    };
  });
  expect(colors).toEqual({
    chipBackground: 'rgb(251, 238, 221)',
    chipColor: 'rgb(201, 117, 43)',
    arrowColor: 'rgb(224, 214, 225)',
  });

  await expectRectNear(page.locator('.topbar'), { x: 0, y: 0, width: 1920, height: 70.78125 });
  await expectRectNear(page.locator('.wrap'), { x: 400, y: 70.78125, width: 1120 });
  await expectRectNear(page.locator('.home-h1'), { x: 428, y: 134.78125, width: 1064, height: 48 });
  await expectRectNear(page.locator('.home-lead'), { x: 428, y: 198.78125, width: 600, height: 51.1875 });
  await expectRectNear(page.locator('.hero-card'), { x: 428, y: 275.96875, width: 680, height: 179.796875 });
});

test('员工特征纯函数按关键词和补充文本合成现有 traits 字段', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { composeTraits } = await import('/state.js');
    return [
      composeTraits(['学习能力强', '主动性不足'], ''),
      composeTraits([], '能够独立交付复杂任务。'),
      composeTraits(['学习能力强', '主动性不足'], '能够独立交付复杂任务。'),
      composeTraits([], ''),
    ];
  });

  expect(result).toEqual([
    '学习能力强、主动性不足',
    '能够独立交付复杂任务。',
    '关键词：学习能力强、主动性不足。补充描述：能够独立交付复杂任务。',
    '',
  ]);
});

test('加载动作有固定枚举且结束 busy 时会清空当前动作', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const loading = await import('/loading.js');
    const state = await import('/state.js');
    state.resetSession();
    state.setBusy(true, loading.BUSY_ACTIONS.PLAN_REGENERATE);
    const active = {
      busy: state.session.busy,
      action: state.session.busyAction,
      remaining: loading.remainingLoadingDelay(100, 250),
    };
    state.setBusy(false);
    const finished = {
      busy: state.session.busy,
      action: state.session.busyAction,
    };
    return { active, finished };
  });

  expect(result).toEqual({
    active: { busy: true, action: 'plan-regenerate', remaining: 150 },
    finished: { busy: false, action: null },
  });
});

test('员工信息审查期间显示可访问的内容面板加载层', async ({ page }) => {
  const fixtures = defaultFixtures();
  const delayed = deferredFixture(fixtures.intake[0]);
  fixtures.intake[0] = delayed.handler;
  await mockCoachApi(page, fixtures);
  await page.goto('/');
  await fillHome(page);

  await page.getByRole('button', { name: '判定类型' }).click();
  const overlay = page.locator('.loading-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveAttribute('role', 'status');
  await expect(page.locator('.panel-body')).toHaveAttribute('aria-busy', 'true');
  await expect(overlay.getByText('正在审查员工信息')).toBeVisible();
  await expect(page.locator('#workspace-return-home')).toBeEnabled();

  delayed.release();
  await expect(overlay).toHaveCount(0);
  await expect(page.locator('.panel-body')).toHaveAttribute('aria-busy', 'false');
});

test('类型判定期间显示匹配画像文案且返回上一步会取消加载', async ({ page }) => {
  const fixtures = defaultFixtures();
  const delayed = deferredFixture(fixtures.classify[0]);
  fixtures.classify[0] = delayed.handler;
  await mockCoachApi(page, fixtures);
  await page.goto('/');
  await fillHome(page);
  await page.getByRole('button', { name: '判定类型' }).click();
  await page.getByLabel('追问 1').fill('尚未做过。');
  await page.getByRole('button', { name: '再次审查' }).click();
  await page.getByRole('button', { name: '生成类型判定' }).click();

  await expect(page.getByText('正在匹配员工画像')).toBeVisible();
  await page.getByRole('button', { name: '返回上一步' }).click();
  await expect(page.locator('.panel-h')).toHaveText('员工信息输入');
  await expect(page.locator('.loading-overlay')).toHaveCount(0);

  delayed.release();
  await page.waitForTimeout(350);
  await expect(page.locator('.panel-h')).toHaveText('员工信息输入');
});

test('首次方案生成期间显示教练方案加载文案', async ({ page }) => {
  const fixtures = defaultFixtures();
  const delayed = deferredFixture(fixtures.plan[0]);
  fixtures.plan[0] = delayed.handler;
  await advanceToClassification(page, fixtures);

  await page.getByRole('button', { name: '生成辅导方案' }).click();
  await expect(page.getByText('正在生成教练方案')).toBeVisible();
  delayed.release();
  await expect(page.locator('.panel-h')).toHaveText('教练方案生成');
  await expect(page.getByText('正在生成教练方案')).toHaveCount(0);
});

test('换个角度期间显示重新生成方案文案', async ({ page }) => {
  const fixtures = defaultFixtures();
  const delayed = deferredFixture(fixtures.plan[1]);
  fixtures.plan[1] = delayed.handler;
  await advanceToPlan(page, fixtures);
  await page.getByRole('button', { name: '换个角度' }).click();
  await expect(page.getByText('正在重新生成方案')).toBeVisible();
  delayed.release();
  await expect(page.getByText('正在重新生成方案')).toHaveCount(0);
});

test('反馈生成期间显示下一步建议文案并在接口失败后关闭', async ({ page }) => {
  const fixtures = defaultFixtures();
  const delayed = deferredFixture({ ok: false, blocked: false, message: '模型暂时不可用。' });
  fixtures.feedback[0] = delayed.handler;
  await advanceToPlan(page, fixtures);
  await page.getByRole('button', { name: '去反馈' }).click();
  await page.getByLabel('本次沟通后的情况').fill('员工愿意承担任务，但仍需要提醒。');
  await page.getByRole('button', { name: '生成下一步建议' }).click();
  await expect(page.getByText('正在生成下一步建议')).toBeVisible();
  delayed.release();
  await expect(page.locator('.loading-overlay')).toHaveCount(0);
  await expect(page.getByText('模型暂时不可用。')).toBeVisible();
});

test('快速响应时加载层仍避免闪烁且减少动态效果会停止旋转', async ({ page }) => {
  await mockCoachApi(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await fillHome(page);
  const startedAt = Date.now();
  await page.getByRole('button', { name: '判定类型' }).click();
  await expect(page.getByText('请补充：是否已做过针对性辅导？')).toBeVisible();
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(250);

  const animation = await page.evaluate(() => {
    const spinner = document.createElement('div');
    spinner.className = 'loading-spinner';
    document.body.append(spinner);
    const value = getComputedStyle(spinner).animationName;
    spinner.remove();
    return value;
  });
  expect(animation).toBe('none');
});

test('桌面员工输入页对齐参考结构并把可访问关键词真实提交到 intake', async ({ page }) => {
  const requests = await mockCoachApi(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await openIntake(page);

  await expect(page.locator('#workspace-return-home img')).toHaveAttribute('src', /arrow-left\.svg$/);
  await expect(page.locator('.ws-title .tag')).toHaveText('管理团队');
  await expect(page.locator('.intake-section')).toHaveCount(3);
  await expect(page.locator('.intake-section-title')).toHaveText([
    '1员工基础信息', '2目标与困扰', '3员工特征描述勾选关键词，或补充自由文本',
  ]);
  const chips = page.locator('.chipset .chip');
  await expect(chips).toHaveText([
    '学习能力强', '执行力弱', '主动性不足', '情绪易波动', '沟通抵触',
    '责任心强', '经验不足', '追求稳定', '有上进心', '需要认可',
  ]);
  await expect(chips.first()).toHaveAttribute('aria-pressed', 'false');
  await chips.first().click();
  await chips.nth(1).focus();
  await page.keyboard.press('Enter');
  await expect(chips.first()).toHaveAttribute('aria-pressed', 'true');
  await expect(chips.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('员工特征补充').fill('能够独立交付复杂任务。');

  await page.getByLabel('绩效目标 / 上层期望').fill('独立承接三个项目');
  await page.getByLabel('近期辅导困扰').fill('交代的事不追就停');
  await page.getByRole('button', { name: '判定类型' }).click();
  await expect(page.getByText('请补充：是否已做过针对性辅导？')).toBeVisible();

  expect(requests[0].body.intake.traits)
    .toBe('关键词：学习能力强、执行力弱。补充描述：能够独立交付复杂任务。');
  await expect(page.locator('.chipset .chip').first()).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.chipset .chip').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('员工特征补充')).toHaveValue('能够独立交付复杂任务。');

  await expectRectNear(page.locator('.ws-head'), { x: 428, y: 104.78125, width: 1064, height: 38 });
  await expectRectNear(page.locator('.ws-grid'), { x: 428, y: 166.78125, width: 1064 });
  await expectRectNear(page.locator('.stepper'), { x: 428, y: 166.78125, width: 236, height: 275.125 });
  await expectRectNear(page.locator('.panel'), { x: 690, y: 166.78125, width: 802 });
});

test('选择关键词不会重置尚未提交的员工基础信息和目标困扰', async ({ page }) => {
  await page.goto('/');
  await openIntake(page);

  await page.getByLabel('岗位类别').selectOption({ label: '骨干/带教岗' });
  await page.getByLabel('在团队入职时长').selectOption({ label: '1 年以上' });
  await page.getByLabel('当前绩效状态').selectOption({ label: '波动 / 时好时坏' });
  await page.getByLabel('绩效目标 / 上层期望').fill('本季度独立承接三个项目');
  await page.getByLabel('近期辅导困扰').fill('任务需要反复提醒才推进');
  await page.getByLabel('员工特征补充').fill('最近开始主动提出改进建议。');

  const responsibility = page.locator('.chipset .chip').filter({ hasText: '责任心强' });
  await responsibility.click();
  const recognition = page.locator('.chipset .chip').filter({ hasText: '需要认可' });
  await recognition.focus();
  await page.keyboard.press('Enter');

  await expect(page.getByLabel('岗位类别')).toHaveValue('骨干/带教岗');
  await expect(page.getByLabel('在团队入职时长')).toHaveValue('1 年以上');
  await expect(page.getByLabel('当前绩效状态')).toHaveValue('波动 / 时好时坏');
  await expect(page.getByLabel('绩效目标 / 上层期望')).toHaveValue('本季度独立承接三个项目');
  await expect(page.getByLabel('近期辅导困扰')).toHaveValue('任务需要反复提醒才推进');
  await expect(page.getByLabel('员工特征补充')).toHaveValue('最近开始主动提出改进建议。');
  await expect(responsibility).toHaveAttribute('aria-pressed', 'true');
  await expect(recognition).toHaveAttribute('aria-pressed', 'true');
});

test('员工关键词和补充文本返回上一步保留而返回首页与刷新清空', async ({ page }) => {
  await mockCoachApi(page);
  await page.goto('/');
  await openIntake(page);
  await page.locator('.chipset .chip').filter({ hasText: '责任心强' }).click();
  await page.getByLabel('员工特征补充').fill('主动承担跨组协作。');
  await page.getByLabel('绩效目标 / 上层期望').fill('独立承接三个项目');
  await page.getByLabel('近期辅导困扰').fill('交代的事不追就停');
  await page.getByRole('button', { name: '判定类型' }).click();
  await page.getByLabel('追问 1').fill('尚未做过。');
  await page.getByRole('button', { name: '再次审查' }).click();
  await page.getByRole('button', { name: '生成类型判定' }).click();
  await page.getByRole('button', { name: '返回上一步' }).click();

  await expect(page.locator('.chipset .chip').filter({ hasText: '责任心强' }))
    .toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('员工特征补充')).toHaveValue('主动承担跨组协作。');

  await page.locator('#workspace-return-home').click();
  await openIntake(page);
  await expect(page.locator('.chipset .chip[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.getByLabel('员工特征补充')).toHaveValue('');

  await page.locator('.chipset .chip').filter({ hasText: '责任心强' }).click();
  await page.getByLabel('员工特征补充').fill('刷新前文本');
  await page.reload();
  await openIntake(page);
  await expect(page.locator('.chipset .chip[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.getByLabel('员工特征补充')).toHaveValue('');
});

test('桌面类型判定页对齐参考提示、四画像、依据和操作栏', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await advanceToClassification(page);

  const note = page.locator('.panel[data-stage="classification"] .note');
  await expect(note.locator('img')).toHaveAttribute('src', /info\.svg$/);
  await expect(note).toContainText('4 类画像名称与关键词');
  await expect(page.locator('.typegrid .tcard')).toHaveCount(4);
  await expect(page.locator('#type-card-B')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#type-card-B .ai-matchflag')).toHaveText('最匹配');
  await expect(page.locator('.classification-meta')).toHaveCount(0);
  for (const hiddenLabel of [
    '判定状态',
    '判断可信度',
    '能力：',
    '意愿：',
    '用人策略',
    '教练模式',
  ]) {
    await expect(page.locator('.panel[data-stage="classification"]'))
      .not.toContainText(hiddenLabel);
  }
  await expect(page.locator('.classification-reasoning')).toContainText('判定依据：');
  await expect(page.locator('.classification-reasoning')).toContainText('员工已能独立交付复杂任务');

  await expect(page.locator('#go-previous')).toHaveText('上一步');
  await expect(page.locator('#generate-plan')).toHaveText('生成方案');
  await expect(page.locator('#generate-plan img')).toHaveAttribute('src', /arrow-right\.svg$/);

  await expectRectNear(page.locator('.panel[data-stage="classification"] .panel-head'), {
    x: 691, y: 167.78125, width: 800, height: 104.78125,
  });
  await expectRectNear(note, { x: 717, y: 294.5625, width: 748, height: 44 });
  await expectRectNear(page.locator('.typegrid'), { x: 717, y: 354.5625, width: 748, height: 215.96875 });
  await expectRectNear(page.locator('.typegrid .tcard').first(), {
    x: 717, y: 354.5625, width: 368, height: 101.984375,
  });
});

test('桌面方案页对齐五类卡片标题图标和参考操作栏', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await advanceToPlan(page);

  await expect(page.locator('.panel[data-stage="plan"] .panel-desc'))
    .toContainText('针对“熟手待激活型”');
  const cards = page.locator('#coach-plan > .rcard');
  await expect(cards).toHaveCount(5);
  await expect(cards.locator('.rcard-h .n')).toHaveText(['切', '注', '频', '修', '话']);
  await expect(page.locator('#copy-plan img')).toHaveAttribute('src', /copy\.svg$/);
  await expect(page.locator('#regenerate-plan img')).toHaveAttribute('src', /refresh\.svg$/);
  await expect(page.locator('#go-feedback img')).toHaveAttribute('src', /arrow-right\.svg$/);
  await expect(page.locator('.panel[data-stage="plan"] .panel-foot .btn')).toHaveText([
    '上一步', '复制方案', '换个角度', '去反馈',
  ]);

  await expectRectNear(page.locator('.panel[data-stage="plan"] .panel-head'), {
    x: 691, y: 167.78125, width: 800, height: 104.78125,
  });
  await expectRectNear(cards.first(), { x: 717, y: 294.5625, width: 748 });
  await expectRectNear(cards.first().locator('.rcard-h'), { x: 736, y: 311.5625, width: 710, height: 24 });
  await expectRectNear(cards.first().locator('.rcard-h .n'), { x: 736, y: 311.5625, width: 24, height: 24 });
});

test('桌面方案页仅为标准无序列表显示紫色圆点', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const fixtures = defaultFixtures();
  fixtures.plan = [envelope({
    entry: ['- 先认可其交付能力', '- 再约定挑战目标'],
    cautions: ['- 避免把跟进变成查岗'],
    frequency: '每周一次 1v1（15 分钟）',
    gap_fix: ['- **Situation（情境）**：项目例会；**Behavior（行为）**：主动同步风险；**Impact（影响）**：团队可以提前协调。'],
    scripts: ['- **Goal（目标）**：主动推进项目同步。**Reality（现状）**：目前仍需主管跟进。**Options（可选方案）**：可用模板或日历提醒。**Will（行动承诺）**：下次评审前主动同步。'],
  })];
  await advanceToPlan(page, fixtures);

  const listItems = page.locator(
    '.panel[data-stage="plan"] .rcard .markdown-body ul > li',
  );
  await expect(listItems).not.toHaveCount(0);

  const markerStyles = await listItems.evaluateAll((items) => items.map((item) => ({
    listStyleType: getComputedStyle(item).listStyleType,
    markerColor: getComputedStyle(item, '::marker').color,
  })));
  expect(markerStyles.every(({ listStyleType }) => listStyleType === 'disc')).toBe(true);
  expect(markerStyles.every(({ markerColor }) => markerColor === 'rgb(108, 33, 109)')).toBe(true);

  await expect(page.locator('#plan-frequency')).toHaveCount(1);
  await expect(page.locator('#plan-frequency').locator('ul, li')).toHaveCount(0);
  await expect(page.locator('#plan-scripts li').first().locator('p')).not.toHaveCount(0);
});

test('桌面完整 GROW SBI 内容在面板内滚动且底部操作栏保持可见', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await advanceToPlan(page);

  const geometry = await page.locator('.panel[data-stage="plan"]').evaluate((panel) => {
    const body = panel.querySelector('.panel-body');
    const footer = panel.querySelector('.panel-foot');
    const panelRect = panel.getBoundingClientRect();
    const footerRect = footer.getBoundingClientRect();
    return {
      panelHeight: panelRect.height,
      footerBottom: footerRect.bottom,
      bodyOverflowY: getComputedStyle(body).overflowY,
      bodyClientHeight: body.clientHeight,
      bodyScrollHeight: body.scrollHeight,
    };
  });

  expect(Math.abs(geometry.panelHeight - 840.125)).toBeLessThanOrEqual(2);
  expect(geometry.footerBottom).toBeLessThanOrEqual(1008);
  expect(geometry.bodyOverflowY).toBe('auto');
  expect(geometry.bodyScrollHeight).toBeGreaterThan(geometry.bodyClientHeight);
  await expect(page.locator('.panel[data-stage="plan"] .panel-foot')).toBeVisible();
});

test('桌面反馈页对齐生成按钮、会话记录和完成辅导操作栏', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await advanceToPlan(page);
  await page.getByRole('button', { name: '去反馈' }).click();

  const generate = page.locator('.panel-body #generate-feedback');
  await expect(generate).toBeVisible();
  await expect(generate.locator('img')).toHaveAttribute('src', /refresh-light\.svg$/);
  await expect(page.locator('.session-log .logitem')).toHaveCount(2);
  await expect(page.locator('.session-log')).toContainText('熟手待激活型 · 高能力低意愿');
  await expect(page.locator('.session-log')).toContainText('先认可其交付能力，再约定挑战目标');
  await expect(page.locator('.session-log')).toContainText('每周一次 1v1');
  await expect(page.locator('.panel[data-stage="feedback"] .panel-foot .btn')).toHaveText([
    '上一步', '完成辅导',
  ]);
  await expect(page.locator('#complete-coaching img')).toHaveAttribute('src', /arrow-right\.svg$/);

  await expectRectNear(page.locator('.panel[data-stage="feedback"] .panel-head'), {
    x: 691, y: 167.78125, width: 800, height: 104.78125,
  });
  await expectRectNear(page.locator('.panel[data-stage="feedback"] .field'), {
    x: 717, y: 294.5625, width: 748, height: 98.59375,
  });
  await expectRectNear(generate, { x: 717, y: 411.15625, height: 30 });

  await page.locator('#complete-coaching').click();
  await expect(page.getByRole('button', { name: '开始辅导' })).toBeVisible();
  await openIntake(page);
  await expect(page.getByLabel('绩效目标 / 上层期望')).toHaveValue('');
  await expect(page.locator('.chipset .chip[aria-pressed="true"]')).toHaveCount(0);
});

test('完整流程五页使用统一的参考视觉结构', async ({ page }) => {
  const requests = await mockCoachApi(page);
  await page.goto('/');
  await expect(page.locator('.welcome-page .welcome-card')).toBeVisible();

  await fillHome(page);
  await expect(page.locator('.ws-grid .stepper')).toBeVisible();
  await page.getByRole('button', { name: '判定类型' }).click();
  await page.getByLabel('追问 1').fill('尚未做过。');
  await page.getByRole('button', { name: '再次审查' }).click();
  await page.getByRole('button', { name: '生成类型判定' }).click();
  await expect(page.locator('.panel[data-stage="classification"]')).toBeVisible();
  await page.getByRole('button', { name: '生成辅导方案' }).click();
  await expect(page.locator('.panel[data-stage="plan"] .report')).toBeVisible();
  await page.getByRole('button', { name: '去反馈' }).click();
  await expect(page.locator('.panel[data-stage="feedback"]')).toBeVisible();
  expect(requests.map(({ method }) => method)).toEqual(['intake', 'intake', 'classify', 'plan']);
});

test('四种公开画像提供固定简短判定摘要', async ({ page }) => {
  await page.goto('/');
  const summaries = await page.evaluate(async () => {
    const { PUBLIC_PROFILES } = await import('/profile-selection.js');
    return Object.fromEntries(PUBLIC_PROFILES.map(({ id, summary }) => [id, summary]));
  });

  expect(summaries).toEqual({
    B: '员工能力较高，但近期主动性和投入度不足，归入熟手待激活型。辅导重点是激发意愿。',
    A: '员工能力与意愿都较高，归入核心明星型。辅导重点是充分授权并提供更高挑战。',
    C: '员工意愿较高，但当前能力或经验仍需提升，归入潜力新兵型。辅导重点是结构化带教。',
    D: '员工当前能力与意愿都需要改善，归入待改进型。辅导重点是明确要求、边界与改进节奏。',
  });
});

test('纯画像模块把 D1 D2 收敛为前台 D 并按入职时长解析隐藏类型', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const module = await import('/profile-selection.js');
    const source = {
      ability: '高',
      will: '低',
      quadrant: 'B',
      type_id: 'B',
      status: '已判定',
      classification_confidence: '中',
      strategy: '激发意愿',
      coach_mode: '诱导式',
      reason: 'AI 原始依据。',
      evidence: ['能力高', '意愿低'],
      questions: [],
    };
    return {
      publicD1: module.publicProfileId('D1'),
      publicD2: module.publicProfileId('D2'),
      newHire: module.resolveFinalClassification(source, 'D', { tenure: '3 个月内（新人）' }),
      established: module.resolveFinalClassification(source, 'D', { tenure: '1 年以上' }),
    };
  });
  expect(result.publicD1).toBe('D');
  expect(result.publicD2).toBe('D');
  expect(result.newHire).toMatchObject({ type_id: 'D1', strategy: '手把手带', coach_mode: '教导式' });
  expect(result.established).toMatchObject({ type_id: 'D2', strategy: '绩效改进/优化', coach_mode: '绩效面谈' });
});

test('resetSession 清除本轮画像选择', async ({ page }) => {
  await page.goto('/');
  const selectedProfileId = await page.evaluate(async () => {
    const state = await import('/state.js');
    state.setSelectedProfileId('A');
    state.resetSession();
    return state.session.selectedProfileId;
  });
  expect(selectedProfileId).toBeNull();
});

test('AI 推荐默认选中且用户可无 API 改选画像', async ({ page }) => {
  const requests = await advanceToClassification(page);
  const requestCount = requests.length;
  const cards = page.locator('[data-profile-id]');

  await expect(cards).toHaveCount(4);
  await expect(cards.locator('.tcard-name')).toHaveText([
    '熟手待激活型',
    '核心明星型',
    '潜力新兵型',
    '待改进型',
  ]);
  await expect(page.getByText(/D1|D2/)).toHaveCount(0);
  await expect(page.locator('[data-profile-id="B"]')).toHaveClass(/selected/);
  await expect(page.locator('[data-profile-id="B"]')).toContainText('最匹配');

  await page.locator('[data-profile-id="A"]').click();
  await expect(page.locator('[data-profile-id="A"]')).toHaveClass(/selected/);
  await expect(page.locator('[data-profile-id="A"]')).toContainText('已选');
  await expect(page.locator('[data-profile-id="B"]')).toContainText('AI推荐');
  expect(requests).toHaveLength(requestCount);
});

test('画像卡支持键盘改选并保持单选语义', async ({ page }) => {
  await advanceToClassification(page);
  const group = page.getByRole('radiogroup', { name: '员工画像选择' });
  await expect(group.getByRole('radio')).toHaveCount(4);
  await group.getByRole('radio', { name: /核心明星型/ }).focus();
  await page.keyboard.press('Space');
  await expect(group.getByRole('radio', { name: /核心明星型/ })).toHaveAttribute('aria-checked', 'true');
});

test('生成方案使用用户最终选择的画像契约', async ({ page }) => {
  const requests = await advanceToClassification(page);
  await page.locator('[data-profile-id="A"]').click();
  await page.getByRole('button', { name: '生成辅导方案' }).click();

  const planRequest = requests.find(({ method }) => method === 'plan');
  expect(planRequest.body.classification).toMatchObject({
    type_id: 'A',
    quadrant: 'A',
    ability: '高',
    will: '高',
    strategy: '委以重任',
    coach_mode: '授权式',
  });
});

test('非新人从其他画像改选待改进型时隐藏映射为 D2', async ({ page }) => {
  const requests = await advanceToClassification(page);
  await page.locator('[data-profile-id="D"]').click();
  await page.getByRole('button', { name: '生成辅导方案' }).click();
  expect(requests.find(({ method }) => method === 'plan').body.classification).toMatchObject({
    type_id: 'D2',
    quadrant: 'D',
    strategy: '绩效改进/优化',
    coach_mode: '绩效面谈',
  });
});

test('新人从其他画像改选待改进型时隐藏映射为 D1', async ({ page }) => {
  const requests = await mockCoachApi(page);
  await page.goto('/');
  await openIntake(page);
  await page.getByLabel('岗位类别').selectOption({ label: '骨干/带教岗' });
  await page.getByLabel('在团队入职时长').selectOption({ label: '3 个月内（新人）' });
  await page.getByLabel('当前绩效状态').selectOption({ label: '持续达标' });
  await page.getByLabel('绩效目标 / 上层期望').fill('独立承接三个项目');
  await page.getByLabel('近期辅导困扰').fill('交代的事不追就停');
  await page.getByLabel('员工特征补充').fill('能够独立交付复杂任务，但近期主动性不足。');
  await page.getByRole('button', { name: '判定类型' }).click();
  await page.getByLabel('追问 1').fill('尚未做过。');
  await page.getByRole('button', { name: '再次审查' }).click();
  await page.getByRole('button', { name: '生成类型判定' }).click();
  await page.locator('[data-profile-id="D"]').click();
  await page.getByRole('button', { name: '生成辅导方案' }).click();
  expect(requests.find(({ method }) => method === 'plan').body.classification.type_id).toBe('D1');
});

test('AI 原为 D1 或 D2 时选择待改进型保留原隐藏子类型', async ({ page }) => {
  const fixtures = defaultFixtures();
  fixtures.classify = [classifiedAs('D1')];
  const requests = await advanceToClassification(page, fixtures);
  await page.getByRole('button', { name: '生成辅导方案' }).click();
  expect(requests.find(({ method }) => method === 'plan').body.classification.type_id).toBe('D1');
});

test('反馈请求继续使用与方案相同的最终画像', async ({ page }) => {
  const requests = await advanceToClassification(page);
  await page.locator('[data-profile-id="A"]').click();
  await page.getByRole('button', { name: '生成辅导方案' }).click();
  await page.getByRole('button', { name: '去反馈' }).click();
  await page.getByLabel('本次沟通后的情况').fill('已完成首次沟通。');
  await page.getByRole('button', { name: '生成下一步建议' }).click();
  expect(requests.find(({ method }) => method === 'feedback').body.classification.type_id).toBe('A');
});

test('换个角度继续使用用户最终选择的画像', async ({ page }) => {
  const requests = await advanceToClassification(page);
  await page.locator('[data-profile-id="A"]').click();
  await page.getByRole('button', { name: '生成辅导方案' }).click();
  await page.getByRole('button', { name: '换个角度' }).click();

  const planRequests = requests.filter(({ method }) => method === 'plan');
  expect(planRequests).toHaveLength(2);
  expect(planRequests.map(({ body }) => body.classification.type_id)).toEqual(['A', 'A']);
});

test('返回类型页改选画像后清除旧方案和反馈并重新请求方案', async ({ page }) => {
  const fixtures = defaultFixtures();
  fixtures.plan = [coachingPlan(), nextPlan()];
  const requests = await advanceToPlan(page, fixtures);
  await page.getByRole('button', { name: '返回上一步' }).click();
  await page.locator('[data-profile-id="A"]').click();
  await expect(page.getByRole('button', { name: '生成辅导方案' })).toBeVisible();
  await page.getByRole('button', { name: '生成辅导方案' }).click();

  expect(requests.filter(({ method }) => method === 'plan')).toHaveLength(2);
  expect(requests.filter(({ method }) => method === 'plan')[1].body.classification.type_id).toBe('A');
});

test('返回上一步保留画像选择且不调用 API', async ({ page }) => {
  const requests = await advanceToClassification(page);
  await page.locator('[data-profile-id="A"]').click();
  const before = requests.length;
  await page.getByRole('button', { name: '返回上一步' }).click();
  await page.getByRole('button', { name: '继续类型判定' }).click();
  await expect(page.locator('[data-profile-id="A"]')).toHaveClass(/selected/);
  expect(requests).toHaveLength(before);
});

test('刷新后回到欢迎页且不保留画像和员工数据', async ({ page }) => {
  await advanceToClassification(page);
  await page.locator('[data-profile-id="A"]').click();
  await page.reload();
  await expect(page.getByRole('button', { name: '开始辅导' })).toBeVisible();
  await expect(page.locator('[data-profile-id]')).toHaveCount(0);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })))
    .toEqual({ local: 0, session: 0 });
});

for (const width of [390, 768, 1440]) {
  test(`${width}px 下五页布局没有整页横向溢出`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect.poll(() => page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )).toBe(true);
    await openIntake(page);
    await expect.poll(() => page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )).toBe(true);
  });
}

test('首页审查会追问缺失信息，并在补充后允许生成类型判定', async ({ page }) => {
  await mockCoachApi(page);
  await page.goto('/');
  await fillHome(page);
  await page.getByRole('button', { name: '判定类型' }).click();

  await expect(page.getByText('请补充：是否已做过针对性辅导？')).toBeVisible();
  await page.getByLabel('追问 1').fill('尚未做过。');
  await page.getByRole('button', { name: '再次审查' }).click();

  await expect(page.getByRole('button', { name: '生成类型判定' })).toBeEnabled();
});

test('刷新后回到空白首页，不保留上次输入或会话数据', async ({ page }) => {
  await mockCoachApi(page);
  await page.goto('/');
  await fillHome(page);
  await page.reload();

  await expect(page.getByRole('button', { name: '开始辅导' })).toBeVisible();
  await expect(page.getByLabel('绩效目标 / 上层期望')).toHaveCount(0);
  await openIntake(page);
  await expect(page.getByLabel('绩效目标 / 上层期望')).toHaveValue('');
  await expect(page.getByLabel('近期辅导困扰')).toHaveValue('');
  await expect(page.getByLabel('员工特征补充')).toHaveValue('');
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })))
    .toEqual({ local: 0, session: 0 });
});

test('工作区返回首页会从方案页清空当前会话', async ({ page }) => {
  await advanceToPlan(page);

  const returnHome = page.locator('#workspace-return-home');
  await expect(returnHome).toBeVisible();
  await expect(returnHome).toHaveAttribute('aria-label', '返回首页');
  await returnHome.click();

  await expect(page.getByRole('heading', { name: '因材施教，给每个人对的辅导方式' })).toBeVisible();
  await expect(page.getByLabel('绩效目标 / 上层期望')).toHaveCount(0);
  await openIntake(page);
  await expect(page.getByLabel('绩效目标 / 上层期望')).toHaveValue('');
  await expect(page.getByLabel('近期辅导困扰')).toHaveValue('');
  await expect(page.getByLabel('员工特征补充')).toHaveValue('');
  await expect(page.locator('#coach-plan')).toHaveCount(0);
  await expect(page.locator('[id^="type-card-"]')).toHaveCount(0);
  await expect(page.locator('#feedback-next-steps')).toHaveCount(0);
});

test('第 2、3、4 步可以逐步返回且返回操作不重复调用 API', async ({ page }) => {
  const fixtures = defaultFixtures();
  const requests = await advanceToPlan(page, fixtures);
  const requestCountBeforeReturn = requests.length;

  await page.getByRole('button', { name: '返回上一步' }).click();
  await expect(page.locator('.panel-h')).toHaveText('类型判定');
  await expect(page.locator('#type-card-B')).toContainText('熟手待激活型');

  await page.getByRole('button', { name: '返回上一步' }).click();
  await expect(page.locator('.panel-h')).toHaveText('员工信息输入');
  await expect(page.getByLabel('绩效目标 / 上层期望')).toHaveValue('独立承接三个项目');
  await expect(page.getByLabel('近期辅导困扰')).toHaveValue('交代的事不追就停');
  await expect(page.getByRole('button', { name: '返回上一步' })).toHaveCount(0);
  expect(requests).toHaveLength(requestCountBeforeReturn);
});

test('第 4 步返回方案后会保留尚未提交的反馈草稿', async ({ page }) => {
  await advanceToPlan(page);
  await page.getByRole('button', { name: '去反馈' }).click();
  await page.getByLabel('本次沟通后的情况').fill('已提交的反馈草稿');
  await page.getByRole('button', { name: '返回上一步' }).click();
  await expect(page.locator('.panel-h')).toHaveText('教练方案生成');
  await page.getByRole('button', { name: '去反馈' }).click();
  await expect(page.getByLabel('本次沟通后的情况')).toHaveValue('已提交的反馈草稿');
});

test('返回后未修改员工信息会复用已有结果，修改后会重新审查并清除旧下游结果', async ({ page }) => {
  const fixtures = defaultFixtures();
  fixtures.intake = [...fixtures.intake, ...fixtures.intake];
  fixtures.classify = [...fixtures.classify, ...fixtures.classify];
  fixtures.plan = [coachingPlan(), coachingPlan()];
  const requests = await advanceToPlan(page, fixtures);

  await page.getByRole('button', { name: '返回上一步' }).click();
  await page.getByRole('button', { name: '返回上一步' }).click();
  await page.getByRole('button', { name: '继续类型判定' }).click();
  expect(requests.filter((item) => item.method === 'intake')).toHaveLength(2);
  await expect(page.locator('#type-card-B')).toBeVisible();

  await page.getByRole('button', { name: '返回上一步' }).click();
  await page.getByLabel('近期辅导困扰').fill('修改后的辅导困扰');
  await page.getByRole('button', { name: '继续类型判定' }).click();

  await expect.poll(() => requests.filter((item) => item.method === 'intake').length).toBe(3);
  await expect(page.locator('#type-card-B')).toHaveCount(0);
  await expect(page.locator('#coach-plan')).toHaveCount(0);
  await expect(page.locator('#feedback-next-steps')).toHaveCount(0);
});

test('方案重新生成成功后会清空旧反馈输入和结果', async ({ page }) => {
  const fixtures = defaultFixtures();
  fixtures.plan = [coachingPlan(), nextPlan()];
  fixtures.feedback = [...fixtures.feedback, ...fixtures.feedback];
  await advanceToPlan(page, fixtures);
  await page.getByRole('button', { name: '去反馈' }).click();
  await page.getByLabel('本次沟通后的情况').fill('旧反馈内容');
  await page.getByRole('button', { name: '生成下一步建议' }).click();
  await expect(page.locator('#feedback-next-steps')).toBeVisible();

  await page.getByRole('button', { name: '返回上一步' }).click();
  await page.getByRole('button', { name: '换个角度' }).click();
  await expect(page.locator('.loading-overlay')).toHaveCount(0);
  await page.getByRole('button', { name: '去反馈' }).click();

  await expect(page.getByLabel('本次沟通后的情况')).toHaveValue('');
  await expect(page.locator('#feedback-next-steps')).toHaveCount(0);
});

test('生成反馈期间返回方案页后，迟到响应不会恢复反馈页', async ({ page }) => {
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      const withoutSignal = { ...init };
      delete withoutSignal.signal;
      return nativeFetch(input, withoutSignal);
    };
  });
  let releaseFeedback;
  const delayedFeedback = new Promise((resolve) => { releaseFeedback = resolve; });
  const fixtures = defaultFixtures();
  fixtures.feedback = [() => delayedFeedback];
  const requests = await advanceToPlan(page, fixtures);
  await page.getByRole('button', { name: '去反馈' }).click();
  await page.getByLabel('本次沟通后的情况').fill('等待生成的反馈');
  await page.getByRole('button', { name: '生成下一步建议' }).click();
  await expect.poll(() => requests.filter((item) => item.method === 'feedback').length).toBe(1);

  await page.getByRole('button', { name: '返回上一步' }).click();
  await expect(page.locator('.panel-h')).toHaveText('教练方案生成');
  releaseFeedback(defaultFixtures().feedback[0]);
  await page.waitForTimeout(150);

  await expect(page.locator('.panel-h')).toHaveText('教练方案生成');
  await expect(page.locator('#feedback-next-steps')).toHaveCount(0);
});

for (const width of [320, 375]) {
  test(`${width}px 下返回上一步按钮可见且页面无横向溢出`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await advanceToPlan(page);
    await expect(page.getByRole('button', { name: '返回上一步' })).toBeVisible();
    const viewport = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(viewport.scrollWidth).toBe(viewport.clientWidth);
  });
}

test('工作区返回首页后迟到请求不会恢复旧会话', async ({ page }) => {
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      const withoutSignal = { ...init };
      delete withoutSignal.signal;
      return nativeFetch(input, withoutSignal);
    };
  });
  let releaseDelayedIntake;
  const delayedIntake = new Promise((resolve) => { releaseDelayedIntake = resolve; });
  const fixtures = defaultFixtures();
  const delayedResponseBody = fixtures.intake[0];
  fixtures.intake = [() => delayedIntake];
  const requests = await mockCoachApi(page, fixtures);
  await page.goto('/');
  await fillHome(page);
  await page.getByRole('button', { name: '判定类型' }).click();
  await expect.poll(() => requests.filter((item) => item.method === 'intake').length).toBe(1);

  await page.locator('#workspace-return-home').click();
  const intakeResponseCompleted = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/coach/intake'
  ));
  releaseDelayedIntake(delayedResponseBody);
  const intakeResponse = await intakeResponseCompleted;
  await intakeResponse.finished();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));

  await expect(page.getByRole('heading', { name: '因材施教，给每个人对的辅导方式' })).toBeVisible();
  await expect(page.getByLabel('绩效目标 / 上层期望')).toHaveCount(0);
  await openIntake(page);
  await expect(page.getByLabel('绩效目标 / 上层期望')).toHaveValue('');
  await expect(page.getByLabel('近期辅导困扰')).toHaveValue('');
  await expect(page.getByLabel('员工特征补充')).toHaveValue('');
  await expect(page.locator('.panel-h')).toHaveText('员工信息输入');
});

test('窄屏下顶部返回首页持续可见且不造成横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/');

  await expect(page.locator('#top-return-home')).toBeVisible();
  await expect(page.locator('.badge-top')).toBeHidden();
  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
});

for (const status of ['待补充', '待人工确认']) {
  test(`类型判定为${status}时不显示进入方案按钮`, async ({ page }) => {
    const pending = status === '待补充'
      ? {
        ability: '未知', will: '未知', quadrant: null, type_id: null,
        status, classification_confidence: '低', strategy: null, coach_mode: null,
        reason: '缺少近期行为证据。', evidence: [], questions: ['请补充近期行为证据。'],
      }
      : {
        ability: '高', will: '低', quadrant: 'B', type_id: null,
        status, classification_confidence: '低', strategy: null, coach_mode: null,
        reason: '能力线索与意愿线索存在矛盾。', evidence: ['能力线索与意愿线索存在矛盾'], questions: ['请主管人工确认。'],
      };
    const fixtures = defaultFixtures();
    fixtures.classify = [envelope(pending)];

    const requests = await advanceToClassification(page, fixtures);

    await expect(page.getByText(status)).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: '员工画像选择' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /方案/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /补充|人工确认/ })).toBeVisible();
    expect(requests.filter(({ method }) => method === 'plan')).toHaveLength(0);
  });
}

test('被拦截的业务状态只展示固定 HR 提示', async ({ page }) => {
  const fixtures = defaultFixtures();
  fixtures.intake = [{
    ok: true,
    blocked: true,
    code: 'HR_REVIEW_REQUIRED',
    message: '模型自由文本不应出现在页面上。',
  }];
  await mockCoachApi(page, fixtures);
  await page.goto('/');
  await fillHome(page);
  await page.getByRole('button', { name: '判定类型' }).click();

  await expect(page.getByText('该事项涉及高风险人事决策，请转交 HR 按公司制度处理。本工具仅可协助准备一般辅导沟通。')).toBeVisible();
  await expect(page.getByText('模型自由文本不应出现在页面上。')).toHaveCount(0);
});

test('换个角度会用 regenerate=true 请求新的方案', async ({ page }) => {
  const fixtures = defaultFixtures();
  const requests = await mockCoachApi(page, fixtures);
  await page.goto('/');
  await fillHome(page);
  await page.getByRole('button', { name: '判定类型' }).click();
  await page.getByLabel('追问 1').fill('尚未做过。');
  await page.getByRole('button', { name: '再次审查' }).click();
  await page.getByRole('button', { name: '生成类型判定' }).click();
  await page.getByRole('button', { name: '生成辅导方案' }).click();
  await page.getByRole('button', { name: '换个角度' }).click();

  await expect.poll(() => requests.filter((item) => item.method === 'plan').length).toBe(2);
  const planRequests = requests.filter((item) => item.method === 'plan');
  expect(planRequests[0].body).toMatchObject({ regenerate: false, previousPlan: null });
  expect(planRequests[1].body).toMatchObject({ regenerate: true });
  const normalizedProfile = requests.find((item) => item.method === 'classify').body.normalizedProfile;
  expect(planRequests[0].body.normalizedProfile).toEqual(normalizedProfile);
  expect(planRequests[1].body.normalizedProfile).toEqual(normalizedProfile);
});

test('方案页可见完整 GROW 与 B 类型的 SBI 标签', async ({ page }) => {
  await advanceToPlan(page);

  for (const label of ['Goal（目标）', 'Reality（现状）', 'Options（可选方案）', 'Will（行动承诺）']) {
    await expect(page.locator('#plan-scripts')).toContainText(label);
  }
  for (const label of ['Situation（情境）', 'Behavior（行为）', 'Impact（影响）']) {
    await expect(page.locator('#coach-plan')).toContainText(label);
  }
});

test('GROW 和 SBI 的每个阶段分别显示为独立段落', async ({ page }) => {
  const growLabels = ['Goal（目标）', 'Reality（现状）', 'Options（可选方案）', 'Will（行动承诺）'];
  const sbiLabels = ['Situation（情境）', 'Behavior（行为）', 'Impact（影响）'];
  await advanceToPlan(page);

  await expectStageLabelsInSeparateParagraphs(page.locator('#plan-scripts'), growLabels);
  await expectStageLabelsInSeparateParagraphs(page.locator('#plan-gap-fix'), sbiLabels);

  await page.getByRole('button', { name: '去反馈' }).click();
  await page.getByLabel('本次沟通后的情况').fill('员工本周主动同步了项目风险，并按约定提交了里程碑。');
  await page.getByRole('button', { name: '生成下一步建议' }).click();

  await expectStageLabelsInSeparateParagraphs(page.locator('#feedback-next-steps'), sbiLabels);
});

test('阶段格式化兼容空格冒号并保留 Markdown 列表结构', async ({ page }) => {
  const fixtures = defaultFixtures();
  fixtures.plan = [envelope({
    entry: ['普通切入点。'],
    cautions: ['保持观察。'],
    frequency: '每周一次',
    gap_fix: ['说明。**Situation（情境）** ：空格全角冒号。**Behavior（行为）**:半角冒号。**Impact（影响）：**冒号在粗体内。'],
    scripts: [
      '- **Goal（目标）**：列表内容；**Reality（现状）**:后续内容。',
      '**Options（可选方案）** ：选项内容。Will（行动承诺）:承诺内容。',
    ],
  })];
  await advanceToPlan(page, fixtures);

  const gapFix = page.locator('#plan-gap-fix');
  const scripts = page.locator('#plan-scripts');
  await expectStageLabelsInSeparateParagraphs(gapFix, ['Situation（情境）', 'Behavior（行为）', 'Impact（影响）']);
  await expect(gapFix.locator('p').filter({ hasText: 'Situation（情境）' }))
    .toHaveText('Situation（情境） ：空格全角冒号。');
  await expectStageLabelsInSeparateParagraphs(scripts, ['Goal（目标）', 'Reality（现状）', 'Options（可选方案）', 'Will（行动承诺）']);

  const listItem = scripts.locator('li');
  await expect(listItem).toHaveCount(1);
  await expect(listItem.locator('p')).toHaveCount(2);
  await expect(listItem.locator('p').first()).toContainText('Goal（目标）：列表内容');
  await expect(listItem.locator('p').nth(1)).toContainText('Reality（现状）:后续内容');
  await expect(scripts.locator('li:empty')).toHaveCount(0);

  const renderedText = await scripts.textContent();
  const expectedOrder = [
    'Goal（目标）', '列表内容', 'Reality（现状）', '后续内容',
    'Options（可选方案）', '选项内容', 'Will（行动承诺）', '承诺内容',
  ];
  let previousIndex = -1;
  for (const fragment of expectedOrder) {
    const currentIndex = renderedText.indexOf(fragment, previousIndex + 1);
    expect(currentIndex).toBeGreaterThan(previousIndex);
    previousIndex = currentIndex;
  }
});

test('阶段格式化跳过代码并且不影响普通 Markdown 卡片', async ({ page }) => {
  const fixtures = defaultFixtures();
  fixtures.plan = [envelope({
    entry: ['Goal（目标）：普通卡片内容。Reality（现状）：仍在同一段。'],
    cautions: ['保持观察。'],
    frequency: '每周一次',
    gap_fix: [
      '`Goal（目标）：行内示例` 保持行内。**Situation（情境）**：真实情境。',
      '```text',
      'Behavior（行为）：反引号围栏示例',
      'Impact（影响）：反引号围栏示例',
      '```',
      '**Behavior（行为）**：真实行为。**Impact（影响）**：真实影响。',
      '~~~text',
      'Goal（目标）：波浪围栏示例',
      '~~~',
    ],
    scripts: ['保留普通话术。'],
  })];
  await advanceToPlan(page, fixtures);

  const entry = page.locator('#plan-entry');
  await expect(entry.locator('p')).toHaveCount(1);
  await expect(entry.locator('p')).toContainText('Goal（目标）：普通卡片内容。Reality（现状）：仍在同一段。');

  const gapFix = page.locator('#plan-gap-fix');
  await expect(gapFix.locator('p code')).toHaveText('Goal（目标）：行内示例');
  await expect(gapFix.locator('pre')).toHaveCount(2);
  await expect(gapFix.locator('pre').first()).toHaveText('Behavior（行为）：反引号围栏示例\nImpact（影响）：反引号围栏示例\n');
  await expect(gapFix.locator('pre').nth(1)).toHaveText('Goal（目标）：波浪围栏示例\n');
  await expectStageLabelsInSeparateParagraphs(gapFix, ['Situation（情境）', 'Behavior（行为）', 'Impact（影响）']);
  await expect(gapFix.locator('p').filter({ hasText: '真实情境' })).toHaveText('Situation（情境）：真实情境。');
  await expect(gapFix.locator('p').filter({ hasText: '真实行为' })).toHaveText('Behavior（行为）：真实行为。');
  await expect(gapFix.locator('p').filter({ hasText: '真实影响' })).toHaveText('Impact（影响）：真实影响。');
});

test('阶段格式化保护 Markdown 代码上下文中的容器围栏', async ({ page }) => {
  const fixtures = defaultFixtures();
  fixtures.plan = [envelope({
    entry: ['普通切入点。'],
    cautions: ['保持观察。'],
    frequency: '每周一次',
    gap_fix: [
      '> > ```text',
      '> > Goal（目标）：引用围栏示例',
      '> > ```',
      '',
      '- ~~~text',
      '  Reality（现状）：列表围栏示例',
      '  ~~~',
      '',
      '说明。Goal（目标）：真实内容。Reality（现状）：真实现状。',
    ],
    scripts: ['保留普通话术。'],
  })];
  await advanceToPlan(page, fixtures);

  const gapFix = page.locator('#plan-gap-fix');
  await expect(gapFix.locator('blockquote blockquote pre code'))
    .toHaveText('Goal（目标）：引用围栏示例\n');
  await expect(gapFix.locator('li pre code'))
    .toHaveText('Reality（现状）：列表围栏示例\n');
  await expect(gapFix.locator('p').filter({ hasText: '真实内容' }))
    .toHaveText('Goal（目标）：真实内容。');
  await expect(gapFix.locator('p').filter({ hasText: '真实现状' }))
    .toHaveText('Reality（现状）：真实现状。');
});

test('阶段格式化按 Markdown fence 规则区分四空格缩进代码', async ({ page }) => {
  const fixtures = defaultFixtures();
  fixtures.plan = [envelope({
    entry: ['普通切入点。'],
    cautions: ['保持观察。'],
    frequency: '每周一次',
    gap_fix: [
      '    ```',
      'Goal（目标）：真实目标。Reality（现状）：真实现状。',
    ],
    scripts: ['保留普通话术。'],
  })];
  await advanceToPlan(page, fixtures);

  const gapFix = page.locator('#plan-gap-fix');
  await expect(gapFix.locator('pre code')).toHaveText('```\n');
  await expectStageLabelsInSeparateParagraphs(
    gapFix,
    ['Goal（目标）', 'Reality（现状）'],
  );
  await expect(gapFix.locator('p').filter({ hasText: '真实目标' }))
    .toHaveText('Goal（目标）：真实目标。');
  await expect(gapFix.locator('p').filter({ hasText: '真实现状' }))
    .toHaveText('Reality（现状）：真实现状。');
});

test('阶段格式化按 Markdown fence 规则忽略代码内的容器状伪关闭行', async ({ page }) => {
  const fixtures = defaultFixtures();
  fixtures.plan = [envelope({
    entry: ['普通切入点。'],
    cautions: ['保持观察。'],
    frequency: '每周一次',
    gap_fix: [
      '```text',
      '> ```',
      'Goal（目标）：代码内容',
      '```',
      '',
      'Goal（目标）：真实内容。Reality（现状）：真实内容。',
    ],
    scripts: ['保留普通话术。'],
  })];
  await advanceToPlan(page, fixtures);

  const gapFix = page.locator('#plan-gap-fix');
  await expect(gapFix.locator('pre')).toHaveCount(1);
  await expect(gapFix.locator('pre code'))
    .toHaveText('> ```\nGoal（目标）：代码内容\n');
  await expectStageLabelsInSeparateParagraphs(
    gapFix,
    ['Goal（目标）', 'Reality（现状）'],
  );
  await expect(gapFix.locator('p').filter({ hasText: '真实内容' }).nth(0))
    .toHaveText('Goal（目标）：真实内容。');
  await expect(gapFix.locator('p').filter({ hasText: '真实内容' }).nth(1))
    .toHaveText('Reality（现状）：真实内容。');
});

test('阶段格式化保护 Markdown 代码上下文中的跨行 code span', async ({ page }) => {
  const fixtures = defaultFixtures();
  fixtures.plan = [envelope({
    entry: ['普通切入点。'],
    cautions: ['保持观察。'],
    frequency: '每周一次',
    gap_fix: ['保留普通修正建议。'],
    scripts: [
      '跨行代码 ``Goal（目标）：代码目标',
      'Reality（现状）：代码现状`` 保持完整。',
      '说明。Options（可选方案）：真实选项。Will（行动承诺）：真实承诺。',
      '未闭合 `代码标记',
      '说明。Goal（目标）：未闭合后的真实目标。Reality（现状）：未闭合后的真实现状。',
    ],
  })];
  await advanceToPlan(page, fixtures);

  const scripts = page.locator('#plan-scripts');
  await expect(scripts.locator('code')).toHaveCount(1);
  await expect(scripts.locator('code'))
    .toHaveText('Goal（目标）：代码目标 Reality（现状）：代码现状');
  await expect(scripts.locator('p').filter({ hasText: '真实选项' }))
    .toHaveText('Options（可选方案）：真实选项。');
  await expect(scripts.locator('p').filter({ hasText: '真实承诺' }))
    .toHaveText('Will（行动承诺）：真实承诺。 未闭合 `代码标记 说明。');
  await expect(scripts.locator('p').filter({ hasText: '未闭合后的真实目标' }))
    .toHaveText('Goal（目标）：未闭合后的真实目标。');
  await expect(scripts.locator('p').filter({ hasText: '未闭合后的真实现状' }))
    .toHaveText('Reality（现状）：未闭合后的真实现状。');
});

test('阶段格式化对齐服务端边界并支持下划线 strong 标签', async ({ page }) => {
  const fixtures = defaultFixtures();
  fixtures.plan = [envelope({
    entry: ['普通切入点。'],
    cautions: ['保持观察。'],
    frequency: '每周一次',
    gap_fix: ['保留普通修正建议。'],
    scripts: ['__Goal（目标）__：目标内容。__Reality（现状）__：现状内容。__Options（可选方案）：__ 选项内容；__Will（行动承诺）__ :承诺内容。'],
  })];
  await advanceToPlan(page, fixtures);

  const scripts = page.locator('#plan-scripts');
  await expectStageLabelsInSeparateParagraphs(
    scripts,
    ['Goal（目标）', 'Reality（现状）', 'Options（可选方案）', 'Will（行动承诺）'],
  );
  await expect(scripts.locator('p')).toHaveCount(4);
  await expect(scripts.locator('strong')).toHaveCount(4);
  await expect(scripts.locator('p').nth(0)).toHaveText('Goal（目标）：目标内容。');
  await expect(scripts.locator('p').nth(1)).toHaveText('Reality（现状）：现状内容。');
  await expect(scripts.locator('p').nth(2)).toHaveText('Options（可选方案）： 选项内容；');
  await expect(scripts.locator('p').nth(3)).toHaveText('Will（行动承诺） :承诺内容。');
});

test('阶段格式化对齐服务端边界且不拆分链接文本中的标签', async ({ page }) => {
  const fixtures = defaultFixtures();
  fixtures.plan = [envelope({
    entry: ['普通切入点。'],
    cautions: ['保持观察。'],
    frequency: '每周一次',
    gap_fix: ['参考 [Reality（现状）：说明](https://example.com)；Situation（情境）：真实情境。Behavior（行为）：真实行为；Impact（影响）：真实影响。'],
    scripts: ['保留普通话术。'],
  })];
  await advanceToPlan(page, fixtures);

  const gapFix = page.locator('#plan-gap-fix');
  const reference = gapFix.getByRole('link', { name: 'Reality（现状）：说明' });
  await expect(reference).toHaveCount(1);
  await expect(reference).toHaveAttribute('href', /https:\/\/example\.com\/?/);
  await expect(gapFix.locator('p').filter({ hasText: '参考 Reality（现状）：说明' }))
    .toHaveText('参考 Reality（现状）：说明；');
  await expectStageLabelsInSeparateParagraphs(
    gapFix,
    ['Situation（情境）', 'Behavior（行为）', 'Impact（影响）'],
  );
  await expect(gapFix.locator('p').filter({ hasText: '真实情境' }))
    .toHaveText('Situation（情境）：真实情境。');
  await expect(gapFix.locator('p').filter({ hasText: '真实行为' }))
    .toHaveText('Behavior（行为）：真实行为；');
  await expect(gapFix.locator('p').filter({ hasText: '真实影响' }))
    .toHaveText('Impact（影响）：真实影响。');
});

test('四种前台画像与流程步骤使用可访问单选和命名导航语义', async ({ page }) => {
  await advanceToClassification(page);

  const typeCards = page.locator('[data-profile-id]');
  await expect(typeCards).toHaveCount(4);
  expect(await typeCards.first().evaluate((element) => element.tagName)).toBe('BUTTON');
  await expect(typeCards).toContainText(['熟手待激活型', '核心明星型', '潜力新兵型', '待改进型']);

  const navigation = page.getByRole('navigation', { name: '辅导流程' });
  await expect(navigation.locator('ol > li')).toHaveCount(4);
  await expect(navigation.locator('li[aria-current="step"]')).toHaveCount(1);
});

test('类型判定隐藏内部判定行但保留画像选择和具体依据', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await advanceToClassification(page);

  await expect(page.locator('.classification-meta')).toHaveCount(0);
  for (const hiddenLabel of [
    '判定状态',
    '判断可信度',
    '能力：',
    '意愿：',
    '用人策略',
    '教练模式',
  ]) {
    await expect(page.locator('.panel[data-stage="classification"]'))
      .not.toContainText(hiddenLabel);
  }
  await expect(page.locator('.classification-reasoning')).toContainText('判定依据：');
  await expect(page.locator('.classification-reasoning')).toContainText('员工已能独立交付复杂任务');
  await expect(page.locator('.typegrid .tcard')).toHaveCount(4);
  await expect(page.locator('#generate-plan')).toBeVisible();
  await expect(page.getByText('置信度：', { exact: true })).toHaveCount(0);
  await expect(page.getByText('员工信心：', { exact: true })).toHaveCount(0);
});

test('离开方案后延迟的换个角度响应不会覆盖反馈页面', async ({ page }) => {
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      const withoutSignal = { ...init };
      delete withoutSignal.signal;
      return nativeFetch(input, withoutSignal);
    };
  });
  let releaseDelayedPlan;
  const delayedPlan = new Promise((resolve) => { releaseDelayedPlan = resolve; });
  const fixtures = defaultFixtures();
  fixtures.plan = [coachingPlan(), () => delayedPlan];
  const requests = await mockCoachApi(page, fixtures);
  await page.goto('/');
  await fillHome(page);
  await page.getByRole('button', { name: '判定类型' }).click();
  await page.getByLabel('追问 1').fill('尚未做过。');
  await page.getByRole('button', { name: '再次审查' }).click();
  await page.getByRole('button', { name: '生成类型判定' }).click();
  await page.getByRole('button', { name: '生成辅导方案' }).click();
  await page.getByRole('button', { name: '换个角度' }).click();
  await expect.poll(() => requests.filter((item) => item.method === 'plan').length).toBe(2);

  await page.getByRole('button', { name: '去反馈' }).click();
  await expect(page.locator('.panel-h')).toHaveText('辅导反馈');

  releaseDelayedPlan(nextPlan());
  await page.waitForTimeout(150);
  await expect(page.locator('.panel-h')).toHaveText('辅导反馈');
});

test('模型 Markdown 会完整渲染为标题、列表、表格与代码块', async ({ page }) => {
  await mountMarkdownFixture(page, [
    '# 今日行动', '', '**优先处理** `客户投诉`', '', '~~已完成~~', '',
    '- 第一步', '- 第二步', '', '> 一周后复盘', '',
    '| 事项 | 状态 |', '| --- | --- |', '| 方案 | 进行中 |', '',
    '```json', '{"ok": true}', '```',
  ].join('\n'));

  const fixture = page.locator('#markdown-fixture');
  await expect(fixture).toHaveClass(/markdown-body/);
  await expect(fixture.locator('h1')).toHaveText('今日行动');
  await expect(fixture.locator('strong')).toHaveText('优先处理');
  await expect(fixture.locator('s')).toHaveText('已完成');
  await expect(fixture.locator('ul > li')).toHaveCount(2);
  await expect(fixture.locator('blockquote')).toContainText('一周后复盘');
  await expect(fixture.locator('table th')).toHaveText(['事项', '状态']);
  await expect(fixture.locator('pre code')).toContainText('{"ok": true}');
  await expect(fixture).not.toContainText('**优先处理**');
});

test('Markdown 渲染会转义原始 HTML 并拦截危险链接', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    window.__markdownXss = false;
    const fixture = document.createElement('section');
    fixture.id = 'markdown-fixture';
    document.body.appendChild(fixture);
    window.renderMarkdown(fixture, [
      '<img data-markdown-xss="1" src="x" onerror="window.__markdownXss=true">', '',
      '<svg data-svg-xss="1" onload="window.__markdownXss=true"></svg>', '',
      '<iframe data-frame-xss="1" srcdoc="<script>window.__markdownXss=true</script>"></iframe>', '',
      '[危险链接](javascript:window.__markdownXss=true)', '',
      '[混合大小写](JaVaScRiPt:window.__markdownXss=true)', '',
      '[实体混淆](java&#x73;cript:window.__markdownXss=true)', '',
      '[数据链接](data:text/html,unsafe)', '', '[协议相对链接](//attacker.invalid/path)', '',
      '[安全链接](https://example.com/guide)', '', '![远程追踪图](https://attacker.invalid/pixel.png)',
    ].join('\n'));
  });

  const fixture = page.locator('#markdown-fixture');
  await expect(fixture.locator('[data-markdown-xss]')).toHaveCount(0);
  await expect(fixture.locator('[data-svg-xss], [data-frame-xss], svg, iframe')).toHaveCount(0);
  await expect(fixture.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(fixture.locator('a')).toHaveCount(1);
  await expect(fixture.locator('img, [src]')).toHaveCount(0);
  await expect(fixture.locator('.markdown-image')).toContainText('远程追踪图');
  await expect(fixture).toContainText('<img data-markdown-xss="1"');
  await expect(fixture.getByRole('link', { name: '安全链接' })).toHaveAttribute('href', 'https://example.com/guide');
  await expect(fixture.getByRole('link', { name: '安全链接' })).toHaveAttribute('target', '_blank');
  await expect(fixture.getByRole('link', { name: '安全链接' })).toHaveAttribute('rel', /noopener.*noreferrer.*nofollow/);
  await expect(fixture.getByRole('link', { name: '安全链接' })).toHaveAttribute('referrerpolicy', 'no-referrer');
  expect(await page.evaluate(() => window.__markdownXss)).toBe(false);
});

test('Markdown 重复渲染会替换旧内容且空值不会显示 undefined', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const fixture = document.createElement('section');
    fixture.id = 'markdown-fixture';
    document.body.appendChild(fixture);
    window.renderMarkdown(fixture, '# 第一版');
    window.renderMarkdown(fixture, '**第二版**');
  });

  const fixture = page.locator('#markdown-fixture');
  await expect(fixture.locator('h1')).toHaveCount(0);
  await expect(fixture.locator('strong')).toHaveText('第二版');
  await page.evaluate(() => window.renderMarkdown(document.getElementById('markdown-fixture'), null));
  await expect(fixture).toBeEmpty();
});

test('窄屏下长代码块只在自身横向滚动', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await mountMarkdownFixture(page, `\`\`\`text\n${'x'.repeat(320)}\n\`\`\``);

  const overflow = await page.evaluate(() => {
    const code = document.querySelector('#markdown-fixture pre');
    return {
      codeScrollable: code.scrollWidth > code.clientWidth,
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  expect(overflow).toEqual({ codeScrollable: true, pageOverflow: false });
});

test('辅导反馈的模型建议通过 Markdown 渲染器展示', async ({ page }) => {
  await advanceToPlan(page);
  await expect(page.locator('#coach-plan .markdown-body')).toHaveCount(4);
  await expect(page.locator('#coach-plan .markdown-body').first().locator('strong')).toContainText('先认可');
  await page.getByRole('button', { name: '去反馈' }).click();
  await page.getByLabel('本次沟通后的情况').fill('员工本周主动同步了项目风险。');
  await page.getByRole('button', { name: '生成下一步建议' }).click();

  const output = page.locator('#followout .markdown-body');
  await expect(output.locator('strong')).toContainText('进展');
  await expect(output.first()).not.toContainText('**进展：**');
  await expect(page.locator('#feedback-next-steps')).toContainText('Situation（情境）');
  await expect(page.locator('#feedback-next-steps')).toContainText('Behavior（行为）');
  await expect(page.locator('#feedback-next-steps')).toContainText('Impact（影响）');
});

test('生成下一步建议后保留用户提交的反馈文本', async ({ page }) => {
  const feedbackText = '员工本周主动同步了项目风险，并按约定提交了里程碑。';
  await advanceToPlan(page);
  await page.getByRole('button', { name: '去反馈' }).click();
  const feedbackInput = page.getByLabel('本次沟通后的情况');
  await feedbackInput.fill(feedbackText);
  await page.getByRole('button', { name: '生成下一步建议' }).click();

  await expect(page.locator('#feedback-next-steps')).toContainText('Situation（情境）');
  await expect(page.locator('#feedback-next-steps')).toContainText('Behavior（行为）');
  await expect(page.locator('#feedback-next-steps')).toContainText('Impact（影响）');
  await expect(feedbackInput).toHaveValue(feedbackText);
});

test('工作区返回首页后重新进入反馈页不会保留上一轮反馈文本', async ({ page }) => {
  const fixtures = defaultFixtures();
  fixtures.intake = [...fixtures.intake, ...fixtures.intake];
  await advanceToPlan(page, fixtures);
  await page.getByRole('button', { name: '去反馈' }).click();
  await page.getByLabel('本次沟通后的情况').fill('第一轮反馈不应带入下一轮。');
  await page.getByRole('button', { name: '生成下一步建议' }).click();
  await expect(page.locator('#feedback-next-steps')).toContainText('Situation（情境）');
  await expect(page.locator('#feedback-next-steps')).toContainText('Behavior（行为）');
  await expect(page.locator('#feedback-next-steps')).toContainText('Impact（影响）');
  await page.locator('#workspace-return-home').click();

  await expect(page.getByRole('heading', { name: '因材施教，给每个人对的辅导方式' })).toBeVisible();
  await fillHome(page);
  await page.getByRole('button', { name: '判定类型' }).click();
  await page.getByLabel('追问 1').fill('尚未做过。');
  await page.getByRole('button', { name: '再次审查' }).click();
  await page.getByRole('button', { name: '生成类型判定' }).click();
  await page.getByRole('button', { name: '生成辅导方案' }).click();
  await page.getByRole('button', { name: '去反馈' }).click();
  const feedbackInput = page.getByLabel('本次沟通后的情况');
  await expect(feedbackInput).toHaveValue('');
});

test('刷新后重新进入反馈页不会保留上一轮反馈文本', async ({ page }) => {
  const fixtures = defaultFixtures();
  fixtures.intake = [...fixtures.intake, ...fixtures.intake];
  await advanceToPlan(page, fixtures);
  await page.getByRole('button', { name: '去反馈' }).click();
  const feedbackInput = page.getByLabel('本次沟通后的情况');
  await feedbackInput.fill('刷新前的反馈不应保留。');
  await page.getByRole('button', { name: '生成下一步建议' }).click();
  await expect(page.locator('#feedback-next-steps')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: '因材施教，给每个人对的辅导方式' })).toBeVisible();
  await fillHome(page);
  await page.getByRole('button', { name: '判定类型' }).click();
  await page.getByLabel('追问 1').fill('尚未做过。');
  await page.getByRole('button', { name: '再次审查' }).click();
  await page.getByRole('button', { name: '生成类型判定' }).click();
  await page.getByRole('button', { name: '生成辅导方案' }).click();
  await page.getByRole('button', { name: '去反馈' }).click();

  await expect(page.getByLabel('本次沟通后的情况')).toHaveValue('');
});

test('窄屏教练方案页不会产生整页横向滚动', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await advanceToPlan(page);

  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
});

test('复制方案会把当前方案正文写入剪贴板', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text) => { window.__copiedText = text; } },
    });
  });
  await advanceToPlan(page);
  await page.getByRole('button', { name: '复制方案' }).click();

  await expect.poll(() => page.evaluate(() => window.__copiedText || ''))
    .toContain('沟通切入点');
  await expect.poll(() => page.evaluate(() => window.__copiedText || ''))
    .toContain('话术示例');
});

test('剪贴板与旧式复制都不可用时会清理临时节点并提示失败', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => { throw new Error('denied'); } },
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: undefined });
  });
  await advanceToPlan(page);
  await page.getByRole('button', { name: '复制方案' }).click();

  await expect(page.locator('#toast')).toContainText('复制失败');
  await expect(page.locator('textarea[readonly]')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
