import { NextResponse } from "next/server";
import { atLeast, getUser } from "@/lib/access";
import { pullAll } from "@/lib/follow-sync";

// The Follow-ups page calls this in the background; it reports how many new replies came in.
export async function POST() {
  const user = await getUser();
  if (!user || !atLeast(user.role, "agent") || user.role === "dealership") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ added: await pullAll() });
}
