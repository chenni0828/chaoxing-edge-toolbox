/** Single source for both manifest matches and popup host detection. */
export const SUPPORTED_DOMAINS = ['chaoxing.com'] as const;
export const SITE_MATCHES = SUPPORTED_DOMAINS.flatMap((domain) => [
  `https://*.${domain}/*`,
  `http://*.${domain}/*`,
]);

export function isSupportedUrl(value?: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol)
      && SUPPORTED_DOMAINS.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}
