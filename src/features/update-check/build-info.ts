import { UPDATE_BRANCH, UPDATE_REPOSITORY, UPDATE_WORKFLOW, type BuildInfo } from './types';

export { UPDATE_API_ORIGIN } from './types';

/** Build output only: never infer an official release from the local Git checkout. */
export function createBuildInfo(version: string, environment: Record<string, string | undefined>, builtAt = new Date().toISOString()): BuildInfo {
  const local: BuildInfo = { schemaVersion: 1, version, source: 'local', builtAt };
  const runId = Number(environment.GITHUB_RUN_ID);
  if (environment.GITHUB_ACTIONS !== 'true'
    || environment.GITHUB_REPOSITORY !== UPDATE_REPOSITORY
    || environment.GITHUB_REF !== `refs/heads/${UPDATE_BRANCH}`
    || environment.GITHUB_WORKFLOW_REF !== `${UPDATE_REPOSITORY}/${UPDATE_WORKFLOW}@refs/heads/${UPDATE_BRANCH}`
    || !/^[a-f0-9]{40}$/.test(environment.GITHUB_SHA ?? '')
    || !Number.isSafeInteger(runId) || runId <= 0) return local;
  return {
    ...local,
    source: 'github-actions',
    repository: UPDATE_REPOSITORY,
    branch: UPDATE_BRANCH,
    workflow: UPDATE_WORKFLOW,
    commit: environment.GITHUB_SHA,
    runId,
  };
}
