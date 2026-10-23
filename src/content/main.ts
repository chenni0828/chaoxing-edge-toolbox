import { FeatureManager } from '../core/feature-manager';
import { getPageFeatures } from '../features/page-registry';
import { bridgeMessage, installMainBridge } from '../shared/bridge';
import { readUeditorAnswer, writeUeditorAnswer } from '../features/ai-answer/editor';
import { handleStudyPageRequest } from '../features/chapter-study/page';
import { getDocumentPlatform } from '../shared/sites';

function install(): void {
  const platform = getDocumentPlatform(window);
  if (platform?.id !== 'chaoxing') return;
  const manager = new FeatureManager(window, getPageFeatures(platform?.id));
  let revision = 0;

  const bridge = installMainBridge(window, (message) => {
    if (message.kind === 'study-command') {
      void handleStudyPageRequest(window, message.request).then(result => {
        bridge.send(bridgeMessage({ kind: 'study-result', requestId: message.requestId, result }));
      }).catch(() => {
        bridge.send(bridgeMessage({ kind: 'study-result', requestId: message.requestId, result: { ok: false, error: '章节任务执行失败，请暂停后重试。' } }));
      });
      return;
    }
    if (message.kind === 'editor-read') {
      bridge.send(bridgeMessage({ kind: 'editor-result', requestId: message.requestId, result: readUeditorAnswer(window) }));
      return;
    }
    if (message.kind === 'editor-write') {
      bridge.send(bridgeMessage({ kind: 'editor-result', requestId: message.requestId, result: writeUeditorAnswer(window, message.request) }));
      return;
    }
    if (message.kind !== 'apply' || message.revision < revision) return;
    revision = message.revision;
    const result = manager.apply(message.settings);
    bridge.send(bridgeMessage({ kind: 'applied', revision, ...result }));
  });
}

install();
