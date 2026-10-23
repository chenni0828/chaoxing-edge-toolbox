import { mountApiSettings } from '../features/api-settings/ui';
import { mountAppearanceSettings } from '../features/floating-toolbox/appearance-ui';
import { mountToolboxSettings } from '../features/toolbox-settings/ui';
import { mountUpdateCheck } from '../features/update-check/ui';
import { icon } from '../features/floating-toolbox/icons';

type SettingsSection = 'api' | 'features' | 'floating';

const sections = ['api', 'features', 'floating'] as const;
const cleanups: Array<() => void> = [];
const brand = document.querySelector('.brand-mark');
if (brand) brand.innerHTML = icon('logo', 36);
const version = document.getElementById('version');
if (version) version.textContent = `v${chrome.runtime.getManifest().version}`;
const updateRoot = document.getElementById('settings-update');
if (updateRoot) cleanups.push(mountUpdateCheck(updateRoot));

for (const [id, mount] of [
  ['api', mountApiSettings],
  ['features', mountToolboxSettings],
  ['floating', mountAppearanceSettings],
] as const) {
  const root = document.getElementById(`settings-${id}`);
  if (root) cleanups.push(mount(root));
}

function navigate(section: SettingsSection): void {
  for (const id of sections) {
    const panel = document.getElementById(`settings-${id}`);
    const link = document.querySelector<HTMLAnchorElement>(`a[href="#${id}"]`);
    if (panel) panel.hidden = id !== section;
    if (id === section) link?.setAttribute('aria-current', 'page');
    else link?.removeAttribute('aria-current');
  }
  document.title = `${section === 'api' ? '学习通 API 设置' : section === 'features' ? '功能设置' : '悬浮框设置'} · 学习工具箱`;
}

function followHash(): void {
  const value = location.hash.slice(1);
  navigate(sections.includes(value as SettingsSection) ? value as SettingsSection : 'features');
}

const onMessage = (message: unknown, sender: chrome.runtime.MessageSender): void => {
  if (sender.id !== chrome.runtime.id || !message || typeof message !== 'object') return;
  const data = message as { type?: unknown; section?: unknown };
  if (data.type !== 'toolbox:settings-section' || !sections.includes(data.section as SettingsSection)) return;
  location.hash = data.section as SettingsSection;
  followHash();
};

window.addEventListener('hashchange', followHash);
chrome.runtime.onMessage.addListener(onMessage);
window.addEventListener('unload', () => {
  for (const cleanup of cleanups) cleanup();
  window.removeEventListener('hashchange', followHash);
  chrome.runtime.onMessage.removeListener(onMessage);
}, { once: true });
followHash();
