import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/data";

// Pictures (and PDFs) in Follow-ups. Every file, sent or received, is kept in the private
// "follow-media" storage bucket; the site shows them through /api/follow-up/media, which checks the login.

export const BUCKET = "follow-media";
export const MAX_BYTES = 10 * 1024 * 1024;
export type Attachment = { path: string; type: string; name: string; size: number };
export type IncomingMedia = { url: string; auth?: string; name?: string; type?: string };

const okType = (t: string) => /^image\/(png|jpe?g|gif|webp|heic|heif)$/i.test(t) || t === "application/pdf";
const extFor = (t: string) => ({ "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf" } as Record<string, string>)[t.toLowerCase()] ?? "bin";

export async function storeBytes(chatId: string, bytes: ArrayBuffer | Uint8Array, type: string, name?: string): Promise<Attachment | null> {
  const size = bytes.byteLength;
  if (!size || size > MAX_BYTES || !okType(type)) return null;
  const path = `${chatId}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${extFor(type)}`;
  const { error } = await db().storage.from(BUCKET).upload(path, bytes, { contentType: type, upsert: false });
  if (error) return null;
  return { path, type, name: (name || `picture.${extFor(type)}`).slice(0, 120), size };
}

// Files an agent picked in the composer.
export async function storeUploads(chatId: string, files: File[]): Promise<{ list: Attachment[]; error?: string }> {
  const list: Attachment[] = [];
  for (const f of files.slice(0, 6)) {
    if (!f.size) continue;
    if (f.size > MAX_BYTES) return { list, error: `${f.name} is over 10 MB.` };
    if (!okType(f.type)) return { list, error: `${f.name} isn't a picture or PDF.` };
    const a = await storeBytes(chatId, await f.arrayBuffer(), f.type, f.name);
    if (!a) return { list, error: `Couldn't save ${f.name}.` };
    list.push(a);
  }
  return { list };
}

// Downloads a picture a store sent (from the chat app) and keeps a copy.
export async function storeRemote(chatId: string, m: IncomingMedia): Promise<Attachment | null> {
  try {
    const res = await fetch(m.url, { headers: m.auth ? { Authorization: m.auth } : undefined, redirect: "follow" });
    if (!res.ok) return null;
    const type = (m.type || res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) return null;
    return await storeBytes(chatId, await res.arrayBuffer(), type, m.name);
  } catch {
    return null;
  }
}

export async function readBytes(path: string): Promise<{ bytes: ArrayBuffer; type: string } | null> {
  const { data, error } = await db().storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return { bytes: await data.arrayBuffer(), type: data.type || "application/octet-stream" };
}

// A time-limited link a chat app can fetch the file from (WhatsApp, texts).
export async function shareLink(path: string, seconds = 7 * 86400) {
  const { data } = await db().storage.from(BUCKET).createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}

// People someone can @ in a message.
export type Mention = { name: string; email?: string | null; phone?: string | null; id?: string | null };
