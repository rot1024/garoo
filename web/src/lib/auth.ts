import { getSession, login } from "./api";

// Single-user key handling. The user enters GALLERY_KEY once; we stash it in
// localStorage so they don't retype it, and exchange it for the HttpOnly session
// cookie that actually authenticates requests. The stored value is obfuscated
// (XOR + base64) — NOT real encryption: there's no user secret to derive a key
// from, so this only keeps the value from sitting in plaintext. For a one-person
// private tool that's the agreed trade-off.

const STORAGE_KEY = "garoo.k";
const SALT = "garoo-gallery-obfuscation-v1";

function xor(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i++) {
    out += String.fromCharCode(
      input.charCodeAt(i) ^ SALT.charCodeAt(i % SALT.length)
    );
  }
  return out;
}

export function saveKey(key: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, btoa(unescape(encodeURIComponent(xor(key)))));
  } catch {
    /* storage unavailable — session cookie still works for this tab */
  }
}

export function loadKey(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return xor(decodeURIComponent(escape(atob(raw))));
  } catch {
    return null;
  }
}

export function clearKey(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Ensure we have a valid session. Returns true if the cookie is already valid,
 * or if a stored key successfully re-establishes it; false if the user must log
 * in. A stored key that no longer works is discarded.
 */
export async function ensureSession(): Promise<boolean> {
  if (await getSession()) return true;
  const stored = loadKey();
  if (stored) {
    if (await login(stored)) return true;
    clearKey();
  }
  return false;
}

/** Log in with a freshly entered key and remember it on success. */
export async function loginWithKey(key: string): Promise<boolean> {
  const ok = await login(key);
  if (ok) saveKey(key);
  return ok;
}
