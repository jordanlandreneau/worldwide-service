import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/access";
import { db } from "@/lib/data";

const cell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Gives back an uploaded outbound list as a CSV file. Store logins only get their own stores' lists.
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return new NextResponse("Not allowed", { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  const client = db();
  const { data: list } = await client.from("outbound_lists").select("dealership_id,file_name,columns,rows").eq("id", id).maybeSingle();
  if (!list) return new NextResponse("Not found", { status: 404 });
  if (user.role === "dealership") {
    const { data: link } = await client.from("user_dealerships").select("dealership_id").eq("user_id", user.id ?? "00000000-0000-0000-0000-000000000000").eq("dealership_id", list.dealership_id).maybeSingle();
    if (!link) return new NextResponse("Not allowed", { status: 403 });
  }
  const lines = [list.columns as string[], ...(list.rows as string[][])].map((r) => r.map(cell).join(","));
  const name = String(list.file_name).replace(/[^\w. -]/g, "_");
  return new NextResponse(`﻿${lines.join("\r\n")}\r\n`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" },
  });
}
