import {
  UPDATE_API_ORIGIN, UPDATE_REPOSITORY,
  isReleaseVersion, releaseDownloadUrl, releasePageUrl,
  type BuildInfo, type UpdateCandidate, type UpdateResult,
} from './types';

const MAX_RESPONSE_BYTES = 1024 * 1024;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/i;
const API_ROOT = `${UPDATE_API_ORIGIN}/repos/${UPDATE_REPOSITORY}`;

interface CheckOptions {
  installedVersion: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  timeoutMs?: number;
}

class CheckError extends Error {}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function dateValue(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
}

export function compareVersions(a: string, b: string): number {
  if (!isReleaseVersion(a) || !isReleaseVersion(b)) throw new CheckError('版本格式无效，无法比较更新。');
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

export function normalizeBuildInfo(value: unknown, installedVersion: string): BuildInfo {
  const local: BuildInfo = { version: installedVersion, source: 'local' };
  if (!record(value) || value.version !== installedVersion
    || (value.source !== 'github-release' && value.source !== 'github-actions')
    || typeof value.commit !== 'string' || !COMMIT_PATTERN.test(value.commit)) return local;
  return { version: installedVersion, source: value.source, commit: value.commit.toLowerCase() };
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text) as unknown; } catch { throw new CheckError('更新来源返回的数据格式无效，请稍后重试。'); }
}

async function readLimited(response: Response): Promise<string> {
  const size = response.headers.get('content-length');
  if (size && Number(size) > MAX_RESPONSE_BYTES) throw new CheckError('更新数据过大，已停止检查。');
  if (!response.body) throw new CheckError('更新来源返回了空数据，请稍后重试。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new CheckError('更新数据过大，已停止检查。');
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

function textSummary(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 240)
    : '';
}

export async function checkForUpdates(options: CheckOptions): Promise<UpdateResult> {
  const now = options.now?.() ?? Date.now();
  const checkedAt = new Date(Number.isFinite(now) ? now : Date.now()).toISOString();
  const abort = new AbortController();
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(1, Math.min(options.timeoutMs!, 20000)) : 15000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fetcher = options.fetch ?? globalThis.fetch;
  const result = (status: UpdateResult['status'], message: string, candidate?: UpdateCandidate): UpdateResult => (
    candidate ? { status, message, checkedAt, candidate } : { status, message, checkedAt }
  );
  const check = async (): Promise<UpdateResult> => {
    if (!isReleaseVersion(options.installedVersion)) throw new CheckError('安装版本格式无效，无法比较更新。');
    const response = await fetcher(`${API_ROOT}/releases/latest`, {
      method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: abort.signal,
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (response.status === 404) return result('no-release', '暂未找到已发布的正式版。');
    if (!response.ok) {
      if (response.status === 403 || response.status === 429) throw new CheckError('GitHub 暂时限制了更新请求，请稍后重试。');
      throw new CheckError('无法读取更新来源，请稍后重试。');
    }
    const release = parseJson(await readLimited(response));
    if (!record(release)) throw new CheckError('正式版发布信息无效，无法确认更新。');
    if (release.draft || release.prerelease) return result('no-release', '暂未找到已发布的正式版。');
    const version = typeof release.tag_name === 'string' && release.tag_name.startsWith('v') ? release.tag_name.slice(1) : '';
    if (!isReleaseVersion(version)
      || release.html_url !== releasePageUrl(version) || !dateValue(release.published_at) || !Array.isArray(release.assets)) {
      throw new CheckError('正式版的标签、来源或发布信息无效，无法确认更新。');
    }
    const assetName = `chaoxing-edge-toolbox-${version}.zip`;
    const candidate: UpdateCandidate = {
      version, publishedAt: release.published_at, summary: textSummary(release.body),
      downloadable: release.assets.some((asset: unknown) => record(asset) && asset.name === assetName
        && asset.state === 'uploaded' && positiveInteger(asset.size) && asset.browser_download_url === releaseDownloadUrl(version)),
    };
    const comparison = compareVersions(version, options.installedVersion);
    if (comparison > 0) return result('available', `发现新正式版 v${version}。`, candidate);
    if (comparison < 0) return result('local-newer', '当前安装版本高于最新正式版。', candidate);
    return result('up-to-date', '当前安装版本号与最新正式版一致。', candidate);
  };
  try {
    return await Promise.race([
      check(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          abort.abort();
          reject(new CheckError('检查更新超时，请稍后重试。'));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    return result('error', error instanceof CheckError ? error.message : '检查更新失败，请检查网络后重试。');
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    abort.abort();
  }
}
