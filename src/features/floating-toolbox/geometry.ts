import type { LegacyUiPreferences } from './preferences';
import { TOOLBOX_LAYOUT } from './layout';

export interface Point { x: number; y: number }
export interface Size { width: number; height: number }
export interface Viewport extends Size { left?: number; top?: number }

/** Position is the visible card origin, normalized independently of its size. */
export function viewportArea(viewport: Viewport) {
  const width = Math.max(0, viewport.width);
  const height = Math.max(0, viewport.height);
  const marginX = Math.min(TOOLBOX_LAYOUT.viewportMargin, width / 2);
  const marginY = Math.min(TOOLBOX_LAYOUT.viewportMargin, height / 2);
  return {
    left: (viewport.left ?? 0) + marginX,
    top: (viewport.top ?? 0) + marginY,
    width: Math.max(0, width - marginX * 2),
    height: Math.max(0, height - marginY * 2),
  };
}

export function clampPoint(point: Point, size: Size, viewport: Viewport): Point {
  const area = viewportArea(viewport);
  return {
    x: Math.max(area.left, Math.min(point.x, area.left + Math.max(0, area.width - size.width))),
    y: Math.max(area.top, Math.min(point.y, area.top + Math.max(0, area.height - size.height))),
  };
}

export function decodePosition(position: Point, viewport: Viewport): Point {
  const area = viewportArea(viewport);
  return { x: area.left + position.x * area.width, y: area.top + position.y * area.height };
}

export function encodePosition(position: Point, viewport: Viewport): Point {
  const area = viewportArea(viewport);
  const unit = (value: number) => Math.max(0, Math.min(1, value));
  return {
    x: area.width === 0 ? 0 : unit((position.x - area.left) / area.width),
    y: area.height === 0 ? 0 : unit((position.y - area.top) / area.height),
  };
}

/** Legacy records only contained the compact host anchor, never surfaceOffset. */
export function migrateLegacyPosition(preferences: LegacyUiPreferences, viewport: Viewport): Point {
  const area = viewportArea(viewport);
  const compactWidth = Math.min(TOOLBOX_LAYOUT.compactWidth, area.width);
  const compactHeight = TOOLBOX_LAYOUT.headerHeight + TOOLBOX_LAYOUT.compactToolsHeight;
  return {
    x: area.left + preferences.x * Math.max(0, area.width - compactWidth),
    y: area.top + preferences.y * Math.max(0, area.height - compactHeight),
  };
}
