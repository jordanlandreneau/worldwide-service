import { redirect } from "next/navigation";

// Old chat links open the chat in the Follow-ups workspace.
export default async function OldChatLink({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/follow-up?chat=${encodeURIComponent(id)}`);
}
