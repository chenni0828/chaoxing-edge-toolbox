import type { Point } from './geometry';

export interface DragPositioner {
  isDragging(): boolean;
  rebase(): void;
  cancel(commit?: boolean): void;
  dispose(): void;
}

/** Pointer/keyboard adapter. Geometry, preferences and business UIs live elsewhere. */
export function installDragPositioning(dependencies: {
  host: HTMLElement;
  handles: HTMLElement[];
  getPosition(): Point;
  moveTo(point: Point): void;
  begin(): void;
  end(moved: boolean): void;
  reset(): void;
}): DragPositioner {
  const win = dependencies.host.ownerDocument.defaultView!;
  const abort = new win.AbortController();
  const { signal } = abort;
  let disposed = false;
  let suppressPointer: number | undefined;
  let drag: {
    id: number; handle: HTMLElement; start: Point; last: Point; origin: Point; moved: boolean;
  } | undefined;

  function release(current: NonNullable<typeof drag>): void {
    try {
      if (current.handle.hasPointerCapture(current.id)) current.handle.releasePointerCapture(current.id);
    } catch { /* The handle or browser pointer can already be gone. */ }
  }
  function finish(commit: boolean): void {
    if (!drag) return;
    const current = drag;
    drag = undefined;
    suppressPointer = commit && current.moved ? current.id : undefined;
    release(current);
    dependencies.end(commit && current.moved);
  }
  for (const handle of dependencies.handles) {
    handle.addEventListener('pointerdown', (event) => {
      if (disposed || drag || event.button !== 0 || !event.isPrimary) return;
      if (event.target instanceof win.Element && event.target.closest('button, input, textarea, select, a, [contenteditable], [data-no-drag]')) return;
      suppressPointer = undefined;
      try { handle.setPointerCapture(event.pointerId); } catch { return; }
      dependencies.begin();
      drag = {
        id: event.pointerId, handle,
        start: { x: event.clientX, y: event.clientY },
        last: { x: event.clientX, y: event.clientY },
        origin: dependencies.getPosition(), moved: false,
      };
      event.preventDefault();
    }, { signal });
    handle.addEventListener('pointermove', (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      drag.last = { x: event.clientX, y: event.clientY };
      const dx = event.clientX - drag.start.x;
      const dy = event.clientY - drag.start.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      dependencies.moveTo({ x: drag.origin.x + dx, y: drag.origin.y + dy });
    }, { signal });
    handle.addEventListener('pointerup', (event) => {
      if (drag?.id === event.pointerId) finish(true);
    }, { signal });
    for (const type of ['pointercancel', 'lostpointercapture'] as const) {
      handle.addEventListener(type, (event) => {
        if (drag?.id === event.pointerId) finish(true);
      }, { signal });
    }
    handle.addEventListener('keydown', (event) => {
      if (event.target !== handle) return;
      if (event.key === 'Home') {
        event.preventDefault();
        dependencies.reset();
        return;
      }
      const step = event.shiftKey ? 40 : 10;
      const directions: Record<string, Point> = {
        ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 },
        ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step },
      };
      const direction = directions[event.key];
      if (!direction) return;
      event.preventDefault();
      finish(true);
      dependencies.begin();
      const point = dependencies.getPosition();
      dependencies.moveTo({ x: point.x + direction.x, y: point.y + direction.y });
      dependencies.end(true);
    }, { signal });
  }
  dependencies.host.addEventListener('pointerdown', () => { suppressPointer = undefined; }, { signal, capture: true });
  dependencies.host.addEventListener('click', (event) => {
    // Keyboard/programmatic activation has detail=0 and is never a drag click.
    if (suppressPointer === undefined || event.detail === 0 || !('pointerId' in event) || event.pointerId !== suppressPointer) return;
    suppressPointer = undefined;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { signal, capture: true });
  return {
    isDragging: () => Boolean(drag),
    rebase() {
      if (!drag) return;
      drag.start = { ...drag.last };
      drag.origin = dependencies.getPosition();
    },
    cancel(commit = false) { finish(commit); },
    dispose() {
      if (disposed) return;
      disposed = true;
      abort.abort();
      if (drag) release(drag);
      drag = undefined;
      suppressPointer = undefined;
    },
  };
}
