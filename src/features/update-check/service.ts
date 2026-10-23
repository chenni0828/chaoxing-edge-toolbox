import { checkForUpdates, normalizeBuildInfo } from './checker';
import { UPDATE_REPOSITORY, type BuildInfo, type UpdateCandidate, type UpdateResult, type UpdateSnapshot } from './types';

interface UpdateCache {
  buildKey: string;
  result?: UpdateResult;
  lastSuccess?: UpdateResult;
}

interface UpdateServiceDependencies {
  installedVersion: string;
  readBuildInfo(): Promise<unknown>;
  readCache(): Promise<unknown>;
  writeCache(cache: UpdateCache): Promise<void>;
  check?: typeof checkForUpdates;
  now?: () => number;
}

const statuses = new Set(['available', 'up-to-date', 'local-newer', 'unknown-build', 'unavailable', 'error']);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const date = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));

function readCandidate(value: unknown): UpdateCandidate | undefined {
  if (!record(value) || typeof value.version !== 'string' || !/^\d+(?:\.\d+){0,3}$/.test(value.version)
    || typeof value.commit !== 'string' || !/^[a-f0-9]{40}$/.test(value.commit)
    || !Number.isSafeInteger(value.runId) || (value.runId as number) <= 0
    || value.runUrl !== `https://github.com/${UPDATE_REPOSITORY}/actions/runs/${value.runId}`
    || !date(value.builtAt) || !date(value.expiresAt) || typeof value.downloadable !== 'boolean'
    || typeof value.summary !== 'string' || value.summary.length > 1000
    || value.artifactName !== `chaoxing-edge-toolbox-${value.commit}`) return undefined;
  return {
    version: value.version, commit: value.commit, runId: value.runId as number, runUrl: value.runUrl,
    builtAt: value.builtAt, expiresAt: value.expiresAt, downloadable: value.downloadable,
    summary: value.summary, artifactName: value.artifactName,
  };
}

function readResult(value: unknown, now: number): UpdateResult | undefined {
  if (!record(value) || typeof value.status !== 'string' || !statuses.has(value.status)
    || typeof value.message !== 'string' || value.message.length > 1000 || !date(value.checkedAt)
    || Date.parse(value.checkedAt) > now + 1000) return undefined;
  const candidate = value.candidate === undefined ? undefined : readCandidate(value.candidate);
  if (value.candidate !== undefined && !candidate) return undefined;
  const result: UpdateResult = { status: value.status as UpdateResult['status'], message: value.message, checkedAt: value.checkedAt, candidate };
  if (candidate?.downloadable && Date.parse(candidate.expiresAt) <= now) {
    return { ...result, status: 'unavailable', message: '构建包已过期，请前往仓库重新运行构建。', candidate: { ...candidate, downloadable: false } };
  }
  return result;
}

export function createUpdateService(dependencies: UpdateServiceDependencies): { read(): Promise<UpdateSnapshot>; check(): Promise<UpdateSnapshot> } {
  const now = dependencies.now ?? Date.now;
  let buildPromise: Promise<BuildInfo> | undefined;
  let inFlight: Promise<UpdateSnapshot> | undefined;
  let memoryCache: UpdateCache | undefined;

  function getBuild(): Promise<BuildInfo> {
    buildPromise ??= dependencies.readBuildInfo().catch(() => undefined).then(value => normalizeBuildInfo(value, dependencies.installedVersion));
    return buildPromise;
  }

  function buildKey(build: BuildInfo): string {
    return JSON.stringify([build.version, build.source, build.commit, build.runId, build.builtAt]);
  }

  async function read(): Promise<UpdateSnapshot> {
    const build = await getBuild();
    const cached = memoryCache ?? await dependencies.readCache().catch(() => undefined);
    const snapshot: UpdateSnapshot = { installedVersion: dependencies.installedVersion, build };
    if (record(cached) && cached.buildKey === buildKey(build)) {
      snapshot.result = readResult(cached.result, now());
      const success = readResult(cached.lastSuccess, now());
      if (success?.status !== 'error') snapshot.lastSuccess = success;
    }
    return snapshot;
  }

  function check(): Promise<UpdateSnapshot> {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const snapshot = await read();
      const elapsed = snapshot.result ? now() - Date.parse(snapshot.result.checkedAt) : Infinity;
      const cooldown = snapshot.result?.status === 'error' ? 15000 : 60000;
      if (elapsed >= 0 && elapsed < cooldown) return snapshot;
      let result: UpdateResult;
      try {
        result = await (dependencies.check ?? checkForUpdates)({ installedVersion: snapshot.installedVersion, build: snapshot.build, now });
      } catch {
        result = { status: 'error', message: '检查更新失败，请稍后重试。', checkedAt: new Date(now()).toISOString() };
      }
      const lastSuccess = result.status === 'error' ? snapshot.lastSuccess : result;
      memoryCache = { buildKey: buildKey(snapshot.build), result, lastSuccess };
      // A storage failure must not discard a completed check; the current worker keeps its cooldown.
      await dependencies.writeCache(memoryCache).catch(() => undefined);
      return { ...snapshot, result, lastSuccess };
    })().finally(() => { inFlight = undefined; });
    return inFlight;
  }

  return { read, check };
}
