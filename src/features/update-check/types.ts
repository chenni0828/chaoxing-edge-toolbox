export const UPDATE_REPOSITORY = 'chenni0828/chaoxing-edge-toolbox';
export const UPDATE_API_ORIGIN = 'https://api.github.com';
export const UPDATE_STORAGE_KEY = 'toolbox.update-check.v2';

export function isReleaseVersion(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,4})(?:\.(?:0|[1-9]\d{0,4})){0,3}$/.test(value)) return false;
  const parts = value.split('.').map(Number);
  return parts.every(part => part <= 65535) && parts.some(part => part > 0);
}

export function releasePageUrl(version: string): string {
  if (!isReleaseVersion(version)) throw new Error('正式版版本号无效。');
  return `https://github.com/${UPDATE_REPOSITORY}/releases/tag/v${version}`;
}

export function releaseDownloadUrl(version: string): string {
  if (!isReleaseVersion(version)) throw new Error('正式版版本号无效。');
  return `https://github.com/${UPDATE_REPOSITORY}/releases/download/v${version}/chaoxing-edge-toolbox-${version}.zip`;
}

export interface BuildInfo {
  version: string;
  source: 'local' | 'github-actions' | 'github-release';
  commit?: string;
}

export type UpdateStatus = 'available' | 'up-to-date' | 'local-newer' | 'no-release' | 'error';

export interface UpdateCandidate {
  version: string;
  publishedAt: string;
  summary: string;
  downloadable: boolean;
}

export interface UpdateResult {
  status: UpdateStatus;
  message: string;
  checkedAt: string;
  candidate?: UpdateCandidate;
}

export interface UpdateSnapshot {
  installedVersion: string;
  build: BuildInfo;
  result?: UpdateResult;
  lastSuccess?: UpdateResult;
}
