import type { PlatformId } from '../shared/sites';

/** Shared metadata only: importing the catalog must never install page behavior. */
export const FEATURES = [
  {
    id: 'allow-paste',
    supportedPlatforms: ['chaoxing'],
    title: '允许粘贴',
    description: '恢复输入框、富文本与代码编辑器的文本粘贴。',
    category: '输入增强',
    defaultEnabled: true,
  },
  {
    id: 'question-extract',
    supportedPlatforms: ['chaoxing'],
    title: '题目提取',
    description: '提取题干、选项与图片链接，支持逐题预览与复制。',
    category: '学习辅助',
    defaultEnabled: true,
  },
  {
    id: 'ai-answer',
    supportedPlatforms: ['chaoxing'],
    title: 'AI 作答',
    description: '独立生成当前简答题回答并填入，由你手动发送。',
    category: '学习辅助',
    defaultEnabled: true,
  },
  {
    id: 'chapter-study',
    supportedPlatforms: ['chaoxing'],
    title: '章节学习',
    description: '独立管理视频、课件与阅读任务的章节学习流程。',
    category: '学习辅助',
    defaultEnabled: true,
  },
  {
    id: 'zjooc-study',
    supportedPlatforms: ['zjooc'],
    title: '浙学自动学习',
    description: '按目录自动播放视频并选择平台最高倍速，确认课件学习。',
    category: '学习辅助',
    defaultEnabled: false,
  },
] as const;

export type FeatureId = (typeof FEATURES)[number]['id'];

export function isFeatureId(value: unknown): value is FeatureId {
  return FEATURES.some((feature) => feature.id === value);
}

export function isFeatureSupported(id: FeatureId, platformId: PlatformId | undefined): boolean {
  return Boolean(platformId && FEATURES.find(feature => feature.id === id)?.supportedPlatforms.some(value => value === platformId));
}
