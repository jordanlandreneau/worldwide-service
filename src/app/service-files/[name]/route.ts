import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/access";
import { db } from "@/lib/data";

export async function GET(_: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const user = await getUser();
  if (!user || user.role === "dealership") return new NextResponse("Not allowed", { status: 403 });
  const { name } = await params;
  if (!/^[\w.-]+$/.test(name)) return new NextResponse("Not found", { status: 404 });
  const { data, error } = await db().storage.from("service-files").download(name);
  if (error || !data) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(data, { headers: { "Content-Type": data.type || "application/octet-stream", "Cache-Control": "private, max-age=3600" } });
}
