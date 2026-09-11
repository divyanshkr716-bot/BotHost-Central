/**
 * AES-256-GCM encryption for bot credentials at rest.
 * The key comes from the server-only BOT_CREDENTIAL_ENCRYPTION_KEY secret.
 * Never log plaintext, keys, or ciphertext material.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromB64(value: string): Uint8Array<ArrayBuffer> {
  const bin = atob(value);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getKey(): Promise<CryptoKey> {
  const raw = process.env["BOT_CREDENTIAL_ENCRYPTION_KEY"];
  if (!raw) throw new Error("Encryption key is not configured on the server");
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(raw));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plaintext: string): Promise<{ ciphertext: string; iv: string }> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const buf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  return { ciphertext: toB64(new Uint8Array(buf)), iv: toB64(iv) };
}

export async function decryptSecret(ciphertext: string, iv: string): Promise<string> {
  const key = await getKey();
  const buf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(iv) },
    key,
    fromB64(ciphertext),
  );
  return dec.decode(buf);
}

export function generateWebhookSecret(): string {
  // Telegram allows A-Z a-z 0-9 _ - , 1..256 chars
  const bytes = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(32)));
  return toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** Redact anything that looks like a Telegram token or long secret. */
export function redact(message: string): string {
  return message
    .replace(/\d{6,12}:[A-Za-z0-9_-]{30,}/g, "[REDACTED_TOKEN]")
    .replace(/[A-Za-z0-9_-]{40,}/g, "[REDACTED]");
}
