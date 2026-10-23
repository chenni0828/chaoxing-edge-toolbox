import { createAiAnswerView } from './ai-answer/ui';
import { aiAnswerStyles } from './ai-answer/ui/styles';
import { isThinkLadderUrl } from './ai-answer/adapters/think-ladder';
import type { AiAnswerController } from './ai-answer/types';
import type { ApiStatus } from './api-settings/types';
import { createChapterStudyView } from './chapter-study/ui';
import { chapterStudyStyles } from './chapter-study/styles';
import { isChapterStudyUrl } from './chapter-study/adapters/chapter';
import type { StudyController } from './chapter-study/types';
import { createPageToolsView } from './page-tools/ui';
import { questionExtractStyles } from './question-extract/ui/styles';
import type { ExtractionResponse } from '../shared/messages';
import type { Settings } from './toolbox-settings/types';
import type { SettingsSection } from '../platform/settings-navigation';
import type { ToolboxView } from './floating-toolbox/preferences';
import { pageToolsTitle, type PageContext } from '../platform/page-context';
import { getPlatform, type PlatformId } from '../shared/sites';
import { createZjoocStudyView } from './zjooc-study/ui';
import { zjoocStudyStyles } from './zjooc-study/styles';
import type { ZjoocStudyController } from './zjooc-study/types';

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
  ai?: AiAnswerController;
  study?: StudyController;
  zjoocStudy?: ZjoocStudyController;
}

/** Register feature workspaces here; the floating shell only reads descriptors. */
export const WORKSPACES: ReadonlyArray<{
  id: ToolboxView;
  platform: PlatformId;
  title: string;
  titleOnPage?(context: PageContext): string;
  icon: 'extract' | 'ai' | 'study';
  defaultOnPage?(url: string): boolean;
  create(context: WorkspaceContext): WorkspaceView;
}> = [
  { id: 'page-tools', platform: 'chaoxing', title: '页面工具', titleOnPage: pageToolsTitle, icon: 'extract', create: createPageToolsView },
  { id: 'answer', platform: 'chaoxing', title: '答题', icon: 'ai', defaultOnPage: isThinkLadderUrl, create(context) {
    if (!context.ai) throw new Error('Missing Chaoxing answer controller');
    const view = createAiAnswerView({ ...context, ai: context.ai, supported: isThinkLadderUrl(location.href) });
    return { element: view.element, update: view.update, refresh: view.refreshApiStatus, dispose: view.dispose };
  } },
  { id: 'chapter-study', platform: 'chaoxing', title: '章节学习', icon: 'study', defaultOnPage: isChapterStudyUrl, create(context) {
    if (!context.study) throw new Error('Missing Chaoxing study controller');
    return createChapterStudyView({ ...context, study: context.study });
  } },
  { id: 'zjooc-study', platform: 'zjooc', title: '章节学习', icon: 'study', create: createZjoocStudyView },
];

export function getWorkspaces(platformId?: PlatformId): typeof WORKSPACES {
  return WORKSPACES.filter(workspace => workspace.platform === platformId);
}

export function getDefaultWorkspace(url: string): ToolboxView {
  const workspaces = getWorkspaces(getPlatform(url)?.id);
  return workspaces.find((workspace) => workspace.defaultOnPage?.(url))?.id ?? workspaces[0]?.id ?? 'page-tools';
}

export const workspaceStyles = [questionExtractStyles, aiAnswerStyles, chapterStudyStyles, zjoocStudyStyles].join('\n');
