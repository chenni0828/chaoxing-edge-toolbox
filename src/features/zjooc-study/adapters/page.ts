export interface ZjoocRoute { courseKey: string; chapterId: string }
export interface ZjoocChapter { key: string; title: string; projectTitle: string; element: HTMLElement; active: boolean }
export interface ZjoocResource {
  id: string;
  title: string;
  kind: 'video' | 'courseware' | 'unsupported';
  completed: boolean;
  active: boolean;
  element: HTMLElement;
}

const compactText = (node: Element | null) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

export function readZjoocRoute(href: string): ZjoocRoute | undefined {
  try {
    const url = new URL(href);
    if (url.protocol !== 'https:' || url.hostname !== 'www.zjooc.cn') return undefined;
    const match = /^\/ucenter\/student\/course\/study\/([a-f\d]{32})\/plan\/detail\/([a-f\d]{32})\/?$/i.exec(url.pathname);
    return match ? { courseKey: match[1].toLowerCase(), chapterId: match[2].toLowerCase() } : undefined;
  } catch { return undefined; }
}

/** Does not use layout rectangles, so collapsed directory descendants remain readable. */
export function isVisible(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return false;
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style?.display === 'none' || style?.visibility === 'hidden') return false;
  }
  return true;
}

export function readZjoocChapters(doc: Document): ZjoocChapter[] {
  const chapters = [...doc.querySelectorAll<HTMLElement>('#pane-Chapter .el-submenu .el-menu-item')].map((element, index) => {
    const project = element.closest('.el-submenu');
    const title = compactText(element);
    const projectTitle = compactText(project?.querySelector(':scope > .el-submenu__title') ?? null);
    return { key: `${index}:${projectTitle}:${title}`, title, projectTitle, element,
      active: element.classList.contains('is-active') || element.getAttribute('aria-current') === 'true' };
  });
  // Direct links can leave the sidebar's is-active class on the previous chapter.
  const headings = [...doc.querySelectorAll('header.el-header > ul > li')].map(compactText);
  if (headings.length >= 2) {
    const actual = chapters.find(chapter => chapter.projectTitle === headings[0] && chapter.title === headings[1]);
    for (const chapter of chapters) chapter.active = chapter === actual;
  }
  return chapters;
}

export function readZjoocResources(doc: Document): ZjoocResource[] {
  return [...doc.querySelectorAll<HTMLElement>('[role="tab"][id^="tab-"]')]
    .filter(element => /^tab-[a-f\d]{32}$/i.test(element.id) && isVisible(element))
    .map(element => ({ id: element.id.slice(4), title: compactText(element.querySelector('.label') ?? element),
      kind: element.querySelector('.icon-shipin') ? 'video' : element.querySelector('.icon-iconset0387') ? 'courseware' : 'unsupported',
      completed: Boolean(element.querySelector('i.complete')),
      active: element.getAttribute('aria-selected') === 'true' || element.classList.contains('is-active'), element }));
}

export function resourcePane(doc: Document, resource: ZjoocResource): HTMLElement | undefined {
  const control = resource.element.getAttribute('aria-controls');
  const associated = doc.getElementById(control || `pane-${resource.id}`);
  if (associated) return isVisible(associated) ? associated : undefined;
  // Element UI normally links tab and pane IDs. Some versions render a single shared content area.
  const tabs = resource.element.closest('.el-tabs');
  const panes = [...(tabs?.querySelectorAll<HTMLElement>('[role="tabpanel"], .el-tab-pane') ?? [])].filter(isVisible);
  if (panes.length === 1 && resource.active) return panes[0];
  const containers = [...doc.querySelectorAll<HTMLElement>('.contain > .contain-item')].filter(isVisible);
  if (!associated && panes.length === 0 && containers.length === 1 && resource.active) return containers[0];
  return undefined;
}

export function isZjoocLoading(doc: Document): boolean {
  return [...doc.querySelectorAll('.el-loading-mask')].some(isVisible);
}

export function coursewareButton(pane: HTMLElement): HTMLButtonElement | undefined {
  return [...pane.querySelectorAll<HTMLButtonElement>('button')].find(button => compactText(button) === '完成学习' && isVisible(button));
}

