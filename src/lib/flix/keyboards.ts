/** Real Telegram inline keyboards (InlineKeyboardButton + callback_data). */
import type { FlixConfig } from "./config.server";

export type InlineButton = { text: string; callback_data?: string; url?: string };
export type InlineKeyboard = { inline_keyboard: InlineButton[][] };

export function mainMenuKeyboard(config: FlixConfig): InlineKeyboard {
  const support: InlineButton = config.supportUrl
    ? { text: "💬 Support", url: config.supportUrl }
    : { text: "💬 Support", callback_data: "support" };
  return {
    inline_keyboard: [
      [
        { text: "🔎 Search Media", callback_data: "search" },
        { text: "📥 Request Media", callback_data: "request" },
      ],
      [
        { text: "🆕 Latest", callback_data: "latest" },
        { text: "🔥 Trending", callback_data: "trending" },
      ],
      [
        { text: "🏷 Categories", callback_data: "categories" },
        { text: "🌐 Languages", callback_data: "languages" },
      ],
      [
        { text: "❤️ Favorites", callback_data: "favorites" },
        { text: "🔖 Bookmarks", callback_data: "bookmarks" },
      ],
      [
        { text: "🕘 History", callback_data: "history" },
        { text: "👤 Profile", callback_data: "profile" },
      ],
      [{ text: "🆔 My ID", callback_data: "id" }, support],
    ],
  };
}

export function mediaKeyboard(
  mediaId: string,
  opts: { watchUrl?: string | null; downloadUrl?: string | null; hasFile?: boolean } = {},
): InlineKeyboard {
  const rows: InlineButton[][] = [];

  // Only real, existing links become buttons — never empty or broken ones.
  const links: InlineButton[] = [];
  if (opts.watchUrl) links.push({ text: "▶️ Watch", url: opts.watchUrl });
  if (opts.downloadUrl) links.push({ text: "⬇️ Download", url: opts.downloadUrl });
  if (links.length) rows.push(links);
  else if (opts.hasFile) rows.push([{ text: "📤 Get File", callback_data: `d:${mediaId}` }]);

  rows.push([
    { text: "❤️ Favorite", callback_data: `f:${mediaId}` },
    { text: "🔖 Bookmark", callback_data: `b:${mediaId}` },
  ]);
  rows.push([{ text: "🏠 Menu", callback_data: "menu" }]);
  return { inline_keyboard: rows };
}

export function requestModerationKeyboard(requestId: string): InlineKeyboard {
  const short = requestId;
  return {
    inline_keyboard: [
      [
        { text: "✅ Resolve", callback_data: `rr:${short}` },
        { text: "❌ Reject", callback_data: `rx:${short}` },
      ],
    ],
  };
}

export const backToMenu: InlineKeyboard = {
  inline_keyboard: [[{ text: "🏠 Menu", callback_data: "menu" }]],
};

export type ResultItem = {
  id: string;
  title: string;
  quality?: string | null;
  language?: string | null;
  year?: number | null;
  file_size?: number | null;
  media_type?: string | null;
};

function humanSize(bytes: number | null | undefined): string | null {
  if (!bytes || bytes <= 0) return null;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

/** Button label built from the metadata actually stored for the file. */
export function resultLabel(m: ResultItem): string {
  const meta = [m.quality, m.language, m.year ? String(m.year) : null, humanSize(m.file_size)]
    .filter(Boolean)
    .join(" · ");
  return `🎬 ${m.title}${meta ? ` — ${meta}` : ""}`.slice(0, 64);
}

export function resultListKeyboard(items: ResultItem[]): InlineKeyboard {
  return {
    inline_keyboard: [
      ...items.map((m) => [{ text: resultLabel(m), callback_data: `o:${m.id}` }]),
      [{ text: "🏠 Menu", callback_data: "menu" }],
    ],
  };
}
