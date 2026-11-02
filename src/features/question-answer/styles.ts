export const questionAnswerStyles = `
.question-answer-view { display: grid; gap: 8px; }
.answer-heading, .answer-result-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.answer-heading .section-title { min-width: 0; }
.answer-configuration { border: 1px solid var(--border-inner); border-radius: 10px; color: var(--text-body); font-size: 12px; }
.answer-configuration > summary { padding: 6px 9px; cursor: pointer; border-radius: inherit; }
.answer-configuration > summary:hover { background: var(--surface-page); }
.answer-configuration-content { display: grid; gap: 7px; padding: 8px; border-top: 1px solid var(--border-inner); }
.question-answer-view .phase-badge[data-phase="running"], .question-answer-view .phase-badge[data-phase="querying"], .question-answer-view .phase-badge[data-phase="filled"] { color: var(--primary-hover); background: var(--tint-bg); border-color: var(--tint-border); }
.question-answer-view .phase-badge[data-phase="error"] { color: var(--error-text); background: var(--error-bg); border-color: var(--error-border); }
.question-answer-view .phase-badge[data-phase="existing"], .question-answer-view .phase-badge[data-phase="needs-review"] { color: var(--warning-text); background: var(--warning-bg); border-color: var(--warning-border); }
.answer-source-settings { display: grid; gap: 7px; }
.answer-source-label { display: grid; gap: 4px; min-width: 0; color: var(--text-title); font-size: 12px; }
.answer-source-label select { min-width: 0; width: 100%; min-height: 32px; padding: 4px 7px; border: 1px solid var(--border); border-radius: 10px; color: var(--text-title); background: var(--surface); font: inherit; }
.answer-source-label select:focus-visible { border-color: var(--primary); box-shadow: 0 0 0 3px var(--tint-bg); }
.answer-source-label select:disabled { opacity: .55; cursor: not-allowed; }
.answer-settings-actions, .answer-actions, .answer-result-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.question-answer-view .button { min-height: 30px; padding: 4px 8px; border-radius: 10px; }
.answer-settings-actions { flex-direction: row; }
.answer-config-status { margin: 0; padding: 7px 8px; border: 1px solid var(--tint-border); border-radius: 10px; color: var(--text-body); background: var(--tint-bg); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.answer-config-status[data-kind="warning"] { color: var(--warning-text); border-color: var(--warning-border); background: var(--warning-bg); }
.answer-message { margin: 0; color: var(--text-body); white-space: pre-wrap; font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.answer-message:empty { display: none; }
.answer-message[data-kind="error"] { padding: 6px 8px; border-radius: 10px; color: var(--error-text); background: var(--error-bg); }
.answer-progress-line { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.answer-progress { margin: 0; color: var(--text-muted); font-size: 11px; font-variant-numeric: tabular-nums; line-height: 1.5; }
.answer-progress-line > [data-answer-action="follow-progress"] { margin-left: auto; min-height: 25px; padding: 2px 6px; font-size: 11px; }
.answer-paper-status { margin: 0; color: var(--text-muted); font-size: 11px; line-height: 1.5; }
.answer-paper-status[data-kind="warning"] { color: var(--warning-text); }
.answer-question-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(34px, 1fr)); gap: 5px; }
.answer-question-grid .button { min-width: 0; padding: 4px; font-variant-numeric: tabular-nums; }
.answer-question-grid .button[data-phase="filled"], .answer-question-grid .button[data-phase="existing"] { background: var(--tint-bg); color: var(--primary-hover); }
.answer-question-grid .button[data-phase="error"], .answer-question-grid .button[data-phase="needs-review"], .answer-question-grid .button[data-phase="unsupported"] { background: var(--warning-bg); color: var(--warning-text); }
.answer-question-grid .button[data-phase="querying"] { border-color: var(--primary); color: var(--primary-hover); }
.answer-question-grid .button[aria-pressed="true"] { border-color: var(--primary); box-shadow: inset 0 0 0 1px var(--primary); font-weight: 700; }
.answer-results { display: grid; gap: 8px; list-style: none; margin: 0; padding: 0; }
.answer-result { display: grid; gap: 6px; padding: 8px 10px; min-width: 0; border: 1px solid var(--border-inner); border-radius: 12px; background: var(--surface-page); }
.answer-result-title { min-width: 0; color: var(--text-title); font-size: 12px; font-weight: 600; overflow-wrap: anywhere; }
.answer-result-stem, .answer-result-message { margin: 0; color: var(--text-body); font-size: 12px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
.answer-result-stem { padding-bottom: 3px; }
.answer-question-content, .answer-field, .answer-child { display: grid; gap: 5px; min-width: 0; color: var(--text-body); font-size: 12px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
.answer-field p, .answer-child p { margin: 0; }
.answer-field, .answer-child { padding-top: 5px; border-top: 1px solid var(--border-inner); }
.answer-options { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
.answer-options li { padding: 5px 7px; border-radius: 7px; background: var(--surface); }
.answer-question-images { display: grid; gap: 8px; }
.answer-question-image { margin: 0; min-width: 0; }
.answer-question-image img { display: block; max-width: 100%; height: auto; max-height: 260px; object-fit: contain; border-radius: 6px; }
.answer-image-caption, .answer-image-error { color: var(--text-muted); font-size: 11px; line-height: 1.5; }
.answer-copy-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 6px; }
.answer-copy-status { margin: 0; color: var(--text-muted); font-size: 11px; line-height: 1.5; }
.answer-copy-fallback { box-sizing: border-box; width: 100%; min-height: 110px; padding: 8px; resize: vertical; color: var(--text-body); background: var(--surface); border: 1px solid var(--border); border-radius: 8px; font: inherit; font-size: 12px; }
.answer-current { padding: 7px 8px; border: 1px solid var(--border-inner); border-radius: 8px; background: var(--surface); }
.answer-answer-label { color: var(--text-muted); font-size: 11px; }
.answer-current pre { margin: 4px 0 0; color: var(--text-body); white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; font-size: 12px; line-height: 1.6; }
.answer-completion-status { margin: 0; padding: 7px 8px; border-radius: 9px; background: var(--tint-bg); color: var(--primary-hover); font-size: 12px; line-height: 1.5; }
.answer-completion-status[data-kind="warning"] { background: var(--warning-bg); color: var(--warning-text); }
.answer-result-message { color: var(--text-muted); }
.answer-result-meta { display: flex; flex-wrap: wrap; gap: 4px 8px; color: var(--text-muted); font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; }
.answer-result-tags { color: var(--primary-hover); }
.answer-result-preview { border: 1px solid var(--border-inner); border-radius: 8px; color: var(--text-body); font-size: 12px; }
.answer-result-preview summary { padding: 5px 8px; cursor: pointer; border-radius: inherit; }
.answer-result-preview summary:hover { background: var(--surface); }
.answer-result-preview pre { margin: 0; padding: 6px 8px; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; line-height: 1.6; }
.answer-replace-confirm { padding: 7px 8px; border: 1px solid var(--warning-border); border-radius: 10px; color: var(--warning-text); background: var(--warning-bg); }
.answer-replace-confirm p { margin: 0 0 6px; font-size: 11px; line-height: 1.5; }
.answer-replace-confirm .button + .button { margin-left: 6px; }
.answer-boundary { margin: 0; line-height: 1.5; }
.page-tools-workspace { display: grid; gap: 8px; }
.scene-tools { margin-top: 7px; border: 1px solid var(--border-inner); border-radius: 10px; color: var(--text-body); font-size: 12px; }
.scene-tools > summary { padding: 7px 9px; border-radius: inherit; cursor: pointer; }
.scene-tools > summary:hover { background: var(--surface-page); }
.scene-tools-content { display: grid; gap: 8px; padding: 8px; border-top: 1px solid var(--border-inner); }
@container toolbox (max-width: 300px) {
  .answer-source-settings { grid-template-columns: minmax(0, 1fr); }
  .answer-settings-actions { flex-direction: row; }
  .answer-settings-actions .button { flex: 1 1 auto; }
}
`;
