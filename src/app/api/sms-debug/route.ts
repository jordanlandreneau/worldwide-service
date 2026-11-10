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
  const wait = () => new Promise((r) => setTimeout(r, 2500));
  // Each body leaves out or empties the members, so JustCall can only answer with what's missing; nothing is created.
  const bodies: Record<string, unknown>[] = [
    { group_name: "probe", justcall_number: line, members: [1] },
    { group_name: "probe", justcall_number: line, members: [{}] },
    { group_name: "probe", justcall_number: line, members: [""] },
    { group_name: "probe", justcall_number: line, members: [{ contact_number: "" }] },
  ];
  for (const [i, body] of bodies.entries()) { await peek(`create${i}`, "/texts/groups", { method: "POST", body: JSON.stringify(body) }); await wait(); }
  await peek("messages", "/texts/groups/0/messages?justcall_number=" + encodeURIComponent(line));
  return NextResponse.json(out);
}
