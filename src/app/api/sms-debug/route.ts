import { NextResponse } from "next/server";
import { atLeast, getUser } from "@/lib/access";
import { justcall } from "@/lib/justcall";

// Temporary, admins only: reads JustCall's SMS group endpoints and asks for their required fields (empty requests, nothing is created or sent).
export async function GET(req: Request) {
  const user = await getUser();
  if (!user || !atLeast(user.role, "admin")) return new NextResponse("Not allowed", { status: 403 });
  const line = new URL(req.url).searchParams.get("line") ?? "";
  const out: Record<string, unknown> = {};
  const peek = async (k: string, path: string, init?: RequestInit) => {
    const res = await justcall(path, init, 0);
    const text = await res.text();
    out[k] = { status: res.status, body: text.slice(0, 1500) };
  };
  await peek("list", `/texts/groups?justcall_number=${encodeURIComponent(line)}&per_page=3`);
  await peek("listPlain", `/texts/groups?justcall_number=${encodeURIComponent(line.replace(/^\+/, ""))}&per_page=3`);
  await peek("createEmpty", "/texts/groups", { method: "POST", body: "{}" });
  await peek("sendEmpty", "/texts/groups/0/messages", { method: "POST", body: "{}" });
  return NextResponse.json(out);
}
