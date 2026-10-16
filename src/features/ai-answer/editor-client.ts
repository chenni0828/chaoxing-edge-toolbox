import { bridgeMessage, type BridgeMessage, type PageBridge } from '../../shared/bridge';
import type { AnswerSnapshot, AnswerWriteRequest, AnswerWriteResult } from './types';

export function createEditorClient(bridge: PageBridge) {
  const pending = new Map<string, { resolve: (result: AnswerSnapshot | AnswerWriteResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  function request(kind: 'editor-read' | 'editor-write', write?: AnswerWriteRequest): Promise<AnswerSnapshot | AnswerWriteResult> {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error('编辑器连接超时，请刷新页面后重试。'));
      }, 4500);
      pending.set(requestId, { resolve, reject, timer });
      bridge.send(kind === 'editor-write'
        ? bridgeMessage({ kind, requestId, request: write! })
        : bridgeMessage({ kind, requestId }));
    });
  }
  return {
    readAnswer: () => request('editor-read') as Promise<AnswerSnapshot>,
    writeAnswer: (value: AnswerWriteRequest) => request('editor-write', value) as Promise<AnswerWriteResult>,
    receive(message: BridgeMessage) {
      if (message.kind !== 'editor-result') return;
      const entry = pending.get(message.requestId);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(message.requestId);
      entry.resolve(message.result);
    },
    dispose() {
      for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('页面已离开。')); }
      pending.clear();
    },
  };
}
