/**
 * 倍速兼容：替换平台播放器的初始化，去掉原生速率限制，
 * 同时保留平台的进度上报与清晰度、线路切换逻辑。
 */
type Method = (this: unknown, ...args: unknown[]) => unknown;
interface Plugin extends Method { prototype: object }
interface Player {
  on?: (event: string, listener: () => void) => void;
  off?: (event: string, listener: () => void) => void;
  videoJsResolutionSwitcher?: unknown;
  videoJsPlayLine?: unknown;
  currentResolution?: () => { sources?: Array<{ res?: unknown }> };
  currentPlayline?: () => { net?: unknown };
}
interface VideoJs {
  (target: unknown, options: unknown, ready: () => void): Player;
  getPlugin(name: string): Plugin;
  registerPlugin(name: string, plugin: Plugin): void;
  extend(parent: Plugin, methods: { constructor: Method }): Plugin;
  getPlayers?: () => Record<string, unknown>;
}
interface VideoConstructor extends Method { prototype: { constructor: Method } }
interface ExtApi {
  define(name: string, definition: Record<string, unknown>): unknown;
  ClassManager?: { get(name: string): VideoConstructor | undefined };
  setCookie?: (name: string, value: unknown) => void;
}
interface PlayerData extends Record<string, unknown> { sendLog?: Method; videojs?: unknown; params?: unknown }
interface PlayerHost {
  addEvents(events: string[]): void;
  mixins: { observable: { constructor: Method } };
  params2VideoOpt(params: unknown): unknown;
}
interface HookWindow extends Window { videojs?: VideoJs; Ext?: ExtApi }

export interface StudyRateHook { setEnabled(enabled: boolean): void; dispose(): void; warning(): string | undefined }

