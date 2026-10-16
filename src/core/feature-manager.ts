import type { FeatureId } from '../features/catalog';
import { isFeatureEnabled, type Settings } from '../shared/settings';

export interface FeatureController {
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

export interface PageFeature {
  id: FeatureId;
  install(win: Window): FeatureController;
}

/** Install once, toggle immediately, isolate failures, dispose listeners on teardown. */
export class FeatureManager {
  private controllers = new Map<FeatureId, FeatureController>();
  private installErrors: string[] = [];

  constructor(win: Window, features: readonly PageFeature[]) {
    for (const feature of features) {
      try {
        if (this.controllers.has(feature.id)) throw new Error('duplicate feature');
        this.controllers.set(feature.id, feature.install(win));
      } catch {
        this.installErrors.push(`${feature.id}: 初始化失败，请刷新页面。`);
      }
    }
  }

  apply(settings: Settings): { activeFeatures: FeatureId[]; errors: string[] } {
    const activeFeatures: FeatureId[] = [];
    const errors = [...this.installErrors];
    for (const [id, controller] of this.controllers) {
      try {
        const enabled = isFeatureEnabled(settings, id);
        controller.setEnabled(enabled);
        if (enabled) activeFeatures.push(id);
      } catch {
        errors.push(`${id}: 切换失败，请刷新页面。`);
      }
    }
    return { activeFeatures, errors };
  }

  dispose(): void {
    for (const controller of this.controllers.values()) {
      try { controller.dispose(); } catch { /* Teardown must continue for the other modules. */ }
    }
    this.controllers.clear();
  }
}
