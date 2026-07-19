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
  await mockCoachApi(page, fixtures);
  await page.goto('/');
  await fillHome(page);
  await page.getByRole('button', { name: '审查信息' }).click();
  await expect(page.getByText('请补充：是否已做过针对性辅导？')).toBeVisible();
  await page.getByLabel('追问 1').fill('尚未做过。');
  await page.getByRole('button', { name: '再次审查' }).click();
  await expect(page.getByRole('button', { name: '生成类型判定' })).toBeEnabled();
  await page.getByRole('button', { name: '生成类型判定' }).click();
  await expect(page.locator('.panel-h')).toHaveText('类型判定');
}

async function advanceToPlan(page, fixtures) {
  await advanceToClassification(page, fixtures);
  await page.getByRole('button', { name: '生成辅导方案' }).click();
  await expect(page.locator('.panel-h')).toHaveText('教练方案生成');
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
  await expect(details).toContainText('策略：激发意愿');
  await expect(details).toContainText('教练模式：诱导式');
  await expect(details).toContainText('具体依据：员工已能独立交付复杂任务，但近期主动性不足。');
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
  await page.getByRole('button', { name: '生成下一步建议' }).click();

  const output = page.locator('#followout .markdown-body');
  await expect(output.locator('strong')).toContainText('进展');
  await expect(output.first()).not.toContainText('**进展：**');
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
