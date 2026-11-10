import { type NextRequest } from "next/server";
import { callRecording, storeLines } from "@/lib/calls";
import { inScope, requireScoped } from "@/lib/scope";

// Plays a call recording through the site, so only people who can see the store can listen.
export async function GET(request: NextRequest) {
  const { stores } = await requireScoped();
  const store = request.nextUrl.searchParams.get("d") ?? "";
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(store) || !inScope(stores, store)) return new Response("Not found", { status: 404 });
  const url = await callRecording(id, new Set(await storeLines(store)));
  if (!url) return new Response("No recording for this call.", { status: 404 });
  const range = request.headers.get("range");
  const res = await fetch(url, { headers: range ? { Range: range } : undefined, cache: "no-store" });
  if (!res.ok && res.status !== 206) return new Response("The recording couldn't be loaded.", { status: 502 });
  const headers = new Headers({ "Content-Type": res.headers.get("content-type") ?? "audio/mpeg", "Cache-Control": "private, max-age=600", "Accept-Ranges": "bytes" });
  for (const h of ["content-length", "content-range"]) { const v = res.headers.get(h); if (v) headers.set(h, v); }
  if (request.nextUrl.searchParams.get("download") === "1") headers.set("Content-Disposition", `attachment; filename="call-${id}.mp3"`);
  return new Response(res.body, { status: res.status, headers });
}
