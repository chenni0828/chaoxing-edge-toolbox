import { readAnswerPacing, saveAnswerPacing, subscribeAnswerPacing } from './client';
import { defaultAnswerPacing, validateAnswerPacing, type AnswerPacingPreferences } from './types';

export function mountPacingSettings(root: HTMLElement): () => void {
  root.innerHTML = `<div class="card"><div class="section-heading"><h2>答题速度</h2><p>请求频率在所有标签页之间共享；填写等待计入接口耗时。</p></div>
    <form class="settings-form">
      <div class="field"><label for="pacing-bank">言溪请求最小间隔（秒）</label><input id="pacing-bank" type="number" min="1" step="any" required disabled></div>
      <div class="field"><label for="pacing-ai">AI 请求最小间隔（秒）</label><input id="pacing-ai" type="number" min="1" step="any" required disabled></div>
      <div class="field"><label for="pacing-fill">每题最低处理时间（秒）</label><input id="pacing-fill" type="number" min="0.001" step="any" required disabled><p class="field-help">默认 3 秒。接口耗时超过该值时直接填入；连续填写也保持此间隔。</p></div>
      <div class="button-row"><button class="primary" type="submit" disabled>保存速度设置</button></div>
      <p class="feedback" role="status" aria-live="polite">正在读取速度设置…</p>
    </form></div>`;
  const form = root.querySelector('form')!;
  const bank = root.querySelector<HTMLInputElement>('#pacing-bank')!;
  const ai = root.querySelector<HTMLInputElement>('#pacing-ai')!;
  const fill = root.querySelector<HTMLInputElement>('#pacing-fill')!;
  const status = root.querySelector<HTMLElement>('[role="status"]')!;
  const button = root.querySelector('button')!;
  let disposed = false;
  let saving = false;
  let revision = 0;
  function show(value: AnswerPacingPreferences) {
    bank.value = String(value.bankIntervalMs / 1000); ai.value = String(value.aiIntervalMs / 1000); fill.value = String(value.minimumQuestionMs / 1000);
  }
  function disable(value: boolean) { for (const input of [bank, ai, fill]) input.disabled = value; button.disabled = value; }
  async function load() {
    const own = ++revision;
    try {
      const value = await readAnswerPacing();
      if (disposed || revision !== own) return;
      show(value); disable(false); status.textContent = '更改后点击保存；运行中的答题会暂停。';
    } catch { if (!disposed && revision === own) { status.textContent = '读取失败，请重新打开设置页。'; disable(true); } }
  }
  const submit = (event: SubmitEvent) => {
    event.preventDefault(); if (saving || disposed) return;
    const preferences = { ...defaultAnswerPacing(), bankIntervalMs: Number(bank.value) * 1000, aiIntervalMs: Number(ai.value) * 1000, minimumQuestionMs: Number(fill.value) * 1000 };
    try { validateAnswerPacing(preferences); } catch (error) { status.textContent = (error as Error).message; return; }
    saving = true; ++revision; disable(true);
    void saveAnswerPacing(preferences).then(() => { if (!disposed) status.textContent = '速度设置已保存，点击开始继续答题。'; })
      .catch(() => { if (!disposed) status.textContent = '保存失败，请重试。'; })
      .finally(() => { saving = false; if (!disposed) disable(false); });
  };
  form.addEventListener('submit', submit);
  const unsubscribe = subscribeAnswerPacing(() => { if (!saving) void load(); });
  void load();
  return () => { disposed = true; unsubscribe(); form.removeEventListener('submit', submit); root.replaceChildren(); };
}
