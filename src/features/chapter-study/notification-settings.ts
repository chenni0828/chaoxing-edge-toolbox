import { readNotificationSettings, subscribeNotificationSettings, writeNotificationSettings } from './notification-client';
import type { StudyNotificationSettings } from './notifications';

/** Permission requests run directly in an extension-page click handler. */
export function mountStudyNotificationSettings(root: HTMLElement): () => void {
  const card = document.createElement('section');
  card.className = 'card';
  card.innerHTML = `<div class="section-heading"><h2>章节学习提醒</h2><p>等待人脸验证或任务需要手动处理时，发送系统通知。点击通知可返回课程页面。</p></div>
    <button class="secondary" type="button" disabled>正在读取通知设置…</button>
    <p role="status" aria-live="polite">工具箱内的状态提示始终显示，系统通知默认关闭。</p>`;
  root.append(card);
  const button = card.querySelector('button')!;
  const feedback = card.querySelector<HTMLElement>('[role="status"]')!;
  let settings: StudyNotificationSettings | undefined;
  let saving = false;
  let disposed = false;
  let revision = 0;
  const render = () => {
    if (disposed) return;
    button.disabled = saving || !settings;
    button.textContent = saving ? '正在保存…' : settings?.enabled ? '关闭系统通知' : '开启系统通知';
  };
  const unsubscribe = subscribeNotificationSettings(value => { revision++; settings = value; render(); });
  const initial = revision;
  void readNotificationSettings().then(value => { if (revision === initial) settings = value; render(); })
    .catch(() => { feedback.textContent = '通知设置读取失败，请刷新设置页重试。'; });
  const click = () => {
    if (!settings || saving || disposed) return;
    const enabled = !settings.enabled;
    // Do not await storage or send a message before requesting the permission.
    const permission = enabled ? chrome.permissions.request({ permissions: ['notifications'] }) : Promise.resolve(true);
    saving = true;
    render();
    void permission.then(async granted => {
      if (disposed) return;
      if (!granted) { feedback.textContent = '未授权系统通知，工具箱内的提示仍然可用。'; return; }
      settings = await writeNotificationSettings(enabled);
      feedback.textContent = enabled ? '系统通知已开启。同一次验证只提醒一次。' : '系统通知已关闭，工具箱内仍显示状态提示。';
    }).catch(() => { feedback.textContent = '通知设置保存失败，请重试。'; })
      .finally(() => { saving = false; render(); });
  };
  button.addEventListener('click', click);
  return () => { disposed = true; unsubscribe(); button.removeEventListener('click', click); card.remove(); };
}
