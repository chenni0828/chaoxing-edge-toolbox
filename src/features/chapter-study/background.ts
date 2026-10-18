import { broadcastPublic, isSupportedContent, privateStorageReady, type BackgroundRoutes } from '../../core/background-context';
import { readStoredSettings } from '../toolbox-settings/background';
import { isFeatureEnabled } from '../toolbox-settings/types';
import { isStudyId, isStudyPageRequest, isStudyPageResult, isStudyPreferences, isStudySession, STUDY_CANCEL, STUDY_PORT, STUDY_WAKE } from './protocol';
import { normalizeStudyPreferences, STUDY_SETTINGS_KEY, type StudyPageRequest, type StudyPageResult, type StudyTarget } from './types';

const sessionPrefix = (tabId: number) => `chapter-study.session.${tabId}`;
const sessionKey = (tabId: number, courseKey: string) => `${sessionPrefix(tabId)}.${encodeURIComponent(courseKey)}`;
const broadcastCancel = async (tabId: number, runId: string) => { await chrome.tabs.sendMessage(tabId, { type: STUDY_CANCEL, runId }).catch(() => undefined); };
export const studyRoutes: BackgroundRoutes = {
  'toolbox:study:preferences:read': { access: 'public', handle: async () => {
    await privateStorageReady;
    const stored = await chrome.storage.local.get(STUDY_SETTINGS_KEY);
    return normalizeStudyPreferences(stored[STUDY_SETTINGS_KEY]);
  } },
  'toolbox:study:preferences:write': { access: 'public', handle: async (message) => {
    if (!isStudyPreferences(message.preferences)) throw new Error('无效的章节学习设置。');
    await chrome.storage.local.set({ [STUDY_SETTINGS_KEY]: message.preferences });
  } },
  'toolbox:study:cancel': { access: 'top-page', handle: async (message, sender) => {
    if (!isStudyId(message.runId)) throw new Error('无效的章节学习任务。');
    await broadcastCancel(sender.tab!.id!, message.runId);
  } },
  'toolbox:study:session:read': { access: 'top-page', handle: async (message, sender) => {
    if (typeof message.courseKey !== 'string' || message.courseKey.length > 300) throw new Error('无效的章节学习课程。');
    const tabId = sender.tab!.id!;
    const key = sessionKey(tabId, message.courseKey);
    const stored = (await chrome.storage.session.get(key))[key];
    if (isStudySession(stored) && stored.courseKey === message.courseKey) return stored;
    // Migrate the previous single-course slot without discarding another course's state.
    const legacyKey = sessionPrefix(tabId);
    const legacy = (await chrome.storage.session.get(legacyKey))[legacyKey];
    if (!isStudySession(legacy) || legacy.courseKey !== message.courseKey) return undefined;
    await chrome.storage.session.set({ [key]: legacy });
    await chrome.storage.session.remove(legacyKey);
    return legacy;
  } },
  'toolbox:study:session:write': { access: 'top-page', handle: async (message, sender) => {
    if (!isStudySession(message.session)) throw new Error('无效的章节学习运行状态。');
    await chrome.storage.session.set({ [sessionKey(sender.tab!.id!, message.session.courseKey)]: message.session });
  } },
};

interface PagePending {
  command: StudyPageRequest; resolve(result: StudyPageResult): void; reject(error: Error): void;
  timer?: ReturnType<typeof setTimeout>;
}
interface HubResult { result?: unknown; error?: string }
interface Peer {
  port: chrome.runtime.Port; connected: boolean; frameId: number; documentId?: string;
  expiry?: ReturnType<typeof setTimeout>;
  authorized: Map<string, { documentKey: string; jobId: string }>;
  pending: Map<string, PagePending>;
  requests: Map<string, Promise<HubResult>>;
}

