import { checkUpdateSnapshot, readUpdateSnapshot } from './client';
import { UPDATE_REPOSITORY, type UpdateCandidate, type UpdateResult, type UpdateSnapshot } from './types';

export interface UpdateCheckClient {
  readSnapshot(): Promise<UpdateSnapshot>;
  checkSnapshot(): Promise<UpdateSnapshot>;
}

const defaultClient: UpdateCheckClient = {
  readSnapshot: readUpdateSnapshot,
  checkSnapshot: checkUpdateSnapshot,
};

const statusLabels: Record<UpdateResult['status'], string> = {
  available: '发现新版本',
  'up-to-date': '已是最新版本',
  'local-newer': '当前版本较新',
  'unknown-build': '构建来源待核对',
  unavailable: '暂无可用安装包',
  error: '检查失败',
};

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '时间未知';
}

function safeRunUrl(candidate: UpdateCandidate): string | undefined {
  if (!Number.isSafeInteger(candidate.runId) || candidate.runId <= 0) return undefined;
  try {
    const url = new URL(candidate.runUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port
      || url.username || url.password || url.search || url.hash
      || url.pathname !== `/${UPDATE_REPOSITORY}/actions/runs/${candidate.runId}`) return undefined;
    return url.href;
  } catch { return undefined; }
}

export function mountUpdateCheck(root: HTMLElement, client: UpdateCheckClient = defaultClient): () => void {
  root.innerHTML = `<button type="button" class="secondary update-check-button" aria-controls="update-check-details">检查更新</button>
    <details class="update-details" id="update-check-details" hidden>
      <summary><span class="update-summary">版本与更新</span><span class="update-checked-at"></span></summary>
      <div class="update-content">
        <p class="update-current"></p>
        <p class="update-source"></p>
        <p class="update-message" role="status" aria-live="polite" aria-atomic="true"></p>
        <div class="update-candidate" hidden><p class="update-candidate-version"></p><p class="update-candidate-summary"></p><p class="update-expiry"></p></div>
        <p class="update-history" hidden></p>
        <a class="secondary update-download" target="_blank" rel="noopener noreferrer" hidden>前往下载</a>
        <details class="update-install"><summary>如何安装更新</summary><ol>
          <li>登录 GitHub，在构建页面的 Artifacts 中下载安装包。</li>
          <li>解压下载文件，再解压其中的扩展 ZIP，覆盖原安装目录。</li>
          <li>打开 <code>edge://extensions</code> 重新加载扩展，并刷新学习页面。</li>
        </ol></details>
      </div>
    </details>`;
  const button = root.querySelector<HTMLButtonElement>('.update-check-button')!;
  const details = root.querySelector<HTMLDetailsElement>('.update-details')!;
  const summary = root.querySelector<HTMLElement>('.update-summary')!;
  const checkedAt = root.querySelector<HTMLElement>('.update-checked-at')!;
  const current = root.querySelector<HTMLElement>('.update-current')!;
  const source = root.querySelector<HTMLElement>('.update-source')!;
  const message = root.querySelector<HTMLElement>('.update-message')!;
  const candidateBlock = root.querySelector<HTMLElement>('.update-candidate')!;
  const candidateVersion = root.querySelector<HTMLElement>('.update-candidate-version')!;
  const candidateSummary = root.querySelector<HTMLElement>('.update-candidate-summary')!;
  const expiry = root.querySelector<HTMLElement>('.update-expiry')!;
  const history = root.querySelector<HTMLElement>('.update-history')!;
  const download = root.querySelector<HTMLAnchorElement>('.update-download')!;
  let snapshot: UpdateSnapshot | undefined;
  let disposed = false;
  let busy = false;
  let operation = 0;

  function hideCandidate(): void {
    candidateBlock.hidden = true;
    download.hidden = true;
    download.removeAttribute('href');
    history.hidden = true;
  }

  function render(next: UpdateSnapshot): void {
    snapshot = next;
    details.hidden = false;
    current.textContent = `当前安装 v${next.installedVersion}`;
    const commit = next.build.commit?.slice(0, 7);
    source.textContent = next.build.source === 'github-actions'
      ? `来自 GitHub Actions${commit ? ` · 构建 ${commit}` : ''}`
      : '本地开发构建 · 更新关系需核对，请先查看远端构建信息。';
    const result = next.result;
    summary.textContent = result ? statusLabels[result.status] : '版本与更新';
    checkedAt.textContent = result ? `检查于 ${formatDate(result.checkedAt)}` : '尚未检查';
    message.textContent = result?.message ?? '点击“检查更新”获取最新构建信息。';
    message.dataset.kind = result?.status === 'error' ? 'error' : 'info';
    hideCandidate();
    if (result?.status === 'error' && next.lastSuccess) {
      history.textContent = `上次成功检查：${formatDate(next.lastSuccess.checkedAt)}（历史记录）`;
      history.hidden = false;
    }
    const candidate = result?.candidate;
    if (!candidate || result.status === 'error') return;
    candidateBlock.hidden = false;
    candidateVersion.textContent = `远端 v${candidate.version} · 构建 ${candidate.commit.slice(0, 7)}`;
    candidateSummary.textContent = candidate.summary;
    const expires = new Date(candidate.expiresAt).getTime();
    const downloadable = candidate.downloadable && Number.isFinite(expires) && expires > Date.now();
    expiry.textContent = downloadable
      ? `安装包保留至 ${formatDate(candidate.expiresAt)}`
      : '安装包已过期或不可下载，等待新的成功构建。';
    const url = safeRunUrl(candidate);
    if (!url || !downloadable || (result.status !== 'available' && result.status !== 'unknown-build')) return;
    download.textContent = result.status === 'available' ? '前往下载' : '查看构建';
    download.href = url;
    download.hidden = false;
  }

  function showError(error: unknown): void {
    details.hidden = false;
    summary.textContent = '检查失败';
    checkedAt.textContent = '';
    message.textContent = error instanceof Error ? error.message : '无法获取更新信息，请稍后重试。';
    message.dataset.kind = 'error';
    hideCandidate();
    const previous = snapshot?.result?.status !== 'error' ? snapshot?.result : snapshot?.lastSuccess;
    if (previous) {
      history.textContent = `上次成功检查：${formatDate(previous.checkedAt)}（历史记录）`;
      history.hidden = false;
    }
  }

  async function check(): Promise<void> {
    if (disposed || busy) return;
    busy = true;
    const revision = ++operation;
    button.disabled = true;
    button.textContent = '正在检查…';
    details.hidden = false;
    details.open = true;
    details.setAttribute('aria-busy', 'true');
    summary.textContent = '正在检查';
    checkedAt.textContent = '';
    message.textContent = '正在查询最新成功构建及安装包…';
    message.dataset.kind = 'info';
    hideCandidate();
    try {
      const next = await client.checkSnapshot();
      if (!disposed && revision === operation) render(next);
    } catch (error) {
      if (!disposed && revision === operation) showError(error);
    } finally {
      if (!disposed && revision === operation) {
        busy = false;
        button.disabled = false;
        button.textContent = '检查更新';
        details.removeAttribute('aria-busy');
      }
    }
  }

  const onClick = (): void => { void check(); };
  button.addEventListener('click', onClick);
  const initialRevision = operation;
  void client.readSnapshot().then((next) => {
    if (!disposed && operation === initialRevision) render(next);
  }).catch((error: unknown) => {
    if (!disposed && operation === initialRevision) showError(error);
  });

  return () => {
    disposed = true;
    operation += 1;
    button.removeEventListener('click', onClick);
  };
}
