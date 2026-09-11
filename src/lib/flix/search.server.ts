/** Query normalisation + real database search over media_library. */
import type { SupabaseClient } from "@supabase/supabase-js";

const FILLERS = new Set([
  "mujhe","muje","chahiye","chahiy","do","de","dedo","bhejo","bhej","send","please","plz","pls",
  "i","want","need","the","a","an","movie","film","video","dedo","dijiye","chaiye","kya","hai",
  "kahan","link","download","watch","full","hd","print","give","me","us","koi","wala","waala",
]);

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract the meaningful search query from a natural sentence. */
export function extractQuery(text: string): string {
  const normalized = normalize(text);
  if (!normalized) return "";
  const words = normalized.split(" ");
  const kept = words.filter((w) => !FILLERS.has(w));
  const candidate = (kept.length ? kept : words).join(" ").trim();
  return candidate.slice(0, 80);
}

export type LibraryRow = {
  id: string;
  title: string;
  normalized_title: string;
  media_type: string;
  language: string | null;
  genre: string | null;
  quality: string | null;
  year: number | null;
  file_size: number | null;
  description: string | null;
  caption: string | null;
  file_id: string | null;
  message_id: number | null;
  storage_channel_id: number | null;
  watch_url: string | null;
  download_url: string | null;
  views: number;
  created_at: string;
};

export function humanSize(bytes: number | null | undefined): string | null {
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

function escapeLike(value: string): string {
  return value.replace(/[%_,]/g, " ").trim();
}

/** Exact -> case-insensitive -> partial -> per-word matching, all against the database. */
export async function searchLibrary(
  db: SupabaseClient,
  botId: string,
  rawQuery: string,
  limit = 8,
): Promise<LibraryRow[]> {
  const query = extractQuery(rawQuery);
  if (!query) return [];

  const exact = await db
    .from("media_library")
    .select("*")
    .eq("bot_id", botId)
    .eq("normalized_title", query)
    .limit(limit);
  if (exact.data?.length) return exact.data as LibraryRow[];

  const safe = escapeLike(query);
  if (safe) {
    const partial = await db
      .from("media_library")
      .select("*")
      .eq("bot_id", botId)
      .or(`normalized_title.ilike.%${safe}%,title.ilike.%${safe}%,caption.ilike.%${safe}%`)
      .order("views", { ascending: false })
      .limit(limit);
    if (partial.data?.length) return partial.data as LibraryRow[];
  }

  // Word-level fallback: any significant token matches.
  const tokens = safe.split(" ").filter((t) => t.length >= 3);
  if (tokens.length) {
    const or = tokens.map((t) => `normalized_title.ilike.%${t}%`).join(",");
    const loose = await db
      .from("media_library")
      .select("*")
      .eq("bot_id", botId)
      .or(or)
      .order("views", { ascending: false })
      .limit(limit);
    return (loose.data ?? []) as LibraryRow[];
  }
  return [];
}
