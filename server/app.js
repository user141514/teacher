const express = require('express');
const { findHighRiskIntent } = require('./guardrails.js');

const ERROR_MESSAGES = {
  INVALID_REQUEST: '请求无效，请检查后重试。',
  INTERNAL_ERROR: '服务内部错误，请稍后重试。',
  NOT_FOUND: '接口不存在。',
  REQUEST_TOO_LARGE: '请求体过大，请精简后重试。',
  SERVICE_UNAVAILABLE: '服务暂不可用，请稍后重试。',
};

const SAFE_SERVICE_ERRORS = Object.freeze({
  INVALID_REQUEST: {
    status: 400,
    code: 'INVALID_REQUEST',
    message: '请求无效，请检查后重试。',
  },
  CLASSIFICATION_NOT_READY: {
    status: 409,
    code: 'CLASSIFICATION_NOT_READY',
    message: '类型尚未完成判定，请先补充或人工确认。',
  },
  INVALID_MODEL_RESPONSE: {
    status: 502,
    code: 'INVALID_MODEL_RESPONSE',
    message: '模型响应无效，请稍后重试。',
  },
  MODEL_SERVICE_UNAVAILABLE: {
    status: 503,
    code: 'SERVICE_UNAVAILABLE',
    message: '模型服务暂不可用，请稍后重试。',
  },
});

const HR_REVIEW_RESPONSE = Object.freeze({
  code: 'HR_REVIEW_REQUIRED',
  message: '该事项涉及高风险人事决策，请转交 HR 按公司制度处理。本工具仅可协助准备一般辅导沟通。',
});

function sendError(response, status, code) {
  response.status(status).json({
    ok: false,
    code,
    message: ERROR_MESSAGES[code],
  });
}

function sendSafeServiceError(response, code) {
  if (!Object.hasOwn(SAFE_SERVICE_ERRORS, code)) {
    sendError(response, 500, 'INTERNAL_ERROR');
    return;
  }

  const safeError = SAFE_SERVICE_ERRORS[code];
  response.status(safeError.status).json({
    ok: false,
    code: safeError.code,
    message: safeError.message,
  });
}

function sendBlocked(response) {
  response.json({ ok: true, blocked: true, ...HR_REVIEW_RESPONSE });
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
        sendBlocked(response);
        return;
      }

      if (!coachService || typeof coachService[method] !== 'function') {
        sendError(response, 503, 'SERVICE_UNAVAILABLE');
        return;
      }

      try {
        const result = await coachService[method](request.body);
        if (result && result.ok === false) {
          sendSafeServiceError(response, result.code);
          return;
        }

        if (result && result.blocked === true) {
          if (result.code === HR_REVIEW_RESPONSE.code) {
            sendBlocked(response);
          } else {
            sendError(response, 500, 'INTERNAL_ERROR');
          }
          return;
        }

        response.json({ ok: true, blocked: false, data: result });
      } catch (error) {
        sendSafeServiceError(response, error && error.code);
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
