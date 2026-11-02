export const answerExchangeStyles = `
.answer-exchange { border: 1px solid var(--border-inner); border-radius: 10px; color: var(--text-body); font-size: 12px; }
.answer-exchange > summary { padding: 7px 9px; border-radius: inherit; cursor: pointer; }
.answer-exchange > summary:hover { background: var(--surface-page); }
.answer-exchange-content { display: grid; gap: 8px; padding: 8px; border-top: 1px solid var(--border-inner); }
.answer-exchange [hidden] { display: none !important; }
.answer-exchange-hint, .answer-exchange-status { margin: 0; font-size: 11px; line-height: 1.55; overflow-wrap: anywhere; }
.answer-exchange-hint { color: var(--text-muted); }
.answer-exchange-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.answer-exchange-input { box-sizing: border-box; width: 100%; min-height: 105px; padding: 8px; resize: vertical; color: var(--text-body); background: var(--surface); border: 1px solid var(--border); border-radius: 8px; font: inherit; font-size: 12px; }
.answer-exchange-input:focus-visible { outline: 2px solid var(--tint-border); outline-offset: 1px; }
.answer-exchange-input:disabled { opacity: .6; }
.answer-exchange-file-label { display: inline-flex; position: relative; align-items: center; cursor: pointer; overflow: hidden; }
.answer-exchange-file-label[data-disabled="true"] { opacity: .55; cursor: not-allowed; }
.answer-exchange-file { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: inherit; }
.answer-exchange-bank-line { display: grid; gap: 5px; padding-top: 7px; border-top: 1px solid var(--border-inner); }
.answer-exchange-preview { display: grid; gap: 7px; padding: 8px; border: 1px solid var(--tint-border); border-radius: 9px; background: var(--surface-page); }
.answer-exchange-results { display: grid; gap: 5px; max-height: 180px; overflow-y: auto; list-style: none; margin: 0; padding: 0; }
.answer-exchange-results li { display: grid; gap: 2px; font-size: 11px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.answer-exchange-results strong { color: var(--text-title); font-weight: 600; }
.answer-exchange-entry { border: 1px solid var(--border-inner); border-radius: 7px; background: var(--surface); }
.answer-exchange-entry summary { padding: 5px 7px; cursor: pointer; white-space: normal; }
.answer-exchange-entry pre { margin: 0; padding: 6px 7px; border-top: 1px solid var(--border-inner); font: inherit; white-space: pre-wrap; overflow-wrap: anywhere; }
.answer-exchange-status { color: var(--text-body); white-space: pre-wrap; }
.answer-exchange-status:empty { display: none; }
.answer-exchange-status[data-kind="error"] { color: var(--error-text); }
.answer-exchange-confirm { padding: 7px; border: 1px solid var(--warning-border); border-radius: 8px; background: var(--warning-bg); color: var(--warning-text); }
.answer-exchange-confirm p { margin: 0 0 6px; font-size: 11px; line-height: 1.5; }
.answer-exchange-confirm .button + .button { margin-left: 6px; }
`;
