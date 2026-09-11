/** Derive the stable public base URL used for Telegram webhooks. */
export function publicBaseUrl(requestUrl: string): string {
  const url = new URL(requestUrl);
  const host = url.host;
  const preview = host.match(/^id-preview--(.+?)\.(.+)$/);
  if (preview) return `https://project--${preview[1]}-dev.${preview[2]}`;
  if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) {
    const configured = process.env["PUBLIC_APP_URL"];
    return configured ?? `${url.protocol}//${host}`;
  }
  return `https://${host}`;
}

export function webhookUrlFor(requestUrl: string, botId: string): string {
  return `${publicBaseUrl(requestUrl)}/api/public/telegram/webhook/${botId}`;
}
