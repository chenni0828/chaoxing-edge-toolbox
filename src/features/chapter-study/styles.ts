export const chapterStudyStyles = `
.study-enable, .study-preferences, .study-progress, .study-actions, .study-skipped { margin-top: 12px; }
.study-phase[data-phase="running"], .study-phase[data-phase="confirming"], .study-phase[data-phase="complete"] { color: #115e59; background: #f0fdfa; border-color: #99f6e4; }
.study-phase[data-phase="error"] { color: #92400e; background: #fffbeb; border-color: #fde68a; }
.study-field { display: flex; flex: 1 1 auto; flex-direction: column; gap: 5px; min-width: 0; color: #475569; font-size: 12px; }
.study-field select { width: 100%; min-width: 0; min-height: 36px; padding: 6px 8px; border: 1px solid #cbd5e1; border-radius: 6px; color: #334155; background: #fff; font: inherit; }
.study-field select:disabled { opacity: .55; cursor: not-allowed; }
.study-field select:focus-visible { outline: 3px solid #0d9488; outline-offset: 2px; }
.study-media-settings { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 12px; margin-top: 12px; }
.study-media-settings .study-field { flex-basis: 120px; }
.study-muted { flex: 0 0 auto; min-height: 36px; color: #475569; }
.study-preference-feedback { margin: 8px 0 0; color: #0f766e; font-size: 12px; }
.study-message { margin: 12px 0; color: #475569; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; }
.study-message[data-kind="error"] { color: #b91c1c; }
.study-progress { padding: 10px; border: 1px solid #e2e8f0; border-radius: 6px; background: #f8fafc; }
.study-progress p { margin: 0; font-size: 12px; overflow-wrap: anywhere; }
.study-progress p + p { margin-top: 6px; }
.study-chapter { color: #334155; font-weight: 600; }
.study-task, .study-count { color: #64748b; }
.study-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.study-actions .primary { flex: 1 1 auto; }
.study-skipped { color: #475569; font-size: 12px; }
.study-skipped summary { min-height: 32px; padding: 6px 0; cursor: pointer; }
.study-skipped summary:focus-visible { outline: 2px solid #0d9488; outline-offset: 2px; }
.study-skipped ul { max-height: 160px; overflow: auto; margin: 6px 0 0; padding-left: 20px; }
.study-skipped li { margin-top: 5px; white-space: pre-wrap; overflow-wrap: anywhere; }
.study-boundary { margin-top: 12px; }
`;
