import { requestExtension } from '../../core/extension-rpc';
import type { ZjoocStudyRuntime, ZjoocStudySession } from './types';

export function createZjoocStudyClient(): ZjoocStudyRuntime {
  return {
    readSession: courseKey => requestExtension<ZjoocStudySession | undefined>('toolbox:zjooc-study:session:read', { courseKey }),
    writeSession: session => requestExtension('toolbox:zjooc-study:session:write', { session }),
  };
}
