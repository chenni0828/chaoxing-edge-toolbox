export const questionExtractStyles = `
.refresh-note { margin: 10px 0 0; color: var(--text-muted); font-size: 11px; line-height: 1.65; }
.summary { margin: 16px 0 8px; color: var(--text-body); font-size: 11px; line-height: 1.65; overflow-wrap: anywhere; }
.question-list { display: flex; flex-direction: column; gap: 6px; max-height: 156px; overflow: auto; overscroll-behavior: contain; padding: 2px; margin: 0 0 12px; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
.question-item { display: flex; gap: 10px; align-items: center; flex: 0 0 auto; width: 100%; min-width: 0; min-height: 44px; padding: 8px 10px; text-align: left; border: 1px solid var(--border-inner); border-radius: var(--radius-md); color: var(--text-body); background: var(--surface); }
.question-item:hover { border-color: var(--border); background: var(--surface-page); }
.question-item[aria-current="true"] { border-color: var(--tint-border); background: var(--tint-bg); color: var(--primary-hover); box-shadow: inset 3px 0 var(--primary); }
.question-number { display: inline-grid; place-items: center; flex: 0 0 auto; min-width: 24px; min-height: 24px; padding: 0 3px; border-radius: var(--radius-sm); background: var(--surface-page); color: var(--text-body); font-size: 11px; font-weight: 600; }
.question-item[aria-current="true"] .question-number { background: var(--tint-bg-strong); color: var(--primary-hover); }
.question-snippet { display: -webkit-box; min-width: 0; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere; font-size: 12px; line-height: 1.6; }
.navigation { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 8px; margin-bottom: 16px; }
.navigation .button { min-width: 0; padding-inline: 8px; }
.counter { font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.editor-label { display: block; margin-bottom: 7px; font-size: 12px; font-weight: 600; color: var(--text-title); }
.editor, .manual-copy { display: block; width: 100%; min-height: 150px; height: 190px; max-height: 320px; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); color: var(--text-primary); resize: vertical; font: 12px/1.75 Consolas, "Microsoft YaHei", monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.editor:focus-visible, .manual-copy:focus-visible { border-color: var(--primary); box-shadow: 0 0 0 3px var(--tint-bg); }
.editor:hover:not(:disabled):not(:focus-visible), .manual-copy:hover:not(:focus-visible) { border-color: var(--border-strong); }
.editor:disabled { color: var(--text-muted); background: var(--surface-muted); cursor: not-allowed; }
.editor-hint { margin: 8px 0 12px; color: var(--text-muted); font-size: 11px; line-height: 1.65; }
.copy-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.copy-actions .primary { flex: 1; }
.manual-copy { margin-top: 8px; min-height: 100px; height: 130px; }
@container toolbox (max-width: 280px) {
  .navigation { column-gap: 5px; }
  .navigation .button { padding-inline: 4px; font-size: 11px; }
  .copy-actions > .button { flex: 1 1 100%; }
}
`;
