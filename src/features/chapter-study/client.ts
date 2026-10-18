import { requestExtension } from '../../core/extension-rpc';
import { bridgeMessage, type BridgeMessage, type PageBridge } from '../../shared/bridge';
import { isFeatureEnabled, type Settings } from '../toolbox-settings/types';
import { isStudyId, isStudyPageRequest, isStudyPageResult, isStudyPreferences, STUDY_CANCEL, STUDY_PORT, STUDY_WAKE } from './protocol';
import type { StudyPageRequest, StudyPageResult, StudyRuntime, StudySession } from './types';

interface Pending { resolve(value: unknown): void; reject(error: Error): void; clean(): void }
interface HubPending extends Pending { message: Record<string, unknown>; armTimeout(): void; pauseTimeout(): void }
const RECOVERY_LIMIT = 30000;

/** Each frame operates only its own MAIN world; the broker routes trusted frame IDs. */
export function createStudyFrameClient(bridge: PageBridge, getSettings: () => Settings | undefined) {
  let port: chrome.runtime.Port | undefined;
  let mainReady = false;
  let suspended = false;
  let disposed = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = 250;
  const pending = new Map<string, HubPending>();
  const mainPending = new Map<string, Pending & { request: StudyPageRequest }>();
  const activeRuns = new Set<string>();
  const cancelledRuns = new Set<string>();
  // These promises belong to this document. A broker restart must reattach instead of replaying media initialization.
  const mainRuns = new Map<string, { runId: string; done: boolean; promise: Promise<StudyPageResult> }>();
  const enabled = () => { const settings = getSettings(); return !disposed && !suspended && Boolean(settings && isFeatureEnabled(settings, 'chapter-study')); };

  function mainRequest(request: StudyPageRequest, signal?: AbortSignal): Promise<StudyPageResult> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new DOMException('已取消', 'AbortError')); return; }
      const requestId = crypto.randomUUID();
      const timer = request.action === 'run' ? undefined : setTimeout(() => finish(new Error('页面适配器连接超时，请刷新页面后重试。')), request.action === 'card' ? 17000 : 5000);
      const onAbort = () => finish(new DOMException('已取消', 'AbortError'));
      const finish = (error?: Error, value?: StudyPageResult) => {
        const entry = mainPending.get(requestId);
        if (!entry) return;
        entry.clean(); mainPending.delete(requestId);
        if (error) reject(error); else resolve(value!);
      };
      mainPending.set(requestId, { request,
        resolve: value => finish(undefined, value as StudyPageResult), reject: error => finish(error),
        clean() { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); },
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      if (mainReady) bridge.send(bridgeMessage({ kind: 'study-command', requestId, request }));
    });
  }

  function clearRecovery(): void {
    clearTimeout(retryTimer); retryTimer = undefined;
    clearTimeout(recoveryTimer); recoveryTimer = undefined;
    retryDelay = 250;
  }

  function cancelLocal(runId: string): void {
    cancelledRuns.add(runId);
    if (cancelledRuns.size > 1000) cancelledRuns.delete(cancelledRuns.values().next().value!);
    bridge.send(bridgeMessage({ kind: 'study-command', requestId: crypto.randomUUID(), request: { action: 'cancel', runId } }));
    activeRuns.delete(runId);
    for (const entry of [...mainPending.values()]) {
      if (entry.request.action === 'run' && entry.request.runId === runId) entry.resolve({ ok: false, error: '任务已取消。' });
    }
  }

  function disconnect(error = new Error('章节学习连接中断，已停止任务。')): void {
    clearRecovery();
    const connection = port;
    port = undefined;
    for (const runId of [...activeRuns]) cancelLocal(runId);
    for (const entry of [...mainPending.values()]) entry.reject(error);
    for (const entry of [...pending.values()]) entry.reject(error);
    try { connection?.disconnect(); } catch { /* Already disconnected. */ }
  }

  function recover(): void {
    if (!enabled() || (!pending.size && !activeRuns.size)) return;
    if (!recoveryTimer) recoveryTimer = setTimeout(() => disconnect(new Error('章节学习连接恢复超时，已暂停；请继续或刷新页面。')), RECOVERY_LIMIT);
    if (retryTimer || port) return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      if (!enabled()) return;
      try { connect(); } catch { recover(); }
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 2000);
  }

  function sendPending(connection: chrome.runtime.Port, entry: HubPending): void {
    try { connection.postMessage(entry.message); entry.armTimeout(); }
    catch { if (port === connection) lostConnection(connection); else recover(); }
  }

  function lostConnection(connection: chrome.runtime.Port): void {
    if (port !== connection) return;
    port = undefined;
    for (const entry of pending.values()) entry.pauseTimeout();
    // A temporary worker/port restart does not mean that the user asked to stop the player.
    if (enabled()) recover(); else disconnect();
  }

  function connect(): chrome.runtime.Port {
    if (port) return port;
    if (!enabled()) throw new Error('请先开启章节学习。');
    const connection = chrome.runtime.connect({ name: STUDY_PORT });
    port = connection;
    connection.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      lostConnection(connection);
    });
    connection.onMessage.addListener((message: unknown) => {
      if (port !== connection || !message || typeof message !== 'object') return;
      const value = message as Record<string, unknown>;
      if (value.kind === 'heartbeat') {
        clearRecovery();
        try { connection.postMessage({ kind: 'pong' }); } catch { lostConnection(connection); }
        return;
      }
      if (value.kind === 'ready') { clearRecovery(); return; }
      if (!isStudyId(value.id)) return;
      clearRecovery();
      if (value.kind === 'response') {
        const entry = pending.get(value.id);
        if (!entry) return;
        if (typeof value.error === 'string') entry.reject(new Error(value.error.slice(0, 500)));
        else { pending.delete(value.id); entry.clean(); entry.resolve(value.result); }
      } else if (value.kind === 'page-request' && isStudyPageRequest(value.request)) {
        const request = value.request;
        if (!enabled()) return;
        let promise: Promise<StudyPageResult>;
        if (request.action === 'cancel') { cancelLocal(request.runId); promise = Promise.resolve({ ok: true }); }
        else if (request.action === 'run') {
          if (cancelledRuns.has(request.runId)) promise = Promise.resolve({ ok: false, error: '任务已取消。' });
          else {
            const key = JSON.stringify([request.runId, request.documentKey, request.taskKey]);
            let cached = mainRuns.get(key);
            if (cached) promise = cached.promise;
            else if (request.resumeOnly) promise = Promise.resolve({ ok: true, cacheMiss: true });
            else {
              activeRuns.add(request.runId);
              cached = { runId: request.runId, done: false, promise: mainRequest(request).catch(error => ({ ok: false, error: error instanceof Error ? error.message.slice(0, 500) : '任务执行失败。' })) };
              const entry = cached;
              mainRuns.set(key, entry);
              void entry.promise.then(() => {
                entry.done = true;
                if (![...mainRuns.values()].some(item => item.runId === request.runId && !item.done)) activeRuns.delete(request.runId);
                if (mainRuns.size > 200) for (const [oldKey, old] of mainRuns) {
                  if (old.done && oldKey !== key) mainRuns.delete(oldKey);
                  if (mainRuns.size <= 200) break;
                }
              });
              promise = cached.promise;
            }
          }
        } else promise = mainRequest(request);
        void promise.catch(error => ({ ok: false, error: error instanceof Error ? error.message.slice(0, 500) : '任务执行失败。' })).then(result => {
          if (port !== connection) return;
          try { connection.postMessage({ kind: 'page-response', id: value.id, result }); } catch { lostConnection(connection); }
        });
      }
    });
    // The worker acknowledges actual traffic; merely opening a long-lived port does not keep it alive.
    try { connection.postMessage({ kind: 'hello' }); } catch { lostConnection(connection); }
    for (const entry of pending.values()) sendPending(connection, entry);
    return connection;
  }

  function hubRequest<T>(operation: string, payload: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new DOMException('已取消', 'AbortError')); return; }
      let connection: chrome.runtime.Port;
      try { connection = connect(); } catch (error) { reject(error); return; }
      const id = crypto.randomUUID();
      const finish = (error: Error) => {
        const entry = pending.get(id);
        if (!entry) return;
        entry.clean(); pending.delete(id); reject(error);
      };
      const onAbort = () => {
        finish(new DOMException('已取消', 'AbortError'));
        if (operation === 'run' && isStudyPageRequest(payload.request) && payload.request.action === 'run') cancelRun(payload.request.runId);
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const pauseTimeout = () => { clearTimeout(timer); timer = undefined; };
      const armTimeout = () => {
        pauseTimeout();
        if (operation !== 'run') timer = setTimeout(() => finish(new Error('学习框架连接超时，请重试。')), 6500);
      };
      const entry: HubPending = { message: { kind: 'request', id, operation, ...payload },
        resolve: value => resolve(value as T), reject: finish, armTimeout, pauseTimeout,
        clean() { pauseTimeout(); signal?.removeEventListener('abort', onAbort); },
      };
      pending.set(id, entry);
      signal?.addEventListener('abort', onAbort, { once: true });
      sendPending(connection, entry);
    });
  }

  function cancelRun(runId: string): void {
    cancelLocal(runId);
    // This path also reaches child frames while their broker ports are reconnecting.
    void requestExtension('toolbox:study:cancel', { runId }).catch(() => undefined);
    if (port && enabled()) void hubRequest('cancel', { runId }).catch(() => undefined);
  }

  const onMessage = (message: { type?: string; runId?: unknown }, sender: chrome.runtime.MessageSender) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message?.type === STUDY_CANCEL && isStudyId(message.runId)) cancelLocal(message.runId);
    else if (message?.type === STUDY_WAKE && enabled()) { try { connect(); } catch { recover(); } }
  };
  chrome.runtime.onMessage.addListener(onMessage);
  const onHide = () => { suspended = true; disconnect(new Error('章节学习页面已离开。')); };
  const onShow = () => { suspended = false; if (enabled()) { try { connect(); } catch { recover(); } } };
  window.addEventListener('pagehide', onHide);
  window.addEventListener('pageshow', onShow);

  const runtime: StudyRuntime = {
    scan: signal => hubRequest('scan', {
      chapterId: document.querySelector<HTMLInputElement>('#curChapterId')?.value
        || document.querySelector('.posCatalog_active')?.id.replace(/^cur/, ''),
    }, signal),
    runTask: (target, runId, preferences, signal) => hubRequest('run', {
      frameId: target.frameId, documentId: target.documentId,
      chapterId: document.querySelector<HTMLInputElement>('#curChapterId')?.value
        || document.querySelector('.posCatalog_active')?.id.replace(/^cur/, ''),
      request: { action: 'run', runId, taskKey: target.key, documentKey: target.documentKey, preferences },
    }, signal),
    async page(request, signal) {
      const result = await mainRequest(request, signal);
      if (!result.ok) throw new Error(result.error ?? '页面操作失败。');
      return result;
    },
    cancel: cancelRun,
    configure: async preferences => { await hubRequest('configure', { preferences }); },
    readPreferences: () => requestExtension('toolbox:study:preferences:read'),
    writePreferences: preferences => requestExtension('toolbox:study:preferences:write', { preferences }),
    subscribePreferences(listener) {
      const receive = (message: { type?: string; preferences?: unknown }, sender: chrome.runtime.MessageSender) => {
        if (sender.id === chrome.runtime.id && message?.type === 'toolbox:study:preferences:changed' && isStudyPreferences(message.preferences)) listener(message.preferences);
      };
      chrome.runtime.onMessage.addListener(receive);
      return () => chrome.runtime.onMessage.removeListener(receive);
    },
    readSession: courseKey => requestExtension<StudySession | undefined>('toolbox:study:session:read', { courseKey }),
    writeSession: session => requestExtension('toolbox:study:session:write', { session }),
  };
  return {
    runtime,
    receive(message: BridgeMessage) {
      if (message.kind === 'ready') {
        mainReady = true;
        for (const [requestId, entry] of mainPending) bridge.send(bridgeMessage({ kind: 'study-command', requestId, request: entry.request }));
      } else if (message.kind === 'study-result' && isStudyPageResult(message.result)) mainPending.get(message.requestId)?.resolve(message.result);
    },
    settingsChanged() { if (enabled()) { try { connect(); } catch { recover(); } } else disconnect(); },
    dispose() {
      disposed = true; disconnect();
      chrome.runtime.onMessage.removeListener(onMessage);
      window.removeEventListener('pagehide', onHide); window.removeEventListener('pageshow', onShow);
    },
  };
}
