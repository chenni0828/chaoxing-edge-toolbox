export const aiAnswerStyles = `
.phase-badge { flex: 0 0 auto; padding: 3px 7px; border: 1px solid #cbd5e1; border-radius: 5px; color: #475569; font-size: 11px; background: #f8fafc; }
.phase-badge[data-phase="generating"], .phase-badge[data-phase="filled"] { color: #115e59; background: #f0fdfa; border-color: #99f6e4; }
.phase-badge[data-phase="error"], .phase-badge[data-phase="needs-config"], .phase-badge[data-phase="blocked"] { color: #92400e; background: #fffbeb; border-color: #fde68a; }
.api-status { margin-top: 12px; display: flex; align-items: center; justify-content: space-between; gap: 8px; color: #64748b; font-size: 11px; }
.api-status span { overflow-wrap: anywhere; }
.text-button { border: 0; color: #0f766e; background: transparent; padding: 4px 0; font-size: 12px; white-space: nowrap; }
.text-button:hover { text-decoration: underline; }
.ai-message { margin: 12px 0; color: #475569; white-space: pre-wrap; font-size: 12px; overflow-wrap: anywhere; }
.ai-message[data-kind="error"] { color: #b91c1c; }
.ai-question { margin: 12px 0; padding: 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; }
.question-text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; max-height: 180px; overflow: auto; }
.question-meta { margin: 8px 0 0; color: #64748b; font-size: 11px; }
.ai-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.ai-actions .primary { flex: 1; }
.answer-preview { margin-top: 12px; }
.answer-editor { height: 200px; }
.ai-boundary { margin: 12px 0 0; }
`;