export function completionButton(pane: HTMLElement): HTMLButtonElement | undefined {
  return [...pane.querySelectorAll<HTMLButtonElement>('button')].find(button => compactText(button) === '完成学习'
    && !button.disabled && button.getAttribute('aria-disabled') !== 'true' && !button.classList.contains('is-disabled') && isVisible(button));
}

export function coursewareSubmissionBusy(pane: HTMLElement): boolean {
  return pane.getAttribute('aria-busy') === 'true'
    || [...pane.querySelectorAll('[aria-busy="true"], .is-loading, .el-icon-loading')].some(isVisible);
}

/** A settled disabled button suggests an earlier submission; only the resource marker confirms completion. */
export function coursewareButtonSubmitted(pane: HTMLElement): boolean {
  const button = coursewareButton(pane);
  return Boolean(button?.disabled && button.classList.contains('is-disabled') && !button.classList.contains('is-loading')
    && button.getAttribute('aria-busy') !== 'true' && !button.querySelector('.el-icon-loading') && !pane.querySelector('[aria-busy="true"]'));
}

export function hasCoursewareFailure(doc: Document): boolean {
  return [...doc.querySelectorAll('.el-message--error, .el-alert--error, .el-notification')]
    .some(element => isVisible(element) && Boolean(element.textContent?.trim())
      && (!element.classList.contains('el-notification') || Boolean(element.querySelector('.el-icon-error'))));
}

/** Read the same-origin PDF.js rendered DOM, never its private application object or CDN. */
export function coursewareReadiness(pane: HTMLElement): 'ready' | 'loading' | 'error' {
  const frames = [...pane.querySelectorAll<HTMLIFrameElement>('iframe')].filter(isVisible);
  // The currently supported courseware icon identifies PDF, not an arbitrary button-only task.
  // Its button can mount before the viewer iframe, so absence is a loading state.
  if (!frames.length) return 'loading';
  for (const frame of frames) {
    try {
      const source = new URL(frame.getAttribute('src') ?? '', pane.ownerDocument.location.href);
      if (source.origin !== pane.ownerDocument.location.origin || !/\/pdfjs\/web\/viewer\.html$/i.test(source.pathname)) return 'error';
      const viewer = frame.contentDocument;
      if (!viewer || viewer.readyState === 'loading' || new URL(viewer.URL).pathname !== source.pathname) return 'loading';
      const error = viewer.querySelector('#errorWrapper, .errorWrapper');
      if (error && isVisible(error) && error.textContent?.trim()) return 'error';
      const rendered = [...viewer.querySelectorAll('#viewer .page[data-page-number][data-loaded="true"]')].some(page => {
        if (!isVisible(page)) return false;
        const canvas = page.querySelector<HTMLCanvasElement>('canvas');
        const svg = page.querySelector('svg');
        return Boolean((canvas && canvas.width > 0 && canvas.height > 0) || (svg && svg.children.length));
      });
      if (!rendered) return 'loading';
    } catch { return 'error'; }
  }
  return 'ready';
}

export function readPlaybackRates(pane: HTMLElement): { rate: number; element: HTMLElement }[] {
  const rates = new Map<number, HTMLElement>();
  for (const element of pane.querySelectorAll<HTMLElement>('p, [role="menuitem"]')) {
    let menu: Element | null = element.parentElement;
    while (menu && menu !== pane && ![...menu.classList].some(name => name.startsWith('playbackratep'))) menu = menu.parentElement;
    if (!menu || menu === pane) continue;
    const text = compactText(element);
    const match = /^(\d+(?:\.\d+)?)\s*(?:倍速?|[x×])$/i.exec(text);
    const rate = text === '正常' ? 1 : match ? Number(match[1]) : NaN;
    if (Number.isFinite(rate) && rate > 0 && !rates.has(rate)) rates.set(rate, element);
  }
  return [...rates].map(([rate, element]) => ({ rate, element })).sort((a, b) => b.rate - a.rate);
}

export function showPlaybackMenu(pane: HTMLElement): void {
  const control = [...pane.querySelectorAll<HTMLElement>('[class]')].find(element => [...element.classList]
    .some(name => name.startsWith('playbackrate') && !name.startsWith('playbackratep')));
  const MouseEvent = pane.ownerDocument.defaultView?.MouseEvent;
  if (control && MouseEvent) {
    control.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    control.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  }
}
