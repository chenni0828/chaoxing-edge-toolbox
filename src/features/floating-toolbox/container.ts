import { clampPoint, decodePosition, encodePosition, migrateLegacyPosition, viewportArea, type Point, type Viewport } from './geometry';
import { TOOLBOX_LAYOUT } from './layout';
import { installDragPositioning } from './positioning';
import { createPreferenceSync, type UiPersistence } from './preference-sync';
import { defaultUiPreferences, type UiPreferences, type UiSnapshot } from './preferences';

export interface FloatingContainer {
  setMode(minimized: boolean): void;
  applySnapshot(snapshot: UiSnapshot): void;
  resetPosition(): void;
  layout(): void;
  getState(): { preferences: UiPreferences; dragging: boolean };
  dispose(): void;
}

/** Shared browser container. Workspace views never receive this controller. */
export function installFloatingContainer(dependencies: {
  host: HTMLElement;
  surface: HTMLElement;
  handles: HTMLElement[];
  content: HTMLElement;
  viewport?(): Viewport;
  persistence: UiPersistence;
  onModeChange(minimized: boolean): void;
  onError(message: string): void;
}): FloatingContainer {
  const { host, surface } = dependencies;
  const win = host.ownerDocument.defaultView!;
  const abort = new win.AbortController();
  let preferences = defaultUiPreferences();
  let point: Point = { x: 0, y: 0 };
  let disposed = false;
  let placed = false;
  let frozenHeight: number | undefined;
  let pendingPlacement: Point | undefined;
  let pendingLegacy: UiSnapshot['legacy'];
  let changing = false;
  let lastViewport = '';
  let frame: number | undefined;

  function viewport(): Viewport {
    return dependencies.viewport?.() ?? {
      width: win.visualViewport?.width ?? (host.ownerDocument.documentElement.clientWidth || win.innerWidth),
      height: win.visualViewport?.height ?? win.innerHeight,
      left: win.visualViewport?.offsetLeft ?? 0,
      top: win.visualViewport?.offsetTop ?? 0,
    };
  }
  function style(name: string, value: string): void {
    if (host.style.getPropertyValue(name) !== value) host.style.setProperty(name, value, 'important');
  }
  function size() {
    const rect = surface.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }
  function setPoint(next: Point): void {
    point = next;
    style('left', String(point.x) + 'px');
    style('top', String(point.y) + 'px');
  }
  function availableHeight(view: Viewport): void {
    const area = viewportArea(view);
    style('--toolbox-max-height', String(Math.max(0, area.top + area.height - point.y)) + 'px');
  }
  function width(view: Viewport): void {
    const area = viewportArea(view);
    style('width', String(Math.min(preferences.minimized ? TOOLBOX_LAYOUT.compactWidth : TOOLBOX_LAYOUT.expandedWidth, area.width)) + 'px');
  }
  function rememberPosition(): void {
    preferences = { ...preferences, ...encodePosition(point, viewport()) };
  }
  function place(target: Point, sizing: 'fit' | 'restore' | 'preserve'): void {
    const view = viewport();
    width(view);
    if (sizing !== 'preserve') style('--toolbox-max-height', String(viewportArea(view).height) + 'px');
    const measured = size();
    // Restoring v2 must retain the saved origin even if content has grown since saving.
    const bounds = sizing === 'restore'
      ? { width: measured.width, height: Math.min(measured.height, TOOLBOX_LAYOUT.headerHeight + TOOLBOX_LAYOUT.compactToolsHeight) }
      : measured;
    setPoint(sizing === 'preserve' ? target : clampPoint(target, bounds, view));
    availableHeight(view);
    rememberPosition();
  }

  const sync = createPreferenceSync({
    persistence: dependencies.persistence,
    error: dependencies.onError,
    apply(snapshot, own) {
      if (disposed) return;
      if (!own) {
        changing = true;
        positioner.cancel(false);
        changing = false;
      }
      const modeChanged = preferences.minimized !== snapshot.preferences.minimized;
      preferences = { ...snapshot.preferences };
      host.dataset.minimized = String(preferences.minimized);
      if (modeChanged) dependencies.onModeChange(preferences.minimized);
      if (own && placed) {
        // Acknowledgement must not re-position a card that has since grown or moved.
        place(point, modeChanged && !preferences.minimized ? 'fit' : 'preserve');
        return;
      }
      pendingLegacy = snapshot.legacy;
      pendingPlacement = snapshot.preferences;
      placed = false;
      layout();
    },
  });

  function layout(): void {
    if (disposed || !host.isConnected) return;
    const view = viewport();
    const signature = JSON.stringify(view);
    const viewportChanged = lastViewport !== '' && lastViewport !== signature;
    lastViewport = signature;
    if (!placed) {
      const target = pendingLegacy
        ? migrateLegacyPosition(pendingLegacy, view)
        : decodePosition(pendingPlacement ?? preferences, view);
      placed = true;
      place(target, pendingLegacy ? 'fit' : 'restore');
      if (pendingLegacy) sync.commit({ position: encodePosition(point, view) });
      pendingLegacy = undefined;
      pendingPlacement = undefined;
    } else if (viewportChanged) {
      width(view);
      if (frozenHeight !== undefined) {
        frozenHeight = Math.min(frozenHeight, viewportArea(view).height);
        style('--toolbox-drag-height', String(frozenHeight) + 'px');
      }
      place(point, frozenHeight !== undefined ? 'fit' : 'restore');
      positioner.rebase();
    } else {
      width(view);
      availableHeight(view);
    }
  }

  const positioner = installDragPositioning({
    host, handles: dependencies.handles,
    getPosition: () => ({ ...point }),
    begin() {
      layout();
      sync.setInteracting(true);
      frozenHeight = size().height;
      style('--toolbox-drag-height', String(frozenHeight) + 'px');
    },
    moveTo(target) {
      setPoint(clampPoint(target, size(), viewport()));
      availableHeight(viewport());
    },
    end(moved) {
      frozenHeight = undefined;
      host.style.removeProperty('--toolbox-drag-height');
      availableHeight(viewport());
      if (moved) {
        rememberPosition();
        sync.commit({ position: { x: preferences.x, y: preferences.y } });
      }
      if (!changing) sync.setInteracting(false);
    },
    reset: resetPosition,
  });

  function resetPosition(): void {
    if (disposed) return;
    // Hold remote updates while ending the old gesture and rendering the reset.
    changing = true;
    positioner.cancel(false);
    changing = false;
    sync.setInteracting(true);
    preferences = { ...defaultUiPreferences(), minimized: preferences.minimized };
    pendingLegacy = undefined;
    pendingPlacement = undefined;
    placed = host.isConnected;
    place(decodePosition(preferences, viewport()), 'fit');
    sync.commit({ reset: 'position', position: { x: preferences.x, y: preferences.y } });
    sync.setInteracting(false);
  }
  function scheduleLayout(): void {
    if (disposed || frame !== undefined) return;
    frame = win.requestAnimationFrame(() => { frame = undefined; layout(); });
  }
  const resize = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(scheduleLayout) : undefined;
  resize?.observe(surface);
  resize?.observe(dependencies.content);
  const mutation = new win.MutationObserver(scheduleLayout);
  mutation.observe(dependencies.content, { childList: true, subtree: true, characterData: true });
  win.addEventListener('resize', layout, { signal: abort.signal });
  win.visualViewport?.addEventListener('resize', layout, { signal: abort.signal });
  win.visualViewport?.addEventListener('scroll', layout, { signal: abort.signal });

  host.dataset.minimized = String(preferences.minimized);
  dependencies.onModeChange(preferences.minimized);
  layout();
  sync.start();
  return {
    setMode(minimized) {
      if (disposed || preferences.minimized === minimized) return;
      changing = true;
      positioner.cancel(false);
      changing = false;
      sync.setInteracting(true);
      pendingLegacy = undefined;
      pendingPlacement = undefined;
      preferences = { ...preferences, minimized };
      host.dataset.minimized = String(minimized);
      dependencies.onModeChange(minimized);
      if (!placed) layout();
      else place(point, minimized ? 'preserve' : 'fit');
      rememberPosition();
      sync.commit({ position: { x: preferences.x, y: preferences.y }, minimized });
      sync.setInteracting(false);
    },
    applySnapshot: sync.receive,
    resetPosition,
    layout,
    getState: () => ({ preferences: { ...preferences }, dragging: positioner.isDragging() }),
    dispose() {
      if (disposed) return;
      disposed = true;
      positioner.dispose();
      sync.dispose();
      host.style.removeProperty('--toolbox-drag-height');
      abort.abort();
      resize?.disconnect();
      mutation.disconnect();
      if (frame !== undefined) win.cancelAnimationFrame(frame);
    },
  };
}
