export const aiAnswerStyles = `
.ai-answer-view .phase-badge[data-phase="generating"], .ai-answer-view .phase-badge[data-phase="filled"], .ai-answer-view .phase-badge[data-phase="complete"] { color: var(--primary-hover); background: var(--tint-bg); border-color: var(--tint-border); }
.ai-answer-view .phase-badge[data-phase="needs-config"], .ai-answer-view .phase-badge[data-phase="blocked"] { color: var(--warning-text); background: var(--warning-bg); border-color: var(--warning-border); }
.ai-answer-view .phase-badge[data-phase="error"] { color: var(--error-text); background: var(--error-bg); border-color: var(--error-border); }
.api-status { margin-top: 16px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px 6px 12px; border: 1px solid var(--border-inner); border-radius: var(--radius-md); background: var(--surface-page); color: var(--text-body); font-size: 11px; line-height: 1.6; }
.api-status::before { content: ""; width: 6px; height: 6px; flex: 0 0 6px; border-radius: 50%; background: var(--border-strong); }
.api-status[data-state="ready"]::before { background: var(--primary); }
.api-status[data-state="error"]::before { background: var(--error-text); }
.api-status span { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.api-status .text-button { flex: 0 0 auto; }
.ai-message { margin: 12px 0; color: var(--text-body); white-space: pre-wrap; font-size: 12px; line-height: 1.65; overflow-wrap: anywhere; }
.ai-message:empty { display: none; }
.ai-message[data-kind="error"] { padding: 10px 12px; border-radius: var(--radius-md); color: var(--error-text); background: var(--error-bg); }
.ai-question { margin: 12px 0; padding: 12px; background: var(--surface-page); border: 1px solid var(--border-inner); border-radius: var(--radius-md); }
.ai-question .editor-label { margin-bottom: 8px; color: var(--text-muted); font-size: 11px; }
.question-text { margin: 0; color: var(--text-primary); white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.75; max-height: 180px; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.question-meta { margin: 12px 0 0; padding-top: 8px; border-top: 1px solid var(--border-inner); color: var(--text-muted); font-size: 11px; line-height: 1.65; overflow-wrap: anywhere; }
.ai-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.ai-actions > .button { flex: 1 1 auto; }
.answer-preview { margin-top: 16px; }
.answer-editor { height: 200px; background: var(--surface-page); font: 13px/1.75 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; }
.ai-boundary { margin: 16px 0 0; padding-top: 12px; border-top: 1px solid var(--border-inner); line-height: 1.65; }
@container toolbox (max-width: 320px) {
  .api-status { flex-wrap: wrap; column-gap: 8px; }
  .api-status span { flex-basis: calc(100% - 18px); }
  .api-status .text-button { margin-left: 14px; }
  .ai-actions > .button { flex-basis: 100%; }
}
`;
