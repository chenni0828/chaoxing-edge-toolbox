import { FeatureManager } from '../core/feature-manager';
import { PAGE_FEATURES } from '../features/page-registry';
import { bridgeMessage, installMainBridge } from '../shared/bridge';
import { readUeditorAnswer, writeUeditorAnswer } from '../features/ai-answer/editor';

const manager = new FeatureManager(window, PAGE_FEATURES);
let revision = 0;

const bridge = installMainBridge(window, (message) => {
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
