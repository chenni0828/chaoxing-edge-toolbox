import {
  copyUiSnapshot, defaultUiSnapshot, isUiSnapshot,
  type UiPreferencePatch, type UiSnapshot, type UiUpdate, type UiWriteResult,
} from './preferences';

export interface UiPersistence {
  read(): Promise<UiSnapshot>;
  write(update: UiUpdate): Promise<UiWriteResult>;
}

/** Owns ordering only; it never measures or mutates a DOM node. */
export function createPreferenceSync(dependencies: {
  persistence: UiPersistence;
  apply(snapshot: UiSnapshot, own: boolean): void;
  error(message: string): void;
  sourceId?: string;
}) {
  const sourceId = dependencies.sourceId ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  let current = defaultUiSnapshot();
  let appliedRevision = -1;
  let operationId = 0;
  let generation = 0;
  let interacting = false;
  let unsaved = false;
  let disposed = false;
  let started = false;
  const pending = new Set<number>();
  let writes = Promise.resolve();

  function flush(): void {
    if (disposed || interacting || pending.size || unsaved || current.revision <= appliedRevision) return;
    appliedRevision = current.revision;
    dependencies.apply(copyUiSnapshot(current), current.sourceId === sourceId);
  }
  function receive(value: UiSnapshot, initial = false): void {
    if (disposed || !isUiSnapshot(value) || value.revision < current.revision) return;
    const reset = value.resetRevision > current.resetRevision;
    current = copyUiSnapshot(value);
    if (reset && !initial && value.sourceId !== sourceId) {
      generation += 1;
      pending.clear();
      unsaved = false;
      interacting = false;
      appliedRevision = current.revision;
      // An explicit reset is authoritative even in an active drag.
      dependencies.apply(copyUiSnapshot(current), false);
    } else flush();
  }
  function commit(patch: UiPreferencePatch | { reset: 'position'; position: { x: number; y: number } }): void {
    if (disposed) return;
    const id = ++operationId;
    const localGeneration = generation;
    const baseRevision = current.revision;
    const command: UiUpdate = {
      sourceId, operationId: id, baseRevision,
      ...('reset' in patch ? { reset: patch.reset, patch: { position: patch.position } } : { patch }),
    };
    pending.add(id);
    unsaved = true;
    writes = writes.then(async () => {
      if (disposed || generation !== localGeneration) return;
      try {
        // Commands queued after our own reset use its acknowledged barrier.
        command.baseRevision = Math.max(command.baseRevision, current.resetRevision);
        const result = await dependencies.persistence.write(command);
        if (disposed || generation !== localGeneration) return;
        receive(result.snapshot);
        if (generation === localGeneration && id === operationId && result.applied) unsaved = false;
      } catch {
        if (!disposed && generation === localGeneration) dependencies.error('悬浮框偏好未能保存，请稍后重试。');
      } finally {
        pending.delete(id);
        flush();
      }
    });
  }
  return {
    start() {
      if (started || disposed) return;
      started = true;
      writes = dependencies.persistence.read().then(value => receive(value, true)).catch(() => {
        if (!disposed) dependencies.error('使用默认悬浮框位置，偏好暂时无法读取。');
      });
    },
    receive: (value: UiSnapshot) => receive(value),
    commit,
    setInteracting(value: boolean) { interacting = value; if (!value) flush(); },
    dispose() { disposed = true; generation += 1; pending.clear(); },
  };
}
