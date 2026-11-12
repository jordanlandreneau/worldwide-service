import { type NextRequest } from "next/server";
import { requireUser } from "@/lib/access";
import { readBytes } from "@/lib/follow-media";

// Shows a Follow-ups picture to signed-in agents and up.
export async function GET(request: NextRequest) {
  await requireUser("agent");
  const path = request.nextUrl.searchParams.get("p") ?? "";
  if (!/^[0-9a-f-]{36}\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.[a-z]{2,5}$/i.test(path)) return new Response("Not found", { status: 404 });
  const file = await readBytes(path);
  if (!file) return new Response("Not found", { status: 404 });
  const name = request.nextUrl.searchParams.get("download") ? `attachment; filename="${path.split("/").pop()}"` : "inline";
  return new Response(file.bytes, { headers: { "Content-Type": file.type, "Cache-Control": "private, max-age=86400", "Content-Disposition": name } });
}
