import { createAiAnswerView } from './ai-answer/ui';
import { aiAnswerStyles } from './ai-answer/ui/styles';
import { isThinkLadderUrl } from './ai-answer/adapters/think-ladder';
import type { AiAnswerController } from './ai-answer/types';
import type { ApiStatus } from './api-settings/types';
import { createPageToolsView } from './page-tools/ui';
import { questionExtractStyles } from './question-extract/ui/styles';
import type { ExtractionResponse } from '../shared/messages';
import type { Settings } from './toolbox-settings/types';
import type { SettingsSection } from '../platform/settings-navigation';
import type { ToolboxView } from './floating-toolbox/preferences';
import { pageToolsTitle, type PageContext } from '../platform/page-context';

export interface WorkspaceView {
  element: HTMLElement;
  update(settings: Settings | undefined, saving: boolean): void;
  refresh?(): void;
  updatePage?(context: PageContext): void;
  dispose(): void;
}

export interface WorkspaceContext {
  getSettings(): Settings | undefined;
  saveSettings(update: (current: Settings) => Settings): Promise<void>;
  extract(): Promise<ExtractionResponse>;
  openSettings(section?: SettingsSection): Promise<void>;
  getApiStatus(): Promise<ApiStatus>;
  ai: AiAnswerController;
}

/** Register feature workspaces here; the floating shell only reads descriptors. */
export const WORKSPACES: ReadonlyArray<{
  id: ToolboxView;
  title: string;
  titleOnPage?(context: PageContext): string;
  icon: 'extract' | 'ai';
  defaultOnPage?(url: string): boolean;
  create(context: WorkspaceContext): WorkspaceView;
}> = [
  { id: 'page-tools', title: '页面工具', titleOnPage: pageToolsTitle, icon: 'extract', create: createPageToolsView },
  { id: 'answer', title: '答题', icon: 'ai', defaultOnPage: isThinkLadderUrl, create(context) {
    const view = createAiAnswerView({ ...context, supported: isThinkLadderUrl(location.href) });
    return { element: view.element, update: view.update, refresh: view.refreshApiStatus, dispose: view.dispose };
  } },
];

export function getDefaultWorkspace(url: string): ToolboxView {
  return WORKSPACES.find((workspace) => workspace.defaultOnPage?.(url))?.id ?? 'page-tools';
}

export const workspaceStyles = [questionExtractStyles, aiAnswerStyles].join('\n');