/** Restore only references that still belong to this feature; never overwrite another extension. */
export function installStudyRateHook(window: Window): StudyRateHook {
  const win = window as HookWindow;
  let enabled = false;
  let disposed = false;
  let installed = false;
  let interval: number | undefined;
  let readyDeadline = 0;
  let note: string | undefined;
  let dragCount = 0;
  const cleanups: Array<() => void> = [];
  const logPatches = new Set<{ data: PlayerData; original: Method; wrapper: Method }>();
  let restoreGlobals: (() => void) | undefined;

  const cleanListeners = (): void => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      try { cleanup(); } catch { /* Old player instances can already be disposed. */ }
    }
    for (const patch of logPatches) {
      if (patch.data.sendLog === patch.wrapper) patch.data.sendLog = patch.original;
    }
  };
  const stopPolling = (): void => {
    if (interval !== undefined) win.clearInterval(interval);
    interval = undefined;
  };
  const tryInstall = (): void => {
    if (!enabled || disposed || installed || !/\/ananas\/modules\/video\//.test(win.location.pathname)) return;
    const vjs = win.videojs;
    const ext = win.Ext;
    if (!vjs || !ext || typeof vjs.getPlugin !== 'function' || typeof vjs.extend !== 'function'
      || typeof vjs.registerPlugin !== 'function' || typeof ext.define !== 'function') return;
    const classConstructor = ext.ClassManager?.get('ans.VideoJs');
    if (!classConstructor || typeof classConstructor.prototype?.constructor !== 'function') return;
    let originalPlugin: Plugin;
    try {
      originalPlugin = vjs.getPlugin('seekBarControl');
    } catch { return; }
    if (typeof originalPlugin !== 'function') return;
    const originalConstructor = classConstructor.prototype.constructor;
    const hookConstructor: Method = function(this: unknown, rawData: unknown) {
      if (!enabled || disposed) return originalConstructor.call(this, rawData);
      // 这里刻意替换初始化流程：平台构造函数在 ready 回调里安装 ratechange
      // 限制（部分视频连 1 倍都会被压回去）。params2VideoOpt 仍会装上原生的
      // 进度上报插件。
      const host = this as PlayerHost;
      const data = rawData as PlayerData;
      host.addEvents(['seekstart']);
      host.mixins.observable.constructor.call(this, data);
      const player = vjs(data.videojs, host.params2VideoOpt(data.params), () => {});
      try {
        const element = typeof data.videojs === 'string' ? win.document.getElementById(data.videojs) : data.videojs;
        if (element && typeof element === 'object' && 'addEventListener' in element) {
          const target = element as HTMLElement;
          const contextMenu = (event: Event): void => { if (enabled) event.preventDefault(); };
          const keyDown = (event: Event): void => {
            const keyboard = event as KeyboardEvent;
            if (enabled && [32, 37, 39, 107].includes(keyboard.keyCode)) keyboard.preventDefault();
          };
          target.addEventListener('contextmenu', contextMenu);
          target.addEventListener('keydown', keyDown);
          cleanups.push(() => { target.removeEventListener('contextmenu', contextMenu); target.removeEventListener('keydown', keyDown); });
        }
        if (player) {
          const onResolution = (): void => {
            if (!enabled) return;
            const current = player.currentResolution?.();
            ext.setCookie?.('resolution', current?.sources?.[0]?.res ?? false);
          };
          const onLine = (): void => { if (enabled) ext.setCookie?.('net', player.currentPlayline?.().net); };
          if (player.videoJsResolutionSwitcher) {
            player.on?.('resolutionchange', onResolution);
            cleanups.push(() => player.off?.('resolutionchange', onResolution));
          }
          if (player.videoJsPlayLine) {
            player.on?.('playlinechange', onLine);
            cleanups.push(() => player.off?.('playlinechange', onLine));
          }
        }
      } catch { /* Optional controls must not break the playback plugins. */ }
      return undefined;
    };
    // Extend the platform's own plugin, not `plugin`: the overwritten prototype
    // must still expose now_/sec_/sendDataLog, otherwise the platform's own
    // event handlers throw and the progress log chain stops.
    const replacement = vjs.extend(originalPlugin, {
      constructor: function(this: unknown, video: unknown, rawData: unknown) {
        const data = rawData as PlayerData;
        if (enabled && data && typeof data.sendLog === 'function') {
          const original = data.sendLog;
          const wrapper: Method = function(this: unknown, ...args: unknown[]) {
            if (!enabled || disposed || args[1] !== 'drag') return original.apply(data, args);
            dragCount += 1;
            if (dragCount > 100) {
              dragCount = 0;
              win.document.querySelector<HTMLVideoElement>('video')?.pause();
            }
            return undefined;
          };
          data.sendLog = wrapper;
          logPatches.add({ data, original, wrapper });
        }
        return originalPlugin.call(this, video, data);
      },
    });
    try {
      const existingPlayers = vjs.getPlayers?.();
      if (existingPlayers && Object.values(existingPlayers).some(Boolean)) {
        note = '播放器已初始化，倍速兼容处理可能需要刷新页面后生效。';
      }
      vjs.registerPlugin('seekBarControl', replacement);
      ext.define('ans.VideoJs', { override: 'ans.VideoJs', constructor: hookConstructor });
      const installedConstructor = classConstructor.prototype.constructor;
      restoreGlobals = () => {
        if (vjs.getPlugin('seekBarControl') === replacement) vjs.registerPlugin('seekBarControl', originalPlugin);
        if (classConstructor.prototype.constructor === installedConstructor) classConstructor.prototype.constructor = originalConstructor;
      };
      installed = true;
      stopPolling();
    } catch {
      try { if (vjs.getPlugin('seekBarControl') === replacement) vjs.registerPlugin('seekBarControl', originalPlugin); } catch { /* Keep failures local to the adapter. */ }
      note = '当前播放器与倍速接口不兼容，请使用页面原有倍速控件。';
    }
  };
  const safeInstall = (): void => {
    try { tryInstall(); }
    catch { note = '当前播放器与倍速接口不兼容，请使用页面原有倍速控件。'; }
  };
  const onReady = (): void => { safeInstall(); };
  return {
    setEnabled(nextEnabled) {
      if (disposed || enabled === nextEnabled) return;
      enabled = nextEnabled;
      if (enabled) {
        note = undefined;
        for (const patch of logPatches) {
          if (patch.data.sendLog === patch.original) patch.data.sendLog = patch.wrapper;
        }
        readyDeadline = Date.now() + 30000;
        win.document.addEventListener('readystatechange', onReady);
        win.addEventListener('load', onReady);
        safeInstall();
        if (!installed && /\/ananas\/modules\/video\//.test(win.location.pathname)) {
          interval = win.setInterval(() => {
            safeInstall();
            if (!installed && Date.now() >= readyDeadline) {
              note = '未检测到兼容的播放器接口，倍速可能受页面限制。';
              stopPolling();
            }
          }, 100);
        }
      } else {
        stopPolling();
        win.document.removeEventListener('readystatechange', onReady);
        win.removeEventListener('load', onReady);
        cleanListeners();
        try { restoreGlobals?.(); } catch { /* An unloaded page may remove its plugin registry. */ }
        restoreGlobals = undefined;
        installed = false;
        dragCount = 0;
      }
    },
    warning() { return note; },
    dispose() { this.setEnabled(false); disposed = true; logPatches.clear(); },
  };
}
