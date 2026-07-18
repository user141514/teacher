const express = require('express');
const { findHighRiskIntent } = require('./guardrails.js');

const ERROR_MESSAGES = {
  INVALID_REQUEST: '请求无效，请检查后重试。',
  INTERNAL_ERROR: '服务内部错误，请稍后重试。',
  NOT_FOUND: '接口不存在。',
  REQUEST_TOO_LARGE: '请求体过大，请精简后重试。',
  SERVICE_UNAVAILABLE: '服务暂不可用，请稍后重试。',
};

function sendError(response, status, code) {
  response.status(status).json({
    ok: false,
    code,
    message: ERROR_MESSAGES[code],
  });
}

function createApp({ coachService } = {}) {
  const app = express();

  app.use('/api', (request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', express.json({ limit: '32kb' }));

  app.get('/api/health', (request, response) => {
    response.json({ ok: true });
  });

  for (const method of ['intake', 'classify', 'plan', 'feedback']) {
    app.post(`/api/coach/${method}`, async (request, response) => {
      const highRiskIntent = findHighRiskIntent(request.body);
      if (highRiskIntent) {
        response.json({ ok: true, blocked: true, ...highRiskIntent });
        return;
      }

      if (!coachService || typeof coachService[method] !== 'function') {
        sendError(response, 503, 'SERVICE_UNAVAILABLE');
        return;
      }

      try {
        const result = await coachService[method](request.body);
        response.json({ ok: true, blocked: false, data: result });
      } catch {
        sendError(response, 500, 'INTERNAL_ERROR');
      }
    });
  }

  app.use('/api', (request, response) => {
    sendError(response, 404, 'NOT_FOUND');
  });

  app.use((error, request, response, next) => {
    if (!request.originalUrl.startsWith('/api')) {
      next(error);
      return;
    }

    if (error.type === 'entity.parse.failed') {
      sendError(response, 400, 'INVALID_REQUEST');
      return;
    }

    if (error.type === 'entity.too.large') {
      sendError(response, 413, 'REQUEST_TOO_LARGE');
      return;
    }

    sendError(response, 500, 'INTERNAL_ERROR');
  });

  return app;
}

module.exports = { createApp };
