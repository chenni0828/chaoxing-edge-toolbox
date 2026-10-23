import { TOOLBOX_LAYOUT } from './layout';

export const toolboxStyles = `
:host { all: initial; color-scheme: light; }
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
button, input, textarea, select { font: inherit; }
button { cursor: pointer; }
button:disabled { cursor: not-allowed; opacity: .55; }
button, textarea, input, select { -webkit-tap-highlight-color: transparent; }
button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
svg { display: block; flex: 0 0 auto; }
/* Keep this palette aligned with core/design-tokens.css. The panel owns its
   typography because the isolated host deliberately resets inherited styles. */
.panel {
  --primary: #0f766e; --primary-hover: #115e59; --focus-ring: #0d9488; --text-on-primary: #fff;
  --tint-bg: #f0fdfa; --tint-bg-strong: #ccfbf1; --tint-border: #99f6e4; --tint-border-strong: #5eead4;
  --surface: #fff; --surface-page: #f8fafc; --surface-muted: #f1f5f9;
  --border: #cbd5e1; --border-inner: #e2e8f0; --border-strong: #94a3b8;
  --text-primary: #0f172a; --text-title: #334155; --text-body: #475569; --text-muted: #64748b;
  --warning-bg: #fffbeb; --warning-text: #92400e; --warning-border: #fde68a;
  --error-bg: #fef2f2; --error-text: #b91c1c; --error-border: #fecaca;
  --radius-sm: 8px; --radius-md: 12px; --radius-lg: 16px;
  --control-height: 32px; --control-height-sm: 30px;
  --font-ui: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
  --shadow-card: 0 1px 3px #0f172a06;
  --shadow-panel: 0 8px 24px #0f172a14, 0 2px 6px #0f172a08;
  position: relative; display: flex; flex-direction: column; width: 100%;
  height: var(--toolbox-drag-height, auto); max-height: min(var(--toolbox-max-height, calc(100dvh - 24px)), ${TOOLBOX_LAYOUT.expandedMaxHeight}px, 70dvh);
  overflow: hidden; container: toolbox / inline-size; isolation: isolate;
  border-radius: var(--radius-lg); background: var(--surface); color: var(--text-primary);
  box-shadow: var(--shadow-panel);
  font: var(--font-ui);
}
.header { position: relative; flex: 0 0 auto; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 4px; width: 100%; height: ${TOOLBOX_LAYOUT.headerHeight}px; padding: 3px 7px; background: var(--surface-page); border: 1px solid var(--border); border-radius: var(--radius-lg) var(--radius-lg) 0 0; }
[data-drag-handle] { cursor: move; touch-action: none; user-select: none; }
[data-drag-handle]:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -3px; }
.brand { display: flex; flex: 1 1 auto; align-items: center; gap: 5px; min-width: 0; overflow: hidden; color: var(--primary); white-space: nowrap; }
.header-copy { display: flex; align-items: center; gap: 5px; min-width: 0; }
.header-title { margin: 0; overflow: hidden; color: var(--text-title); font-size: 12px; font-weight: 600; letter-spacing: .2px; text-overflow: ellipsis; }
.header-version { flex: 0 0 auto; max-width: 100%; overflow: hidden; color: var(--text-muted); font: 10px/1.2 Consolas, monospace; text-overflow: ellipsis; }
.drag-grip { flex: 0 0 auto; color: var(--border-strong); pointer-events: none; }
.icon-button { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 32px; height: 32px; padding: 0; border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; color: var(--text-body); }
.icon-button:hover:not(:disabled) { background: var(--tint-bg); color: var(--primary); }
.icon-button:active:not(:disabled) { background: var(--tint-bg-strong); }
.header .icon-button { width: 24px; height: 24px; }
.drawer { position: relative; flex: 1 1 auto; min-height: 0; z-index: 1; display: flex; flex-direction: column; width: 100%; overflow: hidden; background: var(--surface); border: 1px solid var(--border); border-top: 0; border-radius: 0 0 var(--radius-lg) var(--radius-lg); transform-origin: top center; }
.body { flex: 1 1 auto; min-height: 0; min-width: 0; overflow: auto; overscroll-behavior: contain; padding: 10px; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
.mini { min-height: 0; overflow: auto; overscroll-behavior: contain; }
.status-row, .setting-row, .section-heading, .footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; }
.status-row { min-height: 26px; }
[data-workspaces] { margin-top: 6px; }
.feature-view { display: flow-root; min-width: 0; }
.page-tools-workspace > .feature-view { margin-top: 16px; }
.eyebrow { display: inline-flex; align-items: center; gap: 6px; color: var(--text-muted); font-size: 12px; overflow-wrap: anywhere; }
.eyebrow::before { content: ""; flex: 0 0 5px; width: 5px; height: 5px; border-radius: 50%; background: var(--border-strong); }
.eyebrow[data-state="enabled"]::before { background: var(--primary); }
.switch-label { display: inline-flex; align-items: center; gap: 7px; min-height: 32px; cursor: pointer; color: var(--text-body); font-size: 12px; }
.status-row .switch-label { flex: 0 0 auto; min-height: 26px; }
.switch { appearance: none; position: relative; flex: 0 0 auto; width: 34px; height: 20px; margin: 0; border: 1px solid var(--border-strong); border-radius: 12px; background: var(--border); cursor: pointer; }
.switch::before { content: ""; position: absolute; width: 14px; height: 14px; left: 2px; top: 2px; border-radius: 50%; background: var(--surface); box-shadow: 0 1px 3px #0f172a26; transition: transform .15s; }
.switch:checked { background: var(--primary); border-color: var(--primary); }
.switch:checked::before { transform: translateX(14px); }
.switch:disabled { opacity: .55; cursor: not-allowed; }
.setting-row { padding: 10px; background: var(--surface-page); border: 1px solid var(--border-inner); border-radius: var(--radius-md); }
.setting-row > div, .section-heading > div { min-width: 0; }
.setting-title { margin: 0; color: var(--text-title); font-size: 13px; font-weight: 600; }
.description { margin: 4px 0 0; color: var(--text-muted); font-size: 12px; line-height: 1.55; overflow-wrap: anywhere; }
.toolbox-navigation { display: flex; flex: 0 0 auto; align-items: center; gap: 4px; padding: 4px 6px; border-bottom: 1px solid var(--border-inner); background: var(--surface); }
.toolbox-tabs { display: flex; flex: 1 1 auto; min-width: 0; gap: 3px; }
.toolbox-action, .toolbox-tab { display: inline-flex; align-items: center; justify-content: center; height: 30px; padding: 0 6px; border: 1px solid transparent; border-radius: var(--radius-sm); color: var(--text-muted); background: transparent; }
.toolbox-action { flex: 0 0 32px; padding: 0; }
.toolbox-tab { flex: 1 1 0; min-width: 0; gap: 4px; font-size: 12px; }
.tab-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.toolbox-action:hover:not(:disabled), .toolbox-tab:hover:not(:disabled) { color: var(--primary); background: var(--surface-page); }
.toolbox-action[aria-pressed="true"], .toolbox-tab[aria-selected="true"] { color: var(--primary-hover); border-color: var(--tint-border); background: var(--tint-bg); font-weight: 600; }
.toolbox-action:active:not(:disabled), .toolbox-tab:active:not(:disabled) { background: var(--tint-bg-strong); }
.toolbox-tab[data-view="answer"][data-running="true"] { box-shadow: inset 0 -2px var(--primary); }
:host([data-minimized="false"]) .toolbox-action[data-action="paste"] { display: none; }
.toolbox-action:focus-visible, .toolbox-tab:focus-visible, .question-item:focus-visible { outline-offset: -3px; }
:host([data-minimized="true"]) .toolbox-navigation { gap: 4px; padding: 4px 5px; }
:host([data-minimized="true"]) .toolbox-action, :host([data-minimized="true"]) .toolbox-tab { height: 27px; padding: 0; }
:host([data-minimized="true"]) .toolbox-action { flex-basis: 27px; }
:host([data-minimized="true"]) .header-copy { flex-direction: column; align-items: flex-start; gap: 0; }
:host([data-minimized="true"]) .header-title { max-width: 100%; font-size: 11px; line-height: 12px; }
:host([data-minimized="true"]) .header-version { line-height: 10px; }
:host([data-minimized="true"]) .drag-grip { display: none; }
:host([data-minimized="true"]) .tab-label { display: none; }
.section-heading { align-items: flex-start; }
.section-title { margin: 0; color: var(--text-primary); font-size: 14px; line-height: 1.5; font-weight: 600; }
.section-heading > .button { flex: 0 0 auto; }
.button { min-height: var(--control-height); padding: 5px 10px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); color: var(--text-title); font-size: 12px; font-weight: 500; line-height: 1.5; white-space: nowrap; }
.button:hover:not(:disabled) { background: var(--surface-page); border-color: var(--border-strong); }
.button:active:not(:disabled) { background: var(--surface-muted); }
.button.primary { background: var(--primary); color: var(--text-on-primary); border-color: var(--primary); box-shadow: 0 1px 2px #0f172a0a; }
.button.primary:hover:not(:disabled) { background: var(--primary-hover); border-color: var(--primary-hover); }
.button.subtle { color: var(--primary); border-color: var(--tint-border); background: var(--tint-bg); }
.button.subtle:hover:not(:disabled) { background: var(--tint-bg-strong); }
.text-button { min-height: 32px; border: 0; border-radius: var(--radius-sm); color: var(--primary); background: transparent; padding: 4px 6px; font-size: 12px; white-space: nowrap; }
.text-button:hover:not(:disabled) { background: var(--tint-bg); }
.phase-badge { display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto; padding: 3px 7px; border: 1px solid var(--border-inner); border-radius: var(--radius-sm); color: var(--text-body); font-size: 11px; line-height: 1.5; background: var(--surface-page); }
.phase-badge::before { content: ""; width: 4px; height: 4px; flex: 0 0 4px; border-radius: 50%; background: currentColor; }
.empty { margin: 12px 0 0; padding: 16px; background: var(--surface-page); border: 1px dashed var(--border); border-radius: var(--radius-md); color: var(--text-body); font-size: 12px; line-height: 1.65; overflow-wrap: anywhere; }
.empty p { margin: 0; }
.empty .button { margin-top: 10px; }
.warnings { margin: 12px 0 0; padding: 10px 12px; background: var(--warning-bg); color: var(--warning-text); border: 1px solid var(--warning-border); border-radius: var(--radius-md); font-size: 12px; white-space: pre-line; overflow-wrap: anywhere; }
.message, .shell-message { margin: 12px 0 0; padding: 9px 10px; border-radius: var(--radius-md); background: var(--tint-bg); color: var(--primary-hover); font-size: 12px; white-space: pre-line; overflow-wrap: anywhere; }
.message[data-kind="error"], .shell-message[data-kind="error"] { color: var(--error-text); background: var(--error-bg); }
.message[data-kind="info"] { color: var(--text-body); background: var(--surface-page); }
.footer { margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--border-inner); }
.footer .icon-button { width: 26px; height: 26px; }
.privacy-note { margin: 0; color: var(--text-muted); font-size: 11px; overflow-wrap: anywhere; }
.mini-notice { margin: 0; padding: 6px 8px; color: var(--error-text); font-size: 11px; border-top: 1px solid var(--border-inner); overflow-wrap: anywhere; }
button, .switch, select, textarea { transition: background-color 140ms, color 140ms, border-color 140ms, box-shadow 140ms; }
@container toolbox (max-width: 320px) {
  .body { padding: 10px; }
  .section-heading { flex-wrap: wrap; gap: 8px; }
  .section-heading > .button { width: 100%; }
  .status-row { gap: 8px; }
  .status-row .eyebrow { max-width: 45%; }
}
@container toolbox (max-width: 260px) {
  .status-row { flex-wrap: wrap; }
  .status-row .eyebrow { max-width: none; }
  .setting-row { align-items: flex-start; }
}
@media (max-width: 320px) { .tab-label { display: none; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; } }
`;
