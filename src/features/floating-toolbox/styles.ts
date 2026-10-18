import { TOOLBOX_LAYOUT } from './layout';

export const toolboxStyles = `
:host { all: initial; color-scheme: light; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; color: #0f172a; }
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
button, input, textarea { font: inherit; }
button { cursor: pointer; }
button:disabled { cursor: not-allowed; opacity: .55; }
button, textarea, input { -webkit-tap-highlight-color: transparent; }
button:focus-visible, input:focus-visible, textarea:focus-visible, [data-drag-handle]:focus-visible { outline: 3px solid #0d9488; outline-offset: 2px; }
svg { display: block; flex: 0 0 auto; }
.panel { position: relative; width: 100%; height: ${TOOLBOX_LAYOUT.headerHeight}px; }
/* The title bar always sits on top of the card and follows the drawer width. */
.header { position: absolute; top: 0; left: var(--toolbox-surface-offset, 0px); z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 3px; width: var(--toolbox-surface-width, 100%); height: ${TOOLBOX_LAYOUT.headerHeight}px; padding: 3px 5px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 7px 7px 0 0; box-shadow: 0 2px 8px #0f172a10; }
[data-drag-handle] { cursor: move; touch-action: none; user-select: none; }
.brand { display: flex; flex: 1 1 auto; align-items: center; gap: 4px; min-width: 0; overflow: hidden; color: #0f766e; white-space: nowrap; }
.header-title { margin: 0; overflow: hidden; color: #334155; font-size: 10px; font-weight: 600; letter-spacing: .3px; text-overflow: ellipsis; }
.header-version { flex: 0 0 auto; max-width: 42px; overflow: hidden; color: #64748b; font-size: 9px; font-family: Consolas, monospace; }
.icon-button { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; border: 1px solid transparent; border-radius: 5px; background: transparent; color: #134e4a; }
.icon-button:hover { background: #ccfbf1; border-color: #99f6e4; }
.header .icon-button { flex: 0 0 auto; width: 24px; height: 24px; margin-left: auto; }
.drawer { position: absolute; top: ${TOOLBOX_LAYOUT.headerHeight - 1}px; left: var(--toolbox-surface-offset, 0px); z-index: 1; display: flex; flex-direction: column; width: var(--toolbox-surface-width, 100%); max-height: var(--toolbox-drawer-height, calc(100dvh - 80px)); overflow: hidden; background: #fff; border: 1px solid #cbd5e1; border-top: 0; border-radius: 0 0 7px 7px; box-shadow: 0 10px 30px #0f172a22; transform-origin: top center; }
/* Opening upward anchors the whole card at the host bottom, so the title stays on top. */
:host([data-placement="above"]) .panel { position: absolute; bottom: 0; left: var(--toolbox-surface-offset, 0px); display: flex; flex-direction: column; width: var(--toolbox-surface-width, 100%); height: auto; }
:host([data-placement="above"]) .header { position: static; width: 100%; }
:host([data-placement="above"]) .drawer { position: static; width: 100%; transform-origin: bottom center; }
.body { flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 12px; }
.mini { min-height: 0; overflow: auto; overscroll-behavior: contain; }
.status-row, .setting-row, .section-heading, .footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.status-row { margin-bottom: 12px; }
[data-workspaces] { margin-top: 16px; }
.feature-view { display: flow-root; }
.page-tools-workspace > .feature-view { margin-top: 16px; }
.eyebrow { color: #64748b; font-size: 11px; }
.switch-label { display: inline-flex; align-items: center; gap: 7px; min-height: 32px; cursor: pointer; font-size: 12px; }
.switch { appearance: none; position: relative; flex: 0 0 auto; width: 34px; height: 20px; margin: 0; border: 1px solid #94a3b8; border-radius: 12px; background: #cbd5e1; cursor: pointer; }
.switch::before { content: ""; position: absolute; width: 14px; height: 14px; left: 2px; top: 2px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px #0f172a33; transition: transform .15s; }
.switch:checked { background: #0f766e; border-color: #0f766e; }
.switch:checked::before { transform: translateX(14px); }
.switch:disabled { opacity: .55; cursor: not-allowed; }
.setting-row { padding: 10px 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; }
.setting-title { margin: 0; font-size: 12px; font-weight: 600; }
.description { margin: 4px 0 0; color: #64748b; font-size: 12px; }
.setting-row .description { font-size: 11px; }
.toolbox-navigation { display: flex; flex: 0 0 auto; align-items: center; gap: 4px; padding: 4px 5px; border-bottom: 1px solid #e2e8f0; background: #fff; }
:host([data-placement="above"]) .toolbox-navigation { border-bottom: 0; border-top: 1px solid #e2e8f0; }
.toolbox-tabs { display: flex; flex: 1 1 auto; min-width: 0; gap: 4px; }
.toolbox-action, .toolbox-tab { display: inline-flex; align-items: center; justify-content: center; height: 32px; padding: 0 5px; border: 1px solid #e2e8f0; border-radius: 4px; color: #64748b; background: #fff; }
.toolbox-action { flex: 0 0 32px; padding: 0; }
.toolbox-tab { flex: 1 1 0; min-width: 0; gap: 6px; font-size: 12px; }
.tab-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.toolbox-action:hover, .toolbox-tab:hover { color: #0f766e; border-color: #5eead4; background: #f0fdfa; }
.toolbox-action[aria-pressed="true"], .toolbox-tab[aria-selected="true"] { color: #0f766e; border-color: #99f6e4; background: #f0fdfa; }
.toolbox-tab[data-view="answer"][data-running="true"] { box-shadow: inset 0 -2px #0f766e; }
:host([data-minimized="false"]) .toolbox-action[data-action="paste"] { display: none; }
.toolbox-action:focus-visible, .toolbox-tab:focus-visible, .question-item:focus-visible { outline: 2px solid #0d9488; outline-offset: -3px; }
:host([data-minimized="true"]) .toolbox-action, :host([data-minimized="true"]) .toolbox-tab { height: 27px; padding: 0; }
:host([data-minimized="true"]) .toolbox-action { flex-basis: 27px; }
:host([data-minimized="true"]) .tab-label { display: none; }
.section-heading { align-items: flex-start; }
.section-title { margin: 0; font-size: 14px; line-height: 1.5; }
.button { min-height: 36px; padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #334155; font-weight: 500; white-space: nowrap; font-size: 12px; }
.button:hover:not(:disabled) { background: #f1f5f9; border-color: #94a3b8; }
.button.primary { background: #0f766e; color: #fff; border-color: #0f766e; }
.button.primary:hover:not(:disabled) { background: #115e59; border-color: #115e59; }
.button.subtle { color: #0f766e; border-color: #99f6e4; background: #f0fdfa; }
.button.subtle:hover:not(:disabled) { background: #ccfbf1; border-color: #5eead4; }
.empty { margin: 12px 0 0; padding: 12px; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 6px; color: #475569; font-size: 12px; }
.empty p { margin: 0; }
.empty .button { margin-top: 10px; }
.warnings { margin: 10px 0 0; padding: 8px 10px; background: #fffbeb; color: #92400e; border: 1px solid #fde68a; border-radius: 6px; font-size: 12px; white-space: pre-line; }
.message, .shell-message { margin: 10px 0 0; color: #0f766e; font-size: 12px; white-space: pre-line; overflow-wrap: anywhere; }
.message[data-kind="error"], .shell-message[data-kind="error"] { color: #b91c1c; }
.message[data-kind="info"] { color: #475569; }
.footer { margin-top: 16px; padding-top: 12px; border-top: 1px solid #e2e8f0; }
.privacy-note { margin: 0; color: #64748b; font-size: 10px; }
.footer .button { flex: 0 0 auto; }
.mini-notice { margin: 0; padding: 4px 6px; color: #b91c1c; font-size: 10px; border-top: 1px solid #e2e8f0; overflow-wrap: anywhere; }
@media (max-width: 320px) { .tab-label { display: none; } }
@media (prefers-reduced-motion: reduce) { .switch::before { transition: none; } }
`;
