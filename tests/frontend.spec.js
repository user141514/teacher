const { test, expect } = require('@playwright/test');
const {
  coachingPlan,
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

async function fillHome(page) {
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
  await page.getByRole('button', { name: '审查信息' }).click();
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

test('页面和健康检查由同一服务提供', async ({ page, request }) => {
  const health = await request.get('/api/health');

  expect(health.ok()).toBe(true);
  expect(await health.json()).toEqual({ ok: true });
  await page.goto('/');
  expect(new URL(page.url()).origin).toBe(new URL(health.url()).origin);
});

test('首页审查会追问缺失信息，并在补充后允许生成类型判定', async ({ page }) => {
  await mockCoachApi(page);
  await page.goto('/');
  await fillHome(page);
  await page.getByRole('button', { name: '审查信息' }).click();

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

  await expect(page.getByLabel('绩效目标 / 上层期望')).toHaveValue('');
  await expect(page.getByLabel('近期辅导困扰')).toHaveValue('');
  await expect(page.getByLabel('员工特征补充')).toHaveValue('');
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })))
    .toEqual({ local: 0, session: 0 });
});

test('顶部返回首页会从方案页清空当前会话', async ({ page }) => {
  await advanceToPlan(page);

  const returnHome = page.locator('#top-return-home');
  await expect(returnHome).toBeVisible();
  await expect(returnHome).toHaveText('返回首页');
  await returnHome.click();

  await expect(page.getByRole('heading', { name: '因材施教，给每个人对的辅导方式' })).toBeVisible();
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
  await expect(page.locator('#type-card-B')).toContainText('成熟待激活型');

  await page.getByRole('button', { name: '返回上一步' }).click();
  await expect(page.getByRole('heading', { name: '因材施教，给每个人对的辅导方式' })).toBeVisible();
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

test('顶部返回首页后迟到请求不会恢复旧会话', async ({ page }) => {
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
  await page.getByRole('button', { name: '审查信息' }).click();
  await expect.poll(() => requests.filter((item) => item.method === 'intake').length).toBe(1);

  await page.locator('#top-return-home').click();
  const intakeResponseCompleted = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/coach/intake'
  ));
  releaseDelayedIntake(delayedResponseBody);
  const intakeResponse = await intakeResponseCompleted;
  await intakeResponse.finished();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));

  await expect(page.getByRole('heading', { name: '因材施教，给每个人对的辅导方式' })).toBeVisible();
  await expect(page.getByLabel('绩效目标 / 上层期望')).toHaveValue('');
  await expect(page.getByLabel('近期辅导困扰')).toHaveValue('');
  await expect(page.getByLabel('员工特征补充')).toHaveValue('');
  await expect(page.locator('.panel-h')).toHaveCount(0);
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

    await advanceToClassification(page, fixtures);

    await expect(page.getByText(status)).toBeVisible();
    await expect(page.getByRole('button', { name: /方案/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /补充|人工确认/ })).toBeVisible();
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
  await page.getByRole('button', { name: '审查信息' }).click();

  await expect(page.getByText('该事项涉及高风险人事决策，请转交 HR 按公司制度处理。本工具仅可协助准备一般辅导沟通。')).toBeVisible();
  await expect(page.getByText('模型自由文本不应出现在页面上。')).toHaveCount(0);
});

test('换个角度会用 regenerate=true 请求新的方案', async ({ page }) => {
  const fixtures = defaultFixtures();
  const requests = await mockCoachApi(page, fixtures);
  await page.goto('/');
  await fillHome(page);
  await page.getByRole('button', { name: '审查信息' }).click();
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

test('类型结果和流程步骤使用非交互类型卡片与命名导航语义', async ({ page }) => {
  await advanceToClassification(page);

  const typeCard = page.locator('#type-card-B');
  expect(await typeCard.evaluate((element) => element.tagName)).toBe('ARTICLE');
  await expect(typeCard).toContainText('成熟待激活型');

  const navigation = page.getByRole('navigation', { name: '辅导流程' });
  await expect(navigation.locator('ol > li')).toHaveCount(4);
  await expect(navigation.locator('li[aria-current="step"]')).toHaveCount(1);
});

test('类型判定显示判断可信度、策略、教练模式和具体依据', async ({ page }) => {
  await advanceToClassification(page);

  const details = page.locator('.rcard').filter({ hasText: '判定状态' });
  await expect(details).toContainText('判断可信度：中');
  await expect(details).toContainText('用人策略：激发意愿');
  await expect(details).toContainText('教练模式：诱导式');
  await expect(details.getByRole('heading', { name: '判定说明' })).toBeVisible();
  await expect(details).toContainText('员工已能独立交付复杂任务，但近期主动性不足。');
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
  await page.getByRole('button', { name: '审查信息' }).click();
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

test('顶部返回首页后重新进入反馈页不会保留上一轮反馈文本', async ({ page }) => {
  const fixtures = defaultFixtures();
  fixtures.intake = [...fixtures.intake, ...fixtures.intake];
  await advanceToPlan(page, fixtures);
  await page.getByRole('button', { name: '去反馈' }).click();
  await page.getByLabel('本次沟通后的情况').fill('第一轮反馈不应带入下一轮。');
  await page.getByRole('button', { name: '生成下一步建议' }).click();
  await expect(page.locator('#feedback-next-steps')).toContainText('Situation（情境）');
  await expect(page.locator('#feedback-next-steps')).toContainText('Behavior（行为）');
  await expect(page.locator('#feedback-next-steps')).toContainText('Impact（影响）');
  await page.locator('#top-return-home').click();

  await expect(page.getByRole('heading', { name: '因材施教，给每个人对的辅导方式' })).toBeVisible();
  await fillHome(page);
  await page.getByRole('button', { name: '审查信息' }).click();
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
  await page.getByRole('button', { name: '审查信息' }).click();
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
