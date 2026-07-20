import { beginRequestEpoch, invalidateRequestEpoch, isCurrentEpoch } from './state.js';

let pendingController = null;

export function cancelPendingRequests({ invalidate = true } = {}) {
  if (invalidate) invalidateRequestEpoch();
  if (pendingController) {
    pendingController.abort();
    pendingController = null;
  }
}

export function resetApiState() {
  cancelPendingRequests();
}

export async function request(method, payload) {
  const requestEpoch = beginRequestEpoch();
  cancelPendingRequests({ invalidate: false });
  const controller = new AbortController();
  pendingController = controller;

  try {
    const response = await fetch(`/api/coach/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    if (!isCurrentEpoch(requestEpoch)) return { stale: true, requestEpoch };
    if (!response.ok || !body || typeof body !== 'object') {
      return {
        ok: false,
        message: body && typeof body.message === 'string' ? body.message : '请求未完成，请稍后重试。',
        requestEpoch,
      };
    }
    if (body.ok === false) {
      return {
        ok: false,
        message: typeof body.message === 'string' ? body.message : '请求未完成，请稍后重试。',
        requestEpoch,
      };
    }
    return { ...body, requestEpoch };
  } catch (error) {
    if (error && error.name === 'AbortError') return { stale: true, requestEpoch };
    return isCurrentEpoch(requestEpoch)
      ? { ok: false, message: '网络连接异常，请稍后重试。', requestEpoch }
      : { stale: true, requestEpoch };
  } finally {
    if (pendingController === controller) pendingController = null;
  }
}

export function intake(payload) {
  return request('intake', payload);
}

export function classify(payload) {
  return request('classify', payload);
}

export function generatePlan(payload) {
  return request('plan', payload);
}

export function submitFeedback(payload) {
  return request('feedback', payload);
}
