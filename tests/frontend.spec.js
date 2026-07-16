const { test, expect } = require('@playwright/test');

async function advanceToPlan(page) {
  await page.goto('/');
  await page.getByRole('button', { name: /开始辅导/ }).click();
  await page.getByRole('button', { name: /判定类型/ }).click();
  await expect(page.locator('.panel-h')).toHaveText('类型判定');
  await page.getByRole('button', { name: /生成方案/ }).click();
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

test('模型 Markdown 会完整渲染为标题、列表、表格与代码块', async ({ page }) => {
  await mountMarkdownFixture(page, [
    '# 今日行动',
    '',
    '**优先处理** `客户投诉`',
    '',
    '~~已完成~~',
    '',
    '- 第一步',
    '- 第二步',
    '',
    '> 一周后复盘',
    '',
    '| 事项 | 状态 |',
    '| --- | --- |',
    '| 方案 | 进行中 |',
    '',
    '```json',
    '{"ok": true}',
    '```',
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
      '<img data-markdown-xss="1" src="x" onerror="window.__markdownXss=true">',
      '',
      '<svg data-svg-xss="1" onload="window.__markdownXss=true"></svg>',
      '',
      '<iframe data-frame-xss="1" srcdoc="<script>window.__markdownXss=true</script>"></iframe>',
      '',
      '[危险链接](javascript:window.__markdownXss=true)',
      '',
      '[混合大小写](JaVaScRiPt:window.__markdownXss=true)',
      '',
      '[实体混淆](java&#x73;cript:window.__markdownXss=true)',
      '',
      '[数据链接](data:text/html,unsafe)',
      '',
      '[协议相对链接](//attacker.invalid/path)',
      '',
      '[安全链接](https://example.com/guide)',
      '',
      '![远程追踪图](https://attacker.invalid/pixel.png)',
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
  await expect(page.locator('#coach-plan .markdown-body')).toHaveCount(5);
  await expect(page.locator('#coach-plan .markdown-body').first().locator('strong')).toContainText('先认可');
  await page.getByRole('button', { name: /去反馈/ }).click();
  await page.getByRole('button', { name: /生成下一步建议/ }).click();

  const output = page.locator('#followout .markdown-body');
  await expect(output.locator('strong')).toContainText('下一步建议');
  await expect(output.locator('ol > li')).toHaveCount(3);
  await expect(output).not.toContainText('**下一步建议**');
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
      value: {
        writeText: async (text) => {
          window.__copiedText = text;
        },
      },
    });
  });
  await advanceToPlan(page);

  await page.getByRole('button', { name: /复制方案/ }).click();

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
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: undefined,
    });
  });
  await advanceToPlan(page);

  await page.getByRole('button', { name: /复制方案/ }).click();

  await expect(page.locator('#toast')).toContainText('复制失败');
  await expect(page.locator('textarea[readonly]')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
