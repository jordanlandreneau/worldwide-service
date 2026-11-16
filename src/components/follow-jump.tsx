"use client";
import { useEffect } from "react";

// Scrolls the chat to a message found by search.
export function JumpTo({ id }: { id: string }) {
  useEffect(() => {
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "center" }), 50);
    return () => clearTimeout(t);
  }, [id]);
  return null;
}
