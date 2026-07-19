import {
  isCurrentEpoch,
  resetSession,
  session,
  setAnswers,
  setBlocked,
  setBusy,
  setClassification,
  setError,
  setFeedback,
  setIntake,
  setIntakeResult,
  setPlan,
  setScreen,
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

function answersPayload() {
  return Object.fromEntries(session.answers.map(({ question, answer }) => [question, answer]));
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

async function reviewIntake(values, answers = []) {
  setIntake(values);
  setAnswers(answers);
  setError(null);
  setBusy(true);
  render();
  const result = await intake({ intake: values, answers: answersPayload() });
  const data = consume(result);
  if (!data) return;
  if (data.high_risk_personnel_action || data.status === '高风险停止') {
    setBlocked({ code: 'HR_REVIEW_REQUIRED' });
    setScreen('blocked');
  } else {
    setIntakeResult(data);
    setClassification(null);
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
  setError(null);
  setBusy(true);
  render();
  const result = await classify({ normalizedProfile });
  const data = consume(result);
  if (!data) return;
  setClassification(data);
  setScreen('classification', 2);
  render();
}

async function requestPlan(regenerate) {
  if (!session.classification || session.classification.status !== '已判定') return;
  setError(null);
  setBusy(true);
  render();
  const result = await generatePlan({
    classification: session.classification,
    normalizedProfile: session.intakeResult && session.intakeResult.normalized_profile,
    pain: session.intake.pain || '',
    regenerate,
    previousPlan: regenerate ? session.plan : null,
  });
  const data = consume(result);
  if (!data) return;
  setPlan(data);
  setScreen('plan', 3);
  render();
}

async function generateFeedback(feedbackText) {
  setError(null);
  setBusy(true);
  render();
  const result = await submitFeedback({
    classification: session.classification,
    planSummary: planSummary(),
    feedbackText,
  });
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
  setScreen('intake', 1);
  render();
}

const handlers = {
  reviewIntake,
  reviewAgain,
  generateClassification,
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
  goHome: returnHome,
};

function render() {
  renderApp(root, session, handlers);
}

document.getElementById('home-brand').addEventListener('click', returnHome);
document.getElementById('top-return-home').addEventListener('click', returnHome);
window.addEventListener('beforeunload', cancelPendingRequests);
render();
