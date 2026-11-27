import { checkForUpdates, normalizeBuildInfo } from './checker';
import { isReleaseVersion, type BuildInfo, type UpdateCandidate, type UpdateResult, type UpdateSnapshot } from './types';

interface UpdateCache {
  buildKey: string;
  result?: UpdateResult;
  lastSuccess?: UpdateResult;
  popupAttemptAt?: number;
  popupNoticeAt?: number;
}

interface UpdateServiceDependencies {
  installedVersion: string;
  readBuildInfo(): Promise<unknown>;
  readCache(): Promise<unknown>;
  writeCache(cache: UpdateCache): Promise<void>;
  check?: typeof checkForUpdates;
  now?: () => number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const date = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));

function readCandidate(value: unknown): UpdateCandidate | undefined {
  if (!record(value) || !isReleaseVersion(value.version) || !date(value.publishedAt)
    || typeof value.downloadable !== 'boolean' || typeof value.summary !== 'string' || value.summary.length > 1000) return undefined;
  return { version: value.version, publishedAt: value.publishedAt, downloadable: value.downloadable, summary: value.summary };
}

function readResult(value: unknown, now: number): UpdateResult | undefined {
  if (!record(value) || typeof value.message !== 'string' || value.message.length > 1000
    || !date(value.checkedAt) || Date.parse(value.checkedAt) > now + 1000) return undefined;
  const { status, checkedAt, message } = value;
  if (status === 'error' || status === 'no-release') return { status, checkedAt, message };
  if (status !== 'available' && status !== 'up-to-date' && status !== 'local-newer') return undefined;
  const candidate = readCandidate(value.candidate);
  return candidate && { status, checkedAt, message, candidate };
}

function readTimestamp(value: unknown, now: number): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= now + 1000 ? value : undefined;
}

function withinWindow(timestamp: number | undefined, now: number, duration: number): boolean {
  return timestamp !== undefined && now < timestamp + duration;
}

export function createUpdateService(dependencies: UpdateServiceDependencies) {
  const now = dependencies.now ?? Date.now;
  let buildPromise: Promise<BuildInfo> | undefined;
  let memoryCache: UpdateCache | undefined;
  let pending: Promise<void> = Promise.resolve();

  // Serialize the popup's daily reservations with manual checks in the same worker.
  function enqueue<T>(action: () => Promise<T>): Promise<T> {
    const next = pending.then(action);
    pending = next.then(() => undefined, () => undefined);
    return next;
  }

  async function load(requireStorage = false): Promise<{ build: BuildInfo; cache: UpdateCache }> {
    buildPromise ??= dependencies.readBuildInfo().catch(() => undefined).then(value => normalizeBuildInfo(value, dependencies.installedVersion));
    const build = await buildPromise;
    if (memoryCache) return { build, cache: memoryCache };
    const buildKey = JSON.stringify([build.version, build.source, build.commit]);
    const cache: UpdateCache = { buildKey };
    let saved: unknown;
    try { saved = await dependencies.readCache(); }
    catch (error) { if (requireStorage) throw error; }
    if (record(saved)) {
      const time = now();
      // Daily limits belong to the installation. Version conclusions belong to a particular build.
      cache.popupAttemptAt = readTimestamp(saved.popupAttemptAt, time);
      cache.popupNoticeAt = readTimestamp(saved.popupNoticeAt, time);
      if (saved.buildKey === buildKey) {
        cache.result = readResult(saved.result, time);
        const success = readResult(saved.lastSuccess, time);
        if (success?.status !== 'error') cache.lastSuccess = success;
      }
    }
    return { build, cache };
  }

  function snapshot(build: BuildInfo, cache: UpdateCache): UpdateSnapshot {
    return { installedVersion: dependencies.installedVersion, build, result: cache.result, lastSuccess: cache.lastSuccess };
  }

  async function reservePopup(cache: UpdateCache, field: 'popupAttemptAt' | 'popupNoticeAt'): Promise<void> {
    const timestamp = now();
    await dependencies.writeCache({ ...cache, [field]: timestamp });
    cache[field] = timestamp;
    memoryCache = cache;
  }

  async function refresh(cache: UpdateCache): Promise<void> {
    let result: UpdateResult;
    try {
      result = await (dependencies.check ?? checkForUpdates)({ installedVersion: dependencies.installedVersion, now });
    } catch {
      result = { status: 'error', message: '检查更新失败，请稍后重试。', checkedAt: new Date(now()).toISOString() };
    }
    cache.result = result;
    if (result.status !== 'error') cache.lastSuccess = result;
    // A storage failure must not discard a completed check in the current worker.
    memoryCache = cache;
    await dependencies.writeCache(cache).catch(() => undefined);
  }

  async function read(): Promise<UpdateSnapshot> {
    const { build, cache } = await load();
    return snapshot(build, cache);
  }

  function check(): Promise<UpdateSnapshot> {
    const requestedAt = now();
    return enqueue(async () => {
      const { build, cache } = await load();
      const result = cache.result;
      const cooldown = result?.status === 'error' ? 15000 : 60000;
      if (!result || !withinWindow(Date.parse(result.checkedAt), requestedAt, cooldown)) await refresh(cache);
      return snapshot(build, cache);
    });
  }

  function checkOnPopup(isPopupOpen: () => Promise<boolean>): Promise<UpdateSnapshot | null> {
    return enqueue(async () => {
      const { build, cache } = await load(true);
      const time = now();
      const checkedAt = cache.result && cache.result.status !== 'error'
        ? Date.parse(cache.result.checkedAt)
        : undefined;
      if (!withinWindow(checkedAt, time, DAY_MS)) {
        if (withinWindow(cache.popupAttemptAt, time, DAY_MS)) return null;
        // Reserve before fetching so a worker restart or network failure cannot trigger another daily request.
        await reservePopup(cache, 'popupAttemptAt');
        await refresh(cache);
      }
      if (cache.result?.status !== 'available' || withinWindow(cache.popupNoticeAt, now(), DAY_MS)) return null;
      // Closing a popup during a slow check should leave the cached notice for the next opening.
      if (!await isPopupOpen()) return null;
      await reservePopup(cache, 'popupNoticeAt');
      return snapshot(build, cache);
    });
  }

  return { read, check, checkOnPopup };
}
