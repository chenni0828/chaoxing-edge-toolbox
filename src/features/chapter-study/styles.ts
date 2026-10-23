export const chapterStudyStyles = `
.chapter-study-view { display: grid; gap: 6px; }
.study-heading { display: flex; align-items: center; gap: 8px; min-height: 30px; }
.study-heading .section-title { flex: 1 1 auto; min-width: 0; }
.study-phase { padding: 2px 6px; border-radius: 10px; }
.study-phase[data-phase="running"], .study-phase[data-phase="confirming"], .study-phase[data-phase="complete"] { color: var(--primary-hover); background: var(--tint-bg); border-color: var(--tint-border); }
.study-phase[data-phase="error"] { color: var(--warning-text); background: var(--warning-bg); border-color: var(--warning-border); }
.study-enable { flex: 0 0 auto; gap: 6px; min-height: 30px; }
.study-preferences { display: grid; gap: 8px; min-inline-size: 0; margin: 0; padding: 8px; border: 1px solid var(--border-inner); border-radius: 12px; }
.study-preference-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.study-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; color: var(--text-title); font-size: 12px; line-height: 1.45; }
.study-field select { width: 100%; min-width: 0; min-height: 32px; padding: 4px 7px; border: 1px solid var(--border); border-radius: 10px; color: var(--text-title); background: var(--surface); font: inherit; }
.study-field select:hover:not(:disabled) { border-color: var(--border-strong); }
.study-field select:focus-visible { border-color: var(--primary); box-shadow: 0 0 0 3px var(--tint-bg); }
.study-field select:disabled { opacity: .55; cursor: not-allowed; }
.study-field-help { margin: 0; color: var(--text-muted); font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; }
.study-media-settings { display: grid; grid-template-columns: minmax(0, 1.1fr) repeat(2, minmax(0, 1fr)); align-items: end; gap: 8px; }
.study-muted { display: grid; grid-template-rows: auto 32px; align-content: end; gap: 4px; min-width: 0; min-height: 0; padding-inline: 4px; border-radius: 10px; font-size: 12px; line-height: 1.45; }
.study-muted:hover { background: var(--surface-page); }
.study-muted:focus-within { background: var(--tint-bg); }
.study-muted .switch { align-self: center; }
.study-rate-warning { margin: 0; padding: 6px 8px; border: 1px solid var(--warning-border); border-radius: 10px; color: var(--warning-text); background: var(--warning-bg); font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; }
.study-preference-feedback { margin: 0; color: var(--primary); font-size: 11px; line-height: 1.45; overflow-wrap: anywhere; }
.study-progress { display: grid; gap: 4px; padding: 8px 10px; border: 1px solid var(--border-inner); border-radius: 12px; background: var(--surface-page); }
.study-progress p { margin: 0; font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.study-message { color: var(--text-body); white-space: pre-wrap; }
.study-message:empty { display: none; }
.study-message[data-kind="error"] { padding: 6px 8px; border-radius: 10px; background: var(--error-bg); color: var(--error-text); }
.study-progress-footer { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; }
.study-progress .study-count { font-size: 11px; }
.study-chapter { color: var(--text-title); font-weight: 600; }
.study-task, .study-count { color: var(--text-muted); font-variant-numeric: tabular-nums; }
.study-actions { display: flex; gap: 6px; }
.study-actions > .button { min-height: 32px; padding: 5px 10px; border-radius: 10px; }
.study-more, .study-skipped { border: 1px solid var(--border-inner); border-radius: 10px; color: var(--text-body); font-size: 12px; }
.study-more summary, .study-skipped summary { min-height: 32px; padding: 6px 9px; border-radius: inherit; cursor: pointer; line-height: 1.5; overflow-wrap: anywhere; }
.study-more summary:hover, .study-skipped summary:hover { background: var(--surface-page); }
.study-more[open] summary, .study-skipped[open] summary { border-bottom: 1px solid var(--border-inner); border-radius: 10px 10px 0 0; }
.study-more-content { display: grid; gap: 8px; padding: 8px; }
.study-skipped ul { max-height: 160px; overflow: auto; overscroll-behavior: contain; margin: 0; padding: 4px 12px 10px 28px; scrollbar-width: thin; }
.study-skipped li { margin-top: 5px; white-space: pre-wrap; overflow-wrap: anywhere; }
@container toolbox (max-width: 280px) {
  .study-preference-grid { grid-template-columns: minmax(0, 1fr); }
  .study-heading { gap: 6px; }
  .study-enable > span { display: none; }
  .study-media-settings { gap: 6px; }
  .study-muted { padding-inline: 0; }
  .study-progress-footer { grid-template-columns: minmax(0, 1fr); gap: 6px; }
  .study-actions > .button { flex: 1 1 auto; }
}
`;
