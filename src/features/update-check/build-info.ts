import { isReleaseVersion, UPDATE_REPOSITORY, type BuildInfo } from './types';

export { UPDATE_API_ORIGIN } from './types';

/** Build output only: never infer an official release from the local Git checkout. */
export function createBuildInfo(version: string, environment: Record<string, string | undefined>): BuildInfo {
  const local: BuildInfo = { version, source: 'local' };
  const commit = environment.TOOLBOX_BUILD_COMMIT ?? environment.GITHUB_SHA;
  const ref = environment.GITHUB_REF;
  if (environment.GITHUB_ACTIONS !== 'true'
    || environment.GITHUB_REPOSITORY !== UPDATE_REPOSITORY
    || !ref || !/^[a-f0-9]{40}$/i.test(commit ?? '')) return local;
  const normalizedCommit = commit!.toLowerCase();
  if (ref === `refs/tags/v${version}` && isReleaseVersion(version)) {
    return { version, source: 'github-release', commit: normalizedCommit };
  }
  if (ref === 'refs/heads/main') {
    return { version, source: 'github-actions', commit: normalizedCommit };
  }
  return local;
}