/** Only the tab's top content script may dispatch; frame identities come from Chrome. */
export function installStudyBroker(): void {
  const tabs = new Map<number, Map<number, Peer>>();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const refreshHeartbeat = () => {
    const busy = [...tabs.values()].some(peers => [...peers.values()].some(peer => peer.pending.size));
    if (busy && !heartbeat) heartbeat = setInterval(() => {
      for (const peers of tabs.values()) for (const peer of peers.values()) if (peer.connected) {
        // Receiving pong traffic keeps the worker alive even while content-page timers are throttled.
        try { peer.port.postMessage({ kind: 'heartbeat' }); } catch { /* onDisconnect starts bounded recovery. */ }
      }
    }, 15000);
    if (!busy && heartbeat) { clearInterval(heartbeat); heartbeat = undefined; }
  };
  const failPeer = (peer: Peer, error: Error) => {
    clearTimeout(peer.expiry);
    for (const pending of peer.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    peer.pending.clear();
    refreshHeartbeat();
  };
  const postPending = (peer: Peer, id: string, pending: PagePending) => {
    if (!peer.connected) return;
    if (pending.command.action !== 'run') pending.timer = setTimeout(() => {
      peer.pending.delete(id); pending.reject(new Error('页面连接超时，请重试。')); refreshHeartbeat();
    }, 4000);
    try { peer.port.postMessage({ kind: 'page-request', id, request: pending.command }); }
    catch { clearTimeout(pending.timer); pending.timer = undefined; }
  };
  const request = (peer: Peer, command: StudyPageRequest): Promise<StudyPageResult> => new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const pending: PagePending = { command, resolve, reject };
    peer.pending.set(id, pending);
    postPending(peer, id, pending);
    refreshHeartbeat();
  });
  const scan = async (peers: Map<number, Peer>, chapterId: unknown) => {
    if (typeof chapterId !== 'string' || !/^\d{1,30}$/.test(chapterId)) throw new Error('当前章节尚未就绪。');
    // Give freshly injected/reconnected frames time to register before authenticating their own snapshots.
    await new Promise(resolve => setTimeout(resolve, 400));
    const results = await Promise.allSettled([...peers.values()].filter(peer => peer.connected).map(async peer => ({ peer, result: await request(peer, { action: 'inspect' }) })));
    const targets: StudyTarget[] = [];
    const seen = new Set<string>();
    const warnings: string[] = [];
    const allowedJobs = new Set<string>();
    for (const source of peers.values()) source.authorized.clear();
    for (const result of results) if (result.status === 'fulfilled') {
      const snapshot = result.value.result.snapshot;
      if (snapshot?.chapterId === chapterId && snapshot.cardReady) {
        for (const jobId of snapshot.attachmentJobIds ?? []) allowedJobs.add(jobId);
      }
    }
    let cardReady = false;
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      const { peer: source, result: response } = result.value;
      const snapshot = response.snapshot;
      if (!response.ok || !snapshot || peers.get(source.frameId) !== source || !source.connected) continue;
      if (snapshot.chapterId && snapshot.chapterId !== chapterId) continue;
      cardReady ||= snapshot.chapterId === chapterId && snapshot.cardReady;
      if (snapshot.warning) warnings.push(snapshot.warning);
      for (const task of snapshot.tasks) {
        if (!snapshot.chapterId && !allowedJobs.has(task.jobId)) continue;
        if (seen.has(task.key)) continue;
        seen.add(task.key);
        const isTaskPoint = task.isTaskPoint || allowedJobs.has(task.jobId);
        if (isTaskPoint) source.authorized.set(task.key, { documentKey: snapshot.documentKey, jobId: task.jobId });
        targets.push({ ...task, isTaskPoint, frameId: source.frameId, documentId: source.documentId, documentKey: snapshot.documentKey });
      }
    }
    return { targets, cardReady, warnings: [...new Set(warnings)] };
  };
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== STUDY_PORT || !port.sender || !isSupportedContent(port.sender)) return;
    const tabId = port.sender.tab!.id!;
    const frameId = port.sender.frameId ?? -1;
    if (frameId < 0) { port.disconnect(); return; }
    const peers = tabs.get(tabId) ?? new Map<number, Peer>();
    tabs.set(tabId, peers);
    const previous = peers.get(frameId);
    // Only a stable Chrome document ID permits reusing pending work across a new port.
    const reusable = previous && Boolean(port.sender.documentId) && previous.documentId === port.sender.documentId;
    const peer: Peer = reusable ? previous : { port, connected: true, frameId, documentId: port.sender.documentId,
      pending: new Map(), authorized: new Map(), requests: new Map() };
    if (previous) {
      clearTimeout(previous.expiry);
      if (!reusable) { previous.connected = false; failPeer(previous, new Error('任务框架已更换，请重新扫描。')); }
      if (previous.port !== port) { const oldPort = previous.port; previous.port = port; peer.port = port; try { oldPort.disconnect(); } catch { /* Already gone. */ } }
    }
    peer.port = port; peer.connected = true;
    peers.set(frameId, peer);
    port.onDisconnect.addListener(() => {
      if (peer.port !== port) return;
      peer.connected = false;
      for (const pending of peer.pending.values()) { clearTimeout(pending.timer); pending.timer = undefined; }
      peer.expiry = setTimeout(() => {
        if (peer.connected || peers.get(frameId) !== peer) return;
        peers.delete(frameId);
        if (!peers.size) tabs.delete(tabId);
        failPeer(peer, new Error('任务框架连接恢复超时，已暂停。'));
      }, 30000);
    });
    port.onMessage.addListener((message: unknown) => {
      if (peer.port !== port || !message || typeof message !== 'object') return;
      const value = message as Record<string, unknown>;
      if (value.kind === 'hello') { try { port.postMessage({ kind: 'ready' }); } catch { /* Reconnecting. */ } return; }
      if (value.kind === 'pong') return;
      if (value.kind === 'page-response' && isStudyId(value.id) && isStudyPageResult(value.result)) {
        const pending = peer.pending.get(value.id);
        if (pending) { clearTimeout(pending.timer); peer.pending.delete(value.id); pending.resolve(value.result); refreshHeartbeat(); }
        return;
      }
      if (frameId !== 0 || !isStudyId(value.id) || value.kind !== 'request') return;
      const reply = ({ result, error }: HubResult) => {
        if (!peer.connected) return;
        try { peer.port.postMessage({ kind: 'response', id: value.id, result, error }); } catch { /* Top document left. */ }
      };
      const execute = async () => {
        if (peers.get(frameId) !== peer) throw new Error('章节页面已更换。');
        if (value.operation === 'cancel' && isStudyId(value.runId)) {
          // Cancellation must also reach documents whose ports are currently disconnected.
          await broadcastCancel(tabId, value.runId);
          await Promise.allSettled([...peers.values()].filter(target => target.connected).map(target => request(target, { action: 'cancel', runId: value.runId as string })));
          return true;
        }
        if (!isFeatureEnabled(await readStoredSettings(), 'chapter-study')) throw new Error('章节学习已关闭。');
        if (peers.get(frameId) !== peer) throw new Error('章节页面已更换。');
        if (value.operation === 'ping') return true;
        if (value.operation === 'scan') return scan(peers, value.chapterId);
        if (value.operation === 'configure' && isStudyPreferences(value.preferences)) {
          const preferences = value.preferences;
          await Promise.allSettled([...peers.values()].filter(target => target.connected).map(target => request(target, { action: 'configure', preferences })));
          return true;
        }
        if (value.operation === 'run' && Number.isSafeInteger(value.frameId) && isStudyPageRequest(value.request) && value.request.action === 'run') {
          const command = value.request;
          // A restarted worker has no peers/authorization yet; wait briefly for same-document registrations.
          const deadline = Date.now() + 3000;
          while (!peers.has(value.frameId as number) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
          if (peers.get(frameId) !== peer) throw new Error('章节页面已更换。');
          const target = peers.get(value.frameId as number);
          if (!target || target.documentId !== value.documentId) throw new Error('任务框架已更换，请重新扫描。');
          if (!target.authorized.has(command.taskKey)) {
            // Completed jobs may disappear from attachments before a worker restart. Querying an exact
            // document/run/task cache can recover their result, but must never initialize a new task.
            const cached = await request(target, { ...command, resumeOnly: true });
            if (peers.get(frameId) !== peer || peers.get(target.frameId) !== target) throw new Error('任务框架已更换，请重新扫描。');
            if (!cached.cacheMiss) {
              if (!cached.ok || !cached.outcome) throw new Error(cached.error ?? '任务未返回有效结果。');
              return cached.outcome;
            }
            await scan(peers, value.chapterId);
          }
          if (peers.get(frameId) !== peer || peers.get(target.frameId) !== target) throw new Error('任务框架已更换，请重新扫描。');
          const authorization = target.authorized.get(command.taskKey);
          if (!authorization || authorization.documentKey !== command.documentKey) throw new Error('任务不在当前卡片已验证的任务点中，请重新扫描。');
          const result = await request(target, { ...command, resumeOnly: false, verifiedJobId: authorization.jobId });
          if (!result.ok || !result.outcome) throw new Error(result.error ?? '任务未返回有效结果。');
          return result.outcome;
        }
        throw new Error('无效的章节学习命令。');
      };
      let operation = peer.requests.get(value.id);
      if (!operation) {
        operation = execute().then(result => ({ result })).catch(error => ({ error: error instanceof Error ? error.message : '章节学习操作失败。' }));
        peer.requests.set(value.id, operation);
        if (peer.requests.size > 200) peer.requests.delete(peer.requests.keys().next().value!);
      }
      void operation.then(reply);
    });
    for (const [id, pending] of peer.pending) postPending(peer, id, pending);
    if (frameId === 0) void chrome.tabs.sendMessage(tabId, { type: STUDY_WAKE }).catch(() => undefined);
    void chrome.storage.local.get(STUDY_SETTINGS_KEY).then(stored => request(peer,
      { action: 'configure', preferences: normalizeStudyPreferences(stored[STUDY_SETTINGS_KEY]) })).catch(() => undefined);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STUDY_SETTINGS_KEY]) void broadcastPublic({
      type: 'toolbox:study:preferences:changed', preferences: normalizeStudyPreferences(changes[STUDY_SETTINGS_KEY].newValue),
    });
  });
  chrome.tabs.onRemoved.addListener(tabId => {
    const peers = tabs.get(tabId);
    tabs.delete(tabId);
    for (const peer of peers?.values() ?? []) failPeer(peer, new Error('学习标签页已关闭。'));
    const prefix = sessionPrefix(tabId);
    void chrome.storage.session.get(null).then(stored => chrome.storage.session.remove(Object.keys(stored).filter(key => key === prefix || key.startsWith(`${prefix}.`))));
  });
}
