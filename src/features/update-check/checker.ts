import {
  UPDATE_API_ORIGIN, UPDATE_BRANCH, UPDATE_REPOSITORY, UPDATE_WORKFLOW,
  type BuildInfo, type UpdateCandidate, type UpdateResult,
} from './types';

const MAX_RESPONSE_BYTES = 1024 * 1024;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/i;
const API_ROOT = `${UPDATE_API_ORIGIN}/repos/${UPDATE_REPOSITORY}`;

interface CheckOptions {
  installedVersion: string;
  build: BuildInfo;
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

function versionParts(version: string): number[] {
  if (typeof version !== 'string' || !/^\d{1,5}(?:\.\d{1,5}){0,3}$/.test(version)) {
    throw new CheckError('版本格式无效，无法比较更新。');
  }
  const parts = version.split('.').map(Number);
  if (parts.some(part => part > 65535)) throw new CheckError('版本格式无效，无法比较更新。');
  return parts;
}

export function compareVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

export function normalizeBuildInfo(value: unknown, installedVersion: string): BuildInfo {
  const local: BuildInfo = {
    schemaVersion: 1, version: installedVersion, source: 'local',
    builtAt: record(value) && dateValue(value.builtAt) ? value.builtAt : '',
  };
  if (!record(value) || value.schemaVersion !== 1 || value.source !== 'github-actions'
    || value.version !== installedVersion || value.repository !== UPDATE_REPOSITORY
    || value.branch !== UPDATE_BRANCH || value.workflow !== UPDATE_WORKFLOW
    || typeof value.commit !== 'string' || !COMMIT_PATTERN.test(value.commit)
    || !positiveInteger(value.runId) || !dateValue(value.builtAt)) return local;
  try { versionParts(installedVersion); } catch { return local; }
  return {
    schemaVersion: 1, version: installedVersion, source: 'github-actions', builtAt: value.builtAt,
    repository: UPDATE_REPOSITORY, branch: UPDATE_BRANCH, workflow: UPDATE_WORKFLOW,
    commit: value.commit.toLowerCase(), runId: value.runId,
  };
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

function packageVersion(value: unknown): string {
  let content = value;
  if (record(value) && value.encoding === 'base64') {
    if (value.type !== 'file' || value.path !== 'package.json' || typeof value.content !== 'string') {
      throw new CheckError('构建版本信息无效，无法确认更新。');
    }
    const encoded = value.content.replace(/\s/g, '');
    if (encoded.length > 131072 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
      throw new CheckError('构建版本信息无效，无法确认更新。');
    }
    try {
      const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
      content = parseJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch { throw new CheckError('构建版本信息无效，无法确认更新。'); }
  }
  if (!record(content) || typeof content.version !== 'string') throw new CheckError('构建缺少有效版本信息。');
  versionParts(content.version);
  return content.version;
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
  const request = async (path: string, raw = false): Promise<unknown> => {
    if (abort.signal.aborted) throw new CheckError('检查更新超时，请稍后重试。');
    const response = await fetcher(`${API_ROOT}${path}`, {
      method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: abort.signal,
      headers: { Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (!response.ok) {
      if (response.status === 403 || response.status === 429) throw new CheckError('GitHub 暂时限制了更新请求，请稍后重试。');
      if (response.status === 404) throw new CheckError('更新来源暂不可用，请稍后重试（404）。');
      throw new CheckError('无法读取更新来源，请稍后重试。');
    }
    return parseJson(await readLimited(response));
  };
  const check = async (): Promise<UpdateResult> => {
    versionParts(options.installedVersion);
    const workflowFile = UPDATE_WORKFLOW.split('/').at(-1)!;
    const runs = await request(`/actions/workflows/${workflowFile}/runs?branch=${UPDATE_BRANCH}&status=success&per_page=1`);
    if (!record(runs) || !Array.isArray(runs.workflow_runs)) throw new CheckError('工作流数据无效，无法确认更新。');
    if (runs.workflow_runs.length === 0) return result('unavailable', '暂未找到成功的构建，请稍后检查。');
    const run: unknown = runs.workflow_runs[0];
    if (!record(run) || !positiveInteger(run.id) || run.head_branch !== UPDATE_BRANCH
      || run.path !== UPDATE_WORKFLOW || !['push', 'workflow_dispatch'].includes(String(run.event))
      || run.status !== 'completed' || run.conclusion !== 'success'
      || typeof run.head_sha !== 'string' || !COMMIT_PATTERN.test(run.head_sha)
      || !record(run.repository) || run.repository.full_name !== UPDATE_REPOSITORY
      || !record(run.head_repository) || run.head_repository.full_name !== UPDATE_REPOSITORY
      || !dateValue(run.updated_at)) throw new CheckError('构建来源校验失败，无法确认更新。');
    const commit = run.head_sha.toLowerCase();
    if (record(run.head_commit) && run.head_commit.id !== undefined && run.head_commit.id !== commit) {
      throw new CheckError('构建提交信息不一致，无法确认更新。');
    }
    const artifacts = await request(`/actions/runs/${run.id}/artifacts?per_page=100`);
    if (!record(artifacts) || !Array.isArray(artifacts.artifacts)) throw new CheckError('安装包数据无效，无法确认更新。');
    const artifactName = `chaoxing-edge-toolbox-${commit}`;
    const artifact: unknown = artifacts.artifacts.find(item => record(item) && item.name === artifactName);
    if (!record(artifact)) return result('unavailable', '最新成功构建没有可下载的安装包，请等待重新构建。');
    if (artifact.expired === true || (dateValue(artifact.expires_at) && Date.parse(artifact.expires_at) <= now)) {
      return result('unavailable', '最新构建的安装包已过期，请等待重新构建。');
    }
    if (artifact.expired !== false || !dateValue(artifact.expires_at)) throw new CheckError('安装包有效期信息无效，无法确认更新。');
    if (artifact.workflow_run !== undefined && (!record(artifact.workflow_run)
      || artifact.workflow_run.id !== run.id || artifact.workflow_run.head_sha !== commit
      || artifact.workflow_run.head_branch !== UPDATE_BRANCH)) throw new CheckError('安装包与构建来源不一致，无法确认更新。');
    const version = packageVersion(await request(`/contents/package.json?ref=${commit}`, true));
    const candidate: UpdateCandidate = {
      version, commit, runId: run.id, runUrl: `https://github.com/${UPDATE_REPOSITORY}/actions/runs/${run.id}`,
      builtAt: run.updated_at, summary: textSummary(record(run.head_commit) ? run.head_commit.message : undefined),
      artifactName, expiresAt: artifact.expires_at, downloadable: true,
    };
    const build = normalizeBuildInfo(options.build, options.installedVersion);
    if (build.source !== 'github-actions') {
      return result('unknown-build', '当前是本地构建或缺少可验证的构建信息，无法判断是否落后；可查看仓库最新构建。', candidate);
    }
    const comparison = compareVersions(version, options.installedVersion);
    if (comparison > 0) return result('available', `发现新版本 v${version}，可前往 GitHub 下载。`, candidate);
    if (comparison < 0) return result('local-newer', '当前安装版本高于仓库可下载版本，无需更新。', candidate);
    if (build.commit === commit) return result('up-to-date', '当前版本与仓库最新可下载构建一致。', candidate);
    const compared = await request(`/compare/${build.commit}...${commit}?per_page=1`);
    if (!record(compared)) throw new CheckError('提交比较数据无效，无法确认更新。');
    if (compared.base_commit !== undefined && (!record(compared.base_commit) || compared.base_commit.sha !== build.commit)) {
      throw new CheckError('提交比较来源不一致，无法确认更新。');
    }
    if (compared.status === 'ahead') return result('available', '发现同版本的新构建，可前往 GitHub 查看并下载。', candidate);
    if (compared.status === 'behind') return result('local-newer', '当前构建领先于仓库可下载构建，无需更新。', candidate);
    if (compared.status === 'diverged' || compared.status === 'identical') {
      return result('unknown-build', '当前构建与仓库构建的来源不同，无法确认升级关系；请先查看构建信息。', candidate);
    }
    throw new CheckError('提交比较数据无效，无法确认更新。');
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
