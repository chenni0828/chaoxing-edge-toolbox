export interface RpcResponse<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

export async function requestExtension<T>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
  let response: RpcResponse<T> | undefined;
  try {
    response = await chrome.runtime.sendMessage({ ...payload, type }) as RpcResponse<T>;
  } catch {
    throw new Error('扩展连接已失效，请重新加载扩展并刷新页面。');
  }
  if (!response?.ok) throw new Error(response?.error ?? '扩展暂未就绪，请重试。');
  return response.value as T;
}
