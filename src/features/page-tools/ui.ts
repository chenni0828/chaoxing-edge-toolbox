import { pageToolsTitle, type PageContext } from '../../platform/page-context';
import { createAllowPasteView } from '../allow-paste/ui';
import { createQuestionExtractView } from '../question-extract/ui';
import type { Settings } from '../toolbox-settings/types';
import type { WorkspaceContext, WorkspaceView } from '../workspace-registry';

/** A scene workspace composes feature views without owning their behavior or drafts. */
export function createPageToolsView(dependencies: WorkspaceContext): WorkspaceView {
  const root = document.createElement('section');
  root.className = 'page-tools-workspace';
  const paste = createAllowPasteView(dependencies);
  const extraction = createQuestionExtractView(dependencies);
  root.append(paste.element, extraction.element);
  return {
    element: root,
    update(settings: Settings | undefined, saving: boolean): void {
      paste.update(settings, saving);
      extraction.update(settings, saving);
    },
    updatePage(context: PageContext): void { root.setAttribute('aria-label', `${pageToolsTitle(context)}辅助工具`); },
    dispose(): void { paste.dispose(); extraction.dispose(); },
  };
}
