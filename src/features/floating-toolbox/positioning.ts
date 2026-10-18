import { defaultUiPreferences, type UiPreferences } from './preferences';
import { TOOLBOX_LAYOUT } from './layout';

export interface FloatingPositioner {
  placeFromPreferences(): void;
  clamp(): void;
  reset(): void;
  dispose(): void;
}

/** Normalize the fixed title anchor, never the changing workspace rectangle. */
export function installPositioning(dependencies: {
  host: HTMLElement;
  handles: HTMLElement[];
  getPreferences(): UiPreferences;
  changed(x: number, y: number): void;
  interacted(): void;
}): FloatingPositioner {
  const { host, handles } = dependencies;
  const listeners = new AbortController();
  const { signal } = listeners;
  let x = 0;
  let y = 0;
  let placed = false;
  let layoutMinimized: boolean | undefined;
  let surfaceOffset = 0;
  let disposed = false;
  let suppressClick = false;
  let drag: { id: number; handle: HTMLElement; startX: number; startY: number; x: number; y: number; moved: boolean } | undefined;

  function bounds(): { minX: number; maxX: number; minY: number; maxY: number } {
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = window.innerHeight;
    const { compactWidth, headerHeight, compactToolsHeight, viewportMargin } = TOOLBOX_LAYOUT;
    const width = Math.max(0, Math.min(compactWidth, viewportWidth - viewportMargin * 2));
    const height = headerHeight + compactToolsHeight;
    const minX = Math.min(viewportMargin, Math.max(0, (viewportWidth - width) / 2));
    const minY = Math.min(viewportMargin, Math.max(0, (viewportHeight - height) / 2));
    return {
      minX, maxX: Math.max(minX, viewportWidth - width - viewportMargin),
      minY, maxY: Math.max(minY, viewportHeight - height - viewportMargin),
    };
  }
  function layoutWorkspace(): void {
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = window.innerHeight;
    const { compactWidth, expandedWidth, headerHeight, viewportMargin } = TOOLBOX_LAYOUT;
    const minimized = dependencies.getPreferences().minimized;
    const width = Math.max(0, Math.min(minimized ? compactWidth : expandedWidth, viewportWidth - viewportMargin * 2));
    const anchorWidth = Math.max(0, Math.min(compactWidth, viewportWidth - viewportMargin * 2));
    // Choose attachment only when opening, not at every drag boundary. Keeping
    // it fixed makes the whole expanded surface follow the pointer without snapping.
    if (layoutMinimized !== minimized) {
      surfaceOffset = minimized ? 0 : Math.min(0, viewportWidth - viewportMargin - x - width);
      layoutMinimized = minimized;
    }
    surfaceOffset = Math.max(anchorWidth - width, Math.min(0, surfaceOffset));
    const margin = bounds().minX;
    const minX = margin - surfaceOffset;
    const maxX = Math.max(minX, viewportWidth - margin - width - surfaceOffset);
    x = Math.max(minX, Math.min(x, maxX));
    host.style.setProperty('left', `${x}px`, 'important');
    const below = Math.max(0, viewportHeight - y - headerHeight - viewportMargin);
    const above = Math.max(0, y - viewportMargin);
    const opensAbove = !minimized && below < 320 && above > below;
    host.dataset.placement = opensAbove ? 'above' : 'below';
    host.style.setProperty('--toolbox-surface-width', `${width}px`);
    host.style.setProperty('--toolbox-surface-offset', `${surfaceOffset}px`);
    host.style.setProperty('--toolbox-drawer-height', `${opensAbove ? above : below}px`);
  }
  function clamp(): void {
    if (disposed || !host.isConnected) return;
    if (!placed) { placeFromPreferences(); return; }
    const box = bounds();
    x = Math.max(box.minX, Math.min(x, box.maxX));
    y = Math.max(box.minY, Math.min(y, box.maxY));
    host.style.setProperty('top', `${y}px`, 'important');
    layoutWorkspace();
  }
  function placeFromPreferences(): void {
    if (disposed || !host.isConnected) return;
    const box = bounds();
    const preferences = dependencies.getPreferences();
    x = box.minX + preferences.x * (box.maxX - box.minX);
    y = box.minY + preferences.y * (box.maxY - box.minY);
    layoutMinimized = undefined;
    placed = true;
    clamp();
  }
  function commit(): void {
    const box = bounds();
    dependencies.changed(box.maxX === box.minX ? 1 : (x - box.minX) / (box.maxX - box.minX), box.maxY === box.minY ? 0 : (y - box.minY) / (box.maxY - box.minY));
  }
  function reset(): void {
    dependencies.interacted();
    const defaults = defaultUiPreferences();
    const box = bounds();
    x = box.minX + defaults.x * (box.maxX - box.minX);
    y = box.minY + defaults.y * (box.maxY - box.minY);
    layoutMinimized = undefined;
    placed = true;
    clamp();
    commit();
  }
  function finishDrag(event: PointerEvent): void {
    if (!drag || drag.id !== event.pointerId) return;
    const finished = drag;
    drag = undefined;
    if (finished.handle.hasPointerCapture(finished.id)) finished.handle.releasePointerCapture(finished.id);
    if (finished.moved) { suppressClick = true; commit(); }
  }
  for (const handle of handles) {
    handle.addEventListener('keydown', (event) => {
      if (event.target !== handle) return;
      if (event.key === 'Home') { event.preventDefault(); reset(); return; }
      const offset = event.shiftKey ? 40 : 10;
      const directions: Record<string, [number, number]> = { ArrowLeft: [-offset, 0], ArrowRight: [offset, 0], ArrowUp: [0, -offset], ArrowDown: [0, offset] };
      const direction = directions[event.key];
      if (!direction) return;
      event.preventDefault();
      dependencies.interacted();
      x += direction[0];
      y += direction[1];
      clamp();
      commit();
    }, { signal });
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button, input, a'))) return;
      suppressClick = false;
      dependencies.interacted();
      drag = { id: event.pointerId, handle, startX: event.clientX, startY: event.clientY, x, y, moved: false };
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    }, { signal });
    handle.addEventListener('pointermove', (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      x = drag.x + dx;
      y = drag.y + dy;
      clamp();
    }, { signal });
    handle.addEventListener('pointerup', finishDrag, { signal });
    handle.addEventListener('pointercancel', finishDrag, { signal });
    handle.addEventListener('lostpointercapture', () => { drag = undefined; }, { signal });
  }
  host.addEventListener('click', (event) => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { signal, capture: true });
  // A later, intentional pointerdown always releases the one-click drag guard.
  host.addEventListener('pointerdown', () => { suppressClick = false; }, { signal, capture: true });
  window.addEventListener('resize', clamp, { signal });
  const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(clamp);
  resizeObserver?.observe(host);
  return {
    placeFromPreferences, clamp, reset,
    dispose() {
      disposed = true;
      listeners.abort();
      resizeObserver?.disconnect();
      if (drag?.handle.hasPointerCapture(drag.id)) drag.handle.releasePointerCapture(drag.id);
      drag = undefined;
    },
  };
}
