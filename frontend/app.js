import {
  clearDownstream,
  isCurrentEpoch,
  markSubmission,
  matchesSubmission,
  resetSession,
  session,
  setAnswers,
  setBlocked,
  setBusy,
  setClassification,
  setError,
  setFeedback,
  setFeedbackText,
  setIntake,
  setIntakeResult,
  setPlan,
  setScreen,
  setSelectedProfileId,
  setSelectedTraits,
  setTraitNote,
} from './state.js';
import {
  cancelPendingRequests,
  classify,
  generatePlan,
  intake,
  resetApiState,
  submitFeedback,
} from './api.js';
import { renderApp } from './views.js';
import { publicProfileId, resolveFinalClassification } from './profile-selection.js';
import { BUSY_ACTIONS, waitForMinimumLoading } from './loading.js';

const root = document.getElementById('app');
const toastElement = document.getElementById('toast');

function toast(message) {
  toastElement.textContent = message;
  toastElement.classList.add('show');
  clearTimeout(toastElement._timeout);
  toastElement._timeout = setTimeout(() => toastElement.classList.remove('show'), 1800);
}

function returnHome() {
  resetApiState();
  resetSession();
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

const PREVIOUS_SCREEN = Object.freeze({
  classification: ['intake', 1],
  plan: ['classification', 2],
  feedback: ['plan', 3],
});

function startCoaching() {
  cancelPendingRequests();
  setBusy(false);
  setError(null);
  setScreen('intake', 1);
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goPrevious() {
  const target = PREVIOUS_SCREEN[session.screen];
  if (!target) return;
  cancelPendingRequests();
  if (session.screen === 'feedback') {
    const feedbackInput = document.getElementById('feedback-text');
    if (feedbackInput) setFeedbackText(feedbackInput.value);
  }
  setBusy(false);
  setError(null);
  setScreen(target[0], target[1]);
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function planSummary() {
  if (!session.plan) return '';
  return [
    ...(session.plan.entry || []),
    ...(session.plan.cautions || []),
    session.plan.frequency || '',
    ...(session.plan.gap_fix || []),
    ...(session.plan.scripts || []),
  ].join('\n');
}

async function requestWithLoading(action, request) {
  const startedAt = performance.now();
  setBusy(true, action);
  render();
  const result = await request();
  await waitForMinimumLoading(startedAt);
  return result;
}

function consume(result) {
  if (result.stale || !isCurrentEpoch(result.requestEpoch)) return null;
  setBusy(false);
  if (result.blocked) {
    setBlocked({ code: result.code || 'HR_REVIEW_REQUIRED' });
    setScreen('blocked');
    render();
    return null;
  }
  if (!result.ok || !result.data || typeof result.data !== 'object') {
    setError(result.message || '请求未完成，请稍后重试。');
    render();
    return null;
  }
  return result.data;
}

async function reviewIntake(values, answers = session.answers) {
  const payload = {
    intake: values,
    answers: Object.fromEntries(
      answers.map(({ question, answer }) => [question, answer]),
    ),
  };
  setIntake(values);
  setAnswers(answers);
  if (matchesSubmission('intake', payload) && session.intakeResult) {
    setError(null);
    setScreen(
      session.intakeResult.sufficient ? 'classification' : 'intake',
      session.intakeResult.sufficient ? 2 : 1,
    );
    render();
    return;
  }
  clearDownstream('intake');
  setError(null);
  const result = await requestWithLoading(
    BUSY_ACTIONS.INTAKE_REVIEW,
    () => intake(payload),
  );
  const data = consume(result);
  if (!data) return;
  if (data.high_risk_personnel_action || data.status === '高风险停止') {
    setBlocked({ code: 'HR_REVIEW_REQUIRED' });
    setScreen('blocked');
  } else {
    markSubmission('intake', payload);
    setIntakeResult(data);
    setScreen(data.sufficient ? 'classification' : 'intake', data.sufficient ? 2 : 1);
  }
  render();
}

async function reviewAgain(answers) {
  await reviewIntake(session.intake, answers);
}

async function generateClassification() {
  const normalizedProfile = session.intakeResult && session.intakeResult.normalized_profile;
  if (!normalizedProfile) {
    setError('缺少可用于判定的结构化信息，请重新审查。');
    render();
    return;
  }
  const payload = { normalizedProfile };
  if (!matchesSubmission('classification', payload)) {
    clearDownstream('classification');
  }
  setError(null);
  const result = await requestWithLoading(
    BUSY_ACTIONS.CLASSIFICATION_GENERATE,
    () => classify(payload),
  );
  const data = consume(result);
  if (!data) return;
  markSubmission('classification', payload);
  setClassification(data);
  setSelectedProfileId(data.status === '已判定' ? publicProfileId(data.type_id) : null);
  setScreen('classification', 2);
  render();
}

function selectProfile(profileId) {
  if (!session.classification || session.classification.status !== '已判定') return;
  if (session.selectedProfileId === profileId) return;
  setSelectedProfileId(profileId);
  clearDownstream('classification');
  setError(null);
  render();
}

function toggleTrait(trait) {
  const selected = session.selectedTraits.includes(trait)
    ? session.selectedTraits.filter((item) => item !== trait)
    : [...session.selectedTraits, trait];
  setSelectedTraits(selected);
  return session.selectedTraits.includes(trait);
}

function updateTraitNote(value) {
  setTraitNote(value);
}

function finalClassification() {
  return resolveFinalClassification(
    session.classification,
    session.selectedProfileId || publicProfileId(session.classification?.type_id),
    session.intake,
  );
}

async function requestPlan(regenerate) {
  if (!session.classification || session.classification.status !== '已判定') return;
  const planInput = {
    classification: finalClassification(),
    normalizedProfile: session.intakeResult && session.intakeResult.normalized_profile,
    pain: session.intake.pain || '',
  };
  if (!regenerate && session.plan && matchesSubmission('plan', planInput)) {
    setError(null);
    setScreen('plan', 3);
    render();
    return;
  }
  setError(null);
  const result = await requestWithLoading(
    regenerate ? BUSY_ACTIONS.PLAN_REGENERATE : BUSY_ACTIONS.PLAN_GENERATE,
    () => generatePlan({
      ...planInput,
      regenerate,
      previousPlan: regenerate ? session.plan : null,
    }),
  );
  const data = consume(result);
  if (!data) return;
  clearDownstream('plan');
  setPlan(data);
  markSubmission('plan', planInput);
  setScreen('plan', 3);
  render();
}

async function generateFeedback(feedbackText) {
  setFeedbackText(feedbackText);
  setError(null);
  const result = await requestWithLoading(
    BUSY_ACTIONS.FEEDBACK_GENERATE,
    () => submitFeedback({
      classification: finalClassification(),
      planSummary: planSummary(),
      feedbackText,
    }),
  );
  const data = consume(result);
  if (!data) return;
  setFeedback(data);
  setScreen('feedback', 4);
  render();
}

async function copyPlan() {
  const target = document.getElementById('coach-plan');
  if (!target) {
    toast('没有可复制内容');
    return;
  }
  const text = target.innerText.trim();
  try {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(text);
    toast('已复制方案');
  } catch {
    let input;
    try {
      input = document.createElement('textarea');
      input.value = text;
      input.readOnly = true;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      const copied = typeof document.execCommand === 'function' && document.execCommand('copy');
      toast(copied ? '已复制方案' : '复制失败，请手动选择内容');
    } catch {
      toast('复制失败，请手动选择内容');
    } finally {
      input?.remove();
    }
  }
}

function continueSupplement() {
  const questions = session.classification && session.classification.questions;
  setIntakeResult({ ...session.intakeResult, questions: Array.isArray(questions) ? questions : [] });
  setClassification(null);
  setSelectedProfileId(null);
  setScreen('intake', 1);
  render();
}

const handlers = {
  startCoaching,
  reviewIntake,
  reviewAgain,
  generateClassification,
  selectProfile,
  toggleTrait,
  updateTraitNote,
  generatePlan: () => requestPlan(false),
  regeneratePlan: () => requestPlan(true),
  generateFeedback,
  copyPlan,
  goFeedback: () => {
    cancelPendingRequests();
    setBusy(false);
    setError(null);
    setScreen('feedback', 4);
    render();
  },
  continueSupplement,
  goPrevious,
  goHome: returnHome,
};

function render() {
  renderApp(root, session, handlers);
}

document.getElementById('home-brand').addEventListener('click', returnHome);
document.getElementById('top-return-home').addEventListener('click', returnHome);
window.addEventListener('beforeunload', cancelPendingRequests);
render();
