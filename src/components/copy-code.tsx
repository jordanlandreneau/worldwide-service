"use client";
import { useState } from "react";

export function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className="x-btn x-mono" title="Copy code" onClick={async () => { await navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
      {copied ? "Copied" : code}
    </button>
  );
}
