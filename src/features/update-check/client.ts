import { requestExtension } from '../../core/extension-rpc';
import type { UpdateSnapshot } from './types';

export function readUpdateSnapshot(): Promise<UpdateSnapshot> {
  return requestExtension<UpdateSnapshot>('toolbox:update:read');
}

export function checkUpdateSnapshot(): Promise<UpdateSnapshot> {
  return requestExtension<UpdateSnapshot>('toolbox:update:check');
}
