import type { AnswerRuntime } from './client';
import { handleAnswerPageCommand } from './page';
import { isAnswerPageResult } from './protocol';
import { observeQuestionStructure } from './structure';
import type { AnswerPageCommand } from './types';

/** 浙学的原生答题控件都在顶层页面，直接在隔离环境操作。 */
export function createZjoocAnswerRuntime(win: Window, isEnabled: () => boolean): AnswerRuntime {
  const cancel = () => { void handleAnswerPageCommand(win, { action: 'cancel' }); };
  const cancelled = () => new DOMException('答题已暂停。', 'AbortError');

  async function request(command: AnswerPageCommand, signal: AbortSignal) {
    if (signal.aborted) throw cancelled();
    if (!isEnabled()) throw new Error('请先开启批量答题。');
    if (command.action === 'finish') throw new Error('请在浙学页面手动提交。');
    signal.addEventListener('abort', cancel, { once: true });
    try {
      const result = await handleAnswerPageCommand(win, command);
      if (signal.aborted) throw cancelled();
      if (!isAnswerPageResult(result)) throw new Error('题目内容超出可处理范围。');
      if (!result.ok) throw new Error(result.error || '题目页面操作失败。');
      return result;
    } finally { signal.removeEventListener('abort', cancel); }
  }

  return {
    async scan(signal) {
      const { snapshot } = await request({ action: 'inspect' }, signal);
      return snapshot?.scene === 'zjooc-test' ? [{ frameId: 0, snapshot }] : [];
    },
    async page(target, command, signal) {
      if (target.frameId !== 0 || target.documentId !== undefined) throw new Error('题目页面已更换，请重新扫描。');
      return request(command, signal);
    },
    cancel,
    subscribeInvalidation(listener) {
      const stop = observeQuestionStructure(win.document, listener, 'main.common_look.ucenter-student,.common_look_main,.questiono-item');
      win.addEventListener('hashchange', listener);
      win.addEventListener('popstate', listener);
      return () => {
        stop();
        win.removeEventListener('hashchange', listener);
        win.removeEventListener('popstate', listener);
      };
    },
  };
}
