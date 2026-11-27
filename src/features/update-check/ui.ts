import { checkPopupUpdateSnapshot, checkUpdateSnapshot, readUpdateSnapshot } from './client';
import { isReleaseVersion, releaseDownloadUrl, releasePageUrl, type UpdateResult, type UpdateSnapshot } from './types';

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
  'no-release': '暂无正式版',
  error: '检查失败',
};

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '时间未知';
}

export function mountUpdateCheck(root: HTMLElement, client: UpdateCheckClient = defaultClient): () => void {
  root.innerHTML = `<button type="button" class="secondary update-check-button" aria-controls="update-check-details">检查更新</button>
    <details class="update-details" id="update-check-details" hidden>
      <summary><span class="update-summary">版本与更新</span><span class="update-checked-at"></span></summary>
      <div class="update-content">
        <p class="update-current"></p>
        <p class="update-source"></p>
        <p class="update-message" role="status" aria-live="polite" aria-atomic="true"></p>
        <div class="update-candidate" hidden>
          <p class="update-candidate-version"></p>
          <p class="update-candidate-summary"></p>
          <p class="update-package"></p>
          <div class="update-actions">
            <a class="secondary update-download" target="_blank" rel="noopener noreferrer" hidden>下载安装包</a>
            <a class="update-release" target="_blank" rel="noopener noreferrer">查看发布说明</a>
          </div>
        </div>
        <p class="update-history" hidden></p>
        <details class="update-install"><summary>如何安装更新</summary><ol>
          <li>点击“下载安装包”，保存该正式版的扩展 ZIP。</li>
          <li>解压 ZIP，将其中的文件覆盖到原扩展目录，确保该目录直接包含 <code>manifest.json</code>。</li>
          <li>打开 <code>edge://extensions</code> 或 <code>chrome://extensions</code>，重新加载工具箱，再刷新已打开的学习页面。</li>
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
  const packageStatus = root.querySelector<HTMLElement>('.update-package')!;
  const release = root.querySelector<HTMLAnchorElement>('.update-release')!;
  const history = root.querySelector<HTMLElement>('.update-history')!;
  const download = root.querySelector<HTMLAnchorElement>('.update-download')!;
  let snapshot: UpdateSnapshot | undefined;
  let disposed = false;
  let busy = false;
  let operation = 0;

  function hideCandidate(): void {
    candidateBlock.hidden = true;
    release.removeAttribute('href');
    download.hidden = true;
    download.removeAttribute('href');
    history.hidden = true;
  }

  function render(next: UpdateSnapshot): void {
    snapshot = next;
    details.hidden = false;
    current.textContent = `当前安装 v${next.installedVersion}`;
    const commit = next.build.commit?.slice(0, 7);
    if (next.build.source === 'local') {
      source.textContent = '本地构建 · 按版本号检查更新。本地代码改动需自行核对。';
    } else {
      const origin = next.build.source === 'github-release' ? 'GitHub 正式版' : 'GitHub Actions 构建';
      source.textContent = commit ? `${origin} · ${commit}` : origin;
    }
    const result = next.result;
    summary.textContent = result ? statusLabels[result.status] : '版本与更新';
    checkedAt.textContent = result ? `检查于 ${formatDate(result.checkedAt)}` : '尚未检查';
    message.textContent = result?.message ?? '点击“检查更新”查看最新正式版。';
    message.dataset.kind = result?.status === 'error' ? 'error' : 'info';
    hideCandidate();
    if (result?.status === 'error' && next.lastSuccess) {
      history.textContent = `上次成功检查：${formatDate(next.lastSuccess.checkedAt)}（历史记录）`;
      history.hidden = false;
    }
    const candidate = result?.candidate;
    if (!candidate || result.status === 'error') return;
    const showDownload = result.status === 'available'
      || (result.status === 'up-to-date' && next.build.source !== 'github-release');
    candidateBlock.hidden = false;
    candidateVersion.textContent = `正式版 v${candidate.version} · 发布于 ${formatDate(candidate.publishedAt)}`;
    candidateSummary.textContent = candidate.summary;
    candidateSummary.hidden = !candidate.summary;
    packageStatus.textContent = candidate.downloadable ? '扩展 ZIP 已可下载。' : '扩展 ZIP 尚未就绪，可先查看发布说明。';
    packageStatus.hidden = !showDownload;
    release.href = releasePageUrl(candidate.version);
    if (showDownload && candidate.downloadable) {
      download.href = releaseDownloadUrl(candidate.version);
      download.hidden = false;
    }
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
    message.textContent = '正在查询最新正式版及安装包…';
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

export async function showPopupUpdateNotice(root: ParentNode = document): Promise<void> {
  const snapshot = await checkPopupUpdateSnapshot();
  const result = snapshot?.result;
  const candidate = result?.candidate;
  if (result?.status !== 'available' || !candidate || !isReleaseVersion(candidate.version)) return;

  const notice = root.querySelector<HTMLElement>('#update-notice');
  const label = root.querySelector<HTMLElement>('#update-hint');
  const link = root.querySelector<HTMLAnchorElement>('#update-action');
  if (!notice || !label || !link) return;
  label.textContent = `发现新版本 v${candidate.version}`;
  if (candidate.downloadable) {
    link.textContent = '下载安装包';
    link.href = releaseDownloadUrl(candidate.version);
  } else {
    link.textContent = '查看发布说明';
    link.href = releasePageUrl(candidate.version);
  }
  notice.hidden = false;
}
