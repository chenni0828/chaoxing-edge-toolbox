export const questionExtractStyles = `
.refresh-note { margin: 9px 0 0; color: #64748b; font-size: 11px; }
.summary { margin: 12px 0 8px; color: #475569; font-size: 12px; }
.question-list { display: flex; flex-direction: column; gap: 4px; max-height: 132px; overflow: auto; padding: 2px; margin: 0 0 12px; }
.question-item { display: flex; gap: 8px; align-items: center; flex: 0 0 auto; width: 100%; min-height: 38px; padding: 7px 9px; text-align: left; border: 1px solid #e2e8f0; border-radius: 6px; color: #475569; background: #fff; }
.question-item:hover { background: #f8fafc; }
.question-item[aria-current="true"] { border-color: #0f766e; background: #f0fdfa; color: #134e4a; }
.question-number { flex: 0 0 auto; font-size: 12px; font-weight: 600; }
.question-snippet { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.navigation { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.counter { font-size: 12px; color: #475569; font-variant-numeric: tabular-nums; }
.editor-label { display: block; margin-bottom: 6px; font-size: 12px; font-weight: 600; color: #334155; }
.editor, .manual-copy { display: block; width: 100%; min-height: 150px; height: 190px; max-height: 320px; padding: 10px; border: 1px solid #94a3b8; border-radius: 6px; background: #fff; color: #0f172a; resize: vertical; font: 12px/1.65 Consolas, "Microsoft YaHei", monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.editor-hint { margin: 6px 0 10px; color: #64748b; font-size: 11px; }
.copy-actions { display: flex; gap: 8px; }
.copy-actions .primary { flex: 1; }
.manual-copy { margin-top: 8px; min-height: 100px; height: 130px; }
`;
