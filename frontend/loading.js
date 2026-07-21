export const MIN_LOADING_MS = 300;

export const BUSY_ACTIONS = Object.freeze({
  INTAKE_REVIEW: 'intake-review',
  CLASSIFICATION_GENERATE: 'classification-generate',
  PLAN_GENERATE: 'plan-generate',
  PLAN_REGENERATE: 'plan-regenerate',
  FEEDBACK_GENERATE: 'feedback-generate',
});

export function remainingLoadingDelay(startedAt, now = performance.now()) {
  return Math.max(0, MIN_LOADING_MS - Math.max(0, now - startedAt));
}

export async function waitForMinimumLoading(startedAt) {
  const remaining = remainingLoadingDelay(startedAt);
  if (remaining > 0) {
    await new Promise((resolve) => window.setTimeout(resolve, remaining));
  }
}
