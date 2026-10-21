export const chapterStudyStyles = `
.study-enable, .study-preferences, .study-progress, .study-actions, .study-skipped { margin-top: 12px; }
.study-phase[data-phase="running"], .study-phase[data-phase="confirming"], .study-phase[data-phase="complete"] { color: var(--primary-hover); background: var(--tint-bg); border-color: var(--tint-border); }
.study-phase[data-phase="error"] { color: var(--warning-text); background: var(--warning-bg); border-color: var(--warning-border); }
.study-enable .switch { flex-shrink: 0; }
.study-preferences { display: grid; gap: 12px; min-inline-size: 0; margin-top: 16px; margin-inline: 0; padding: 12px; border: 1px solid var(--border-inner); border-radius: var(--radius-md); }
.study-preferences legend { padding: 0 5px; color: var(--text-muted); font-size: 11px; font-weight: 600; }
.study-preference-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.study-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; color: var(--text-title); font-size: 12px; line-height: 1.6; }
.study-field select { width: 100%; min-width: 0; min-height: 36px; padding: 6px 8px; border: 1px solid var(--border); border-radius: var(--radius-md); color: var(--text-title); background: var(--surface); font: inherit; }
.study-field select:hover:not(:disabled) { border-color: var(--border-strong); }
.study-field select:focus-visible { border-color: var(--primary); box-shadow: 0 0 0 3px var(--tint-bg); }
.study-field select:disabled { opacity: .55; cursor: not-allowed; }
.study-field-help { margin: -4px 0 0; color: var(--text-muted); font-size: 11px; line-height: 1.6; }
.study-media-settings { display: grid; grid-template-columns: minmax(0, 1.2fr) repeat(2, minmax(0, 1fr)); align-items: end; gap: 12px; padding-top: 12px; border-top: 1px solid var(--border-inner); }
.study-muted { display: grid; grid-template-rows: auto 36px; align-content: end; gap: 6px; min-width: 0; min-height: 0; padding-inline: 4px; border-radius: var(--radius-sm); font-size: 12px; }
.study-muted:hover { background: var(--surface-page); }
.study-muted:focus-within { background: var(--tint-bg); }
.study-muted .switch { align-self: center; }
.study-preference-feedback { margin: 0; color: var(--primary); font-size: 12px; overflow-wrap: anywhere; }
.study-message { margin: 12px 0; color: var(--text-body); white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; line-height: 1.65; }
.study-message:empty { display: none; }
.study-message[data-kind="error"] { padding: 10px 12px; border-radius: var(--radius-md); background: var(--error-bg); color: var(--error-text); }
.study-progress { padding: 12px; border: 1px solid var(--border-inner); border-radius: var(--radius-md); background: var(--surface-page); }
.study-progress p { margin: 0; font-size: 12px; overflow-wrap: anywhere; }
.study-progress p + p { margin-top: 6px; }
.study-progress .study-count { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border-inner); }
.study-chapter { color: var(--text-title); font-weight: 600; }
.study-task, .study-count { color: var(--text-muted); font-variant-numeric: tabular-nums; }
.study-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.study-actions > .button { flex: 1 1 auto; }
.study-skipped { border: 1px solid var(--border-inner); border-radius: var(--radius-md); color: var(--text-body); font-size: 12px; }
.study-skipped summary { min-height: 36px; padding: 8px 10px; border-radius: inherit; cursor: pointer; overflow-wrap: anywhere; }
.study-skipped summary:hover { background: var(--surface-page); }
.study-skipped[open] summary { border-bottom: 1px solid var(--border-inner); border-radius: var(--radius-md) var(--radius-md) 0 0; }
.study-skipped ul { max-height: 160px; overflow: auto; overscroll-behavior: contain; margin: 0; padding: 4px 12px 10px 28px; scrollbar-width: thin; }
.study-skipped li { margin-top: 5px; white-space: pre-wrap; overflow-wrap: anywhere; }
.study-boundary { margin-top: 12px; font-size: 11px; }
@container toolbox (max-width: 340px) {
  .study-preference-grid { grid-template-columns: minmax(0, 1fr); }
  .study-media-settings { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .study-media-settings > .study-field { grid-column: 1 / -1; }
  .study-muted { grid-template-rows: auto; grid-template-columns: minmax(0, 1fr) auto; align-items: center; min-height: 36px; }
}
`;
