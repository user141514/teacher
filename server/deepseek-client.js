const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';

function controlledError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function invalidModelResponse() {
  const error = controlledError('INVALID_MODEL_RESPONSE');
  error.retryable = true;
  return error;
}

function modelServiceUnavailable() {
  return controlledError('MODEL_SERVICE_UNAVAILABLE');
}

function createDeepSeekClient({ fetchImpl = globalThis.fetch, apiKey } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw controlledError('MODEL_SERVICE_UNAVAILABLE');
  }

  async function complete({
    messages,
    validate,
    temperature = 0.2,
    maxTokens = 1200,
  } = {}) {
    if (!Array.isArray(messages) || typeof validate !== 'function') {
      throw controlledError('INVALID_MODEL_REQUEST');
    }

    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      throw controlledError('MODEL_SERVICE_UNAVAILABLE');
    }

    const requestBody = JSON.stringify({
      model: 'deepseek-v4-pro',
      stream: false,
      temperature,
      max_tokens: maxTokens,
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
      messages,
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetchImpl(DEEPSEEK_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          signal: AbortSignal.timeout(30_000),
          body: requestBody,
        });

        if (!response || !response.ok) {
          throw modelServiceUnavailable();
        }

        let responseBody;
        try {
          responseBody = await response.json();
        } catch {
          throw invalidModelResponse();
        }

        const choice = responseBody && responseBody.choices && responseBody.choices[0];
        const content = choice && choice.message && choice.message.content;
        if (!choice || choice.finish_reason !== 'stop' || typeof content !== 'string' || content.trim() === '') {
          throw invalidModelResponse();
        }

        let parsed;
        try {
          parsed = JSON.parse(content);
        } catch {
          throw invalidModelResponse();
        }

        if (!validate(parsed)) {
          throw invalidModelResponse();
        }

        return parsed;
      } catch (error) {
        if (error && error.retryable && attempt === 0) {
          continue;
        }

        if (error && error.code === 'INVALID_MODEL_RESPONSE') {
          throw controlledError('INVALID_MODEL_RESPONSE');
        }

        if (error && error.code === 'MODEL_SERVICE_UNAVAILABLE') {
          throw controlledError('MODEL_SERVICE_UNAVAILABLE');
        }

        throw modelServiceUnavailable();
      }
    }

    throw controlledError('INVALID_MODEL_RESPONSE');
  }

  return { complete };
}

module.exports = { createDeepSeekClient };
