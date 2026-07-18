const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const { createApp } = require('../server/app.js');
const {
  createServer,
  resolvePort,
  startServer: startHttpServer,
} = require('../server/index.js');

async function startServer(options) {
  const server = http.createServer(createApp(options));

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address();

  return {
    server,
    origin: `http://127.0.0.1:${port}`,
  };
}

async function withServer(callback, options) {
  const { server, origin } = await startServer(options);

  try {
    await callback(origin);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function withFrontendServer(callback) {
  const server = createServer();

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const { port } = server.address();
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function createDeeplyNestedJson(depth) {
  return `${'{"n":'.repeat(depth)}{}${'}'.repeat(depth)}`;
}

test('GET /api/health 返回不可缓存的健康状态', async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/api/health`);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { ok: true });
  });
});

test('未知 API 路径返回统一错误信封', async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/api/unknown`);

    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      ok: false,
      code: 'NOT_FOUND',
      message: '接口不存在。',
    });
  });
});

test('未注入辅导服务时四个辅导接口均返回服务不可用错误', async () => {
  await withServer(async (origin) => {
    for (const path of [
      '/api/coach/intake',
      '/api/coach/classify',
      '/api/coach/plan',
      '/api/coach/feedback',
    ]) {
      const response = await fetch(`${origin}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        ok: false,
        code: 'SERVICE_UNAVAILABLE',
        message: '服务暂不可用，请稍后重试。',
      });
    }
  });
});

test('四个辅导接口均在调用服务前拦截高风险人事请求', async () => {
  const calls = [];
  const coachService = Object.fromEntries([
    'intake',
    'classify',
    'plan',
    'feedback',
  ].map((method) => [method, async () => {
    calls.push(method);
    return { source: method };
  }]));

  await withServer(async (origin) => {
    for (const method of ['intake', 'classify', 'plan', 'feedback']) {
      const response = await fetch(`${origin}/api/coach/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: { notes: ['员工长期不胜任，拟解除其劳动合同'] } }),
      });

      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), {
        ok: true,
        blocked: true,
        code: 'HR_REVIEW_REQUIRED',
        message: '该事项涉及高风险人事决策，请转交 HR 按公司制度处理。本工具仅可协助准备一般辅导沟通。',
      });
    }
  }, { coachService });

  assert.deepEqual(calls, []);
});

test('5000 层非风险 JSON 请求不会中断路由并会调用辅导服务', async () => {
  const body = createDeeplyNestedJson(5000);
  const calls = [];

  assert.ok(Buffer.byteLength(body, 'utf8') < 32 * 1024);

  await withServer(async (origin) => {
    const response = await fetch(`${origin}/api/coach/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      blocked: false,
      data: { source: 'deep' },
    });
  }, {
    coachService: {
      async intake(requestBody) {
        calls.push(requestBody);
        return { source: 'deep' };
      },
    },
  });

  assert.equal(calls.length, 1);
});

test('注入的辅导服务按路由调用对应方法并封装成功结果', async () => {
  const calls = [];
  const coachService = Object.fromEntries([
    ['intake', { source: 'intake' }],
    ['classify', { source: 'classify' }],
    ['plan', { source: 'plan' }],
    ['feedback', { source: 'feedback' }],
  ].map(([method, result]) => [method, async (body) => {
    calls.push({ method, body });
    return result;
  }]));

  await withServer(async (origin) => {
    for (const method of ['intake', 'classify', 'plan', 'feedback']) {
      const body = { request: method };
      const response = await fetch(`${origin}/api/coach/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        ok: true,
        blocked: false,
        data: { source: method },
      });
    }
  }, { coachService });

  assert.deepEqual(calls, [
    { method: 'intake', body: { request: 'intake' } },
    { method: 'classify', body: { request: 'classify' } },
    { method: 'plan', body: { request: 'plan' } },
    { method: 'feedback', body: { request: 'feedback' } },
  ]);
});

test('辅导服务内部异常返回不泄露细节的 500 错误信封', async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/api/coach/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: '服务内部错误，请稍后重试。',
    });
  }, {
    coachService: {
      async intake() {
        throw new Error('sensitive service details');
      },
    },
  });
});

test('无效或超大请求体返回不泄露细节的统一错误信封', async () => {
  const invalidRequest = {
    ok: false,
    code: 'INVALID_REQUEST',
    message: '请求无效，请检查后重试。',
  };
  const requestTooLarge = {
    ok: false,
    code: 'REQUEST_TOO_LARGE',
    message: '请求体过大，请精简后重试。',
  };

  await withServer(async (origin) => {
    const malformed = await fetch(`${origin}/api/coach/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    const oversized = await fetch(`${origin}/api/coach/intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: 'x'.repeat(33 * 1024) }),
    });

    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), invalidRequest);
    assert.equal(oversized.status, 413);
    assert.deepEqual(await oversized.json(), requestTooLarge);
  });
});

test('非 API 的畸形 JSON 不返回解析细节或默认 HTML 错误页', async () => {
  await withFrontendServer(async (origin) => {
    const response = await fetch(`${origin}/not-found`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    const body = await response.text();

    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type'), /^text\/plain/);
    assert.equal(body, 'Not Found');
    assert.doesNotMatch(body, /SyntaxError|D:\\|node_modules/i);
  });
});

test('同源进程仅让 HTML 响应不可缓存', async () => {
  await withFrontendServer(async (origin) => {
    for (const path of ['/', '/index.html']) {
      const response = await fetch(`${origin}${path}`);

      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.match(response.headers.get('content-type'), /^text\/html/);
      assert.match(await response.text(), /<title>教练助手 · 交互原型<\/title>/);
    }

    const script = await fetch(`${origin}/markdown-renderer.js`);
    assert.equal(script.status, 200);
    assert.doesNotMatch(script.headers.get('cache-control') || '', /no-store/i);
  });
});

test('入口允许 port:0 测试启动，并拒绝无效端口', async () => {
  const server = startHttpServer({ port: 0 });

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.once('listening', resolve);
    });
    assert.ok(server.address().port > 0);
    assert.equal(server.address().address, '127.0.0.1');
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  assert.equal(resolvePort(undefined), 4173);
  assert.equal(resolvePort('4174'), 4174);
  assert.throws(
    () => resolvePort('0'),
    (error) => error.code === 'INVALID_PORT' && error.message === 'INVALID_PORT',
  );
  assert.throws(
    () => startHttpServer({ port: 65_536 }),
    (error) => error.code === 'INVALID_PORT' && error.message === 'INVALID_PORT',
  );
});
