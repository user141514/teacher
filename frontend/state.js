const SESSION_KEYS = new Set([
  'screen', 'step', 'busy', 'intake', 'answers', 'intakeResult',
  'classification', 'plan', 'feedback', 'feedbackText', 'blocked', 'error',
]);

export function createInitialState() {
  return {
    screen: 'home',
    step: 1,
    busy: false,
    requestEpoch: 0,
    intake: {},
    answers: [],
    intakeResult: null,
    classification: null,
    plan: null,
    feedback: null,
    feedbackText: '',
    blocked: null,
    error: null,
  };
}

export const session = createInitialState();

export function updateSession(patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (!SESSION_KEYS.has(key)) {
      throw new TypeError(`Unsupported session field: ${key}`);
    }
    session[key] = value;
  }
}

export function setScreen(screen, step) {
  updateSession({ screen, ...(step ? { step } : {}) });
}

export function setBusy(busy) {
  updateSession({ busy: Boolean(busy) });
}

export function setIntake(intake) {
  updateSession({ intake: { ...intake } });
}

export function setAnswers(answers) {
  updateSession({ answers: Array.isArray(answers) ? answers.map((item) => ({ ...item })) : [] });
}

export function setIntakeResult(intakeResult) {
  updateSession({ intakeResult });
}

export function setClassification(classification) {
  updateSession({ classification });
}

export function setPlan(plan) {
  updateSession({ plan });
}

export function setFeedback(feedback) {
  updateSession({ feedback });
}

export function setFeedbackText(feedbackText) {
  updateSession({ feedbackText: String(feedbackText || '') });
}

export function setBlocked(blocked) {
  updateSession({ blocked });
}

export function setError(error) {
  updateSession({ error: error || null });
}

export function isCurrentEpoch(epoch) {
  return epoch === session.requestEpoch;
}

export function beginRequestEpoch() {
  session.requestEpoch += 1;
  return session.requestEpoch;
}

export function invalidateRequestEpoch() {
  return beginRequestEpoch();
}

export function resetSession() {
  const nextEpoch = invalidateRequestEpoch();
  Object.assign(session, createInitialState(), { requestEpoch: nextEpoch });
  return nextEpoch;
}
