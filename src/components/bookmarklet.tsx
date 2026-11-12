"use client";
import { useEffect, useRef, useState } from "react";

// A link people drag to their bookmarks bar. React won't render javascript: links, so it's set after load.
export function Bookmarklet({ src, label }: { src: string; label: string }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [code, setCode] = useState("");
  useEffect(() => {
    fetch(src).then((r) => r.text()).then((js) => {
      const href = `javascript:${encodeURIComponent(js.trim())}`;
      ref.current?.setAttribute("href", href);
      setCode(js.trim());
    }).catch(() => undefined);
  }, [src]);
  return (
    <>
      <a ref={ref} className="bm-link" onClick={(e) => e.preventDefault()} draggable title="Drag me to your bookmarks bar">{label}</a>
      {code && (
        <details className="bm-console">
          <summary>Can&apos;t use bookmarks? Copy the console version</summary>
          <p>In the Xtime tab, press F12 (Cmd+Option+J on a Mac), click Console, paste this and press Enter.</p>
          <button type="button" className="x-btn" onClick={() => navigator.clipboard.writeText(code)}>Copy</button>
        </details>
      )}
    </>
  );
}
