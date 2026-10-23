export const UPDATE_REPOSITORY = 'chenni0828/chaoxing-edge-toolbox';
export const UPDATE_WORKFLOW = '.github/workflows/build-extension.yml';
export const UPDATE_BRANCH = 'main';
export const UPDATE_API_ORIGIN = 'https://api.github.com';
export const UPDATE_STORAGE_KEY = 'toolbox.update-check.v1';

export interface BuildInfo {
  schemaVersion: 1;
  version: string;
  source: 'local' | 'github-actions';
  builtAt: string;
  repository?: string;
  branch?: string;
  commit?: string;
  runId?: number;
  workflow?: string;
}

export type UpdateStatus = 'available' | 'up-to-date' | 'local-newer' | 'unknown-build' | 'unavailable' | 'error';

export interface UpdateCandidate {
  version: string;
  commit: string;
  runId: number;
  runUrl: string;
  builtAt: string;
  summary: string;
  artifactName: string;
  expiresAt: string;
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
