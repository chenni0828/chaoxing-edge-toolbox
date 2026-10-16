/** Shared metadata only: importing the catalog must never install page behavior. */
export const FEATURES = [
  {
    id: 'allow-paste',
    title: '允许粘贴',
    description: '恢复输入框、富文本与代码编辑器的文本粘贴。',
    category: '输入增强',
    defaultEnabled: true,
  },
  {
    id: 'question-extract',
    title: '题目提取',
    description: '提取题干、选项与图片链接，支持逐题预览与复制。',
    category: '学习辅助',
    defaultEnabled: true,
  },
  {
    id: 'ai-answer',
    title: 'AI 作答',
    description: '独立生成当前简答题回答并填入，由你手动发送。',
    category: '学习辅助',
    defaultEnabled: true,
  },
] as const;

export type FeatureId = (typeof FEATURES)[number]['id'];

export function isFeatureId(value: unknown): value is FeatureId {
  return FEATURES.some((feature) => feature.id === value);
}
