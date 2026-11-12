(async () => {
  // Worldwide Service: export the open Xtime call list to a CSV.
  // Runs in the agent's own Xtime tab and session; nothing is sent anywhere except the CSV download.
  const say = (t) => { let b = document.getElementById("wwbdc-xt"); if (!b) { b = document.createElement("div"); b.id = "wwbdc-xt"; b.style.cssText = "position:fixed;z-index:2147483647;top:12px;right:12px;max-width:340px;background:#10161f;color:#fff;font:14px/1.4 Arial,sans-serif;padding:12px 14px;border-radius:6px;box-shadow:0 6px 24px rgba(0,0,0,.35)"; document.body.appendChild(b); } b.textContent = t; return b; };
  const done = (t) => { const b = say(t); setTimeout(() => b.remove(), 9000); };
  const wins = [window];
  for (const f of document.querySelectorAll("iframe")) { try { if (f.contentWindow && f.contentWindow.Ext) wins.push(f.contentWindow); } catch (e) { /* other site */ } }
  const looksLikeList = (fields) => { const s = fields.join(" ").toLowerCase(); return /first/.test(s) && /last/.test(s) && /(phone|contact)/.test(s); };
  let store = null, title = "";
  for (const w of wins) {
    if (!w.Ext || !w.Ext.ComponentQuery) continue;
    const grids = w.Ext.ComponentQuery.query("grid, gridpanel").filter((g) => { try { return g.isVisible(true) && g.getStore && g.getStore(); } catch (e) { return false; } });
    for (const g of grids) {
      const st = g.getStore();
      const rec = st.getAt && st.getAt(0);
      const fields = rec ? Object.keys(rec.getData ? rec.getData() : rec.data || {}) : (st.model && st.model.getFields ? st.model.getFields().map((f) => f.name) : []);
      if (looksLikeList(fields)) { store = st; title = (g.up && g.up("panel") && g.up("panel").title) || ""; break; }
    }
    if (store) break;
  }
  const h = Array.from(document.querySelectorAll("h1,h2,h3,div,span")).map((e) => e.textContent.trim()).find((t) => /^Call List for /.test(t)) || title || "Xtime call list";
  const listName = h.replace(/^Call List for\s*/, "").trim();
  if (!store) { done("Open a call list first (Outbound → Call List → click a list's name), then click the bookmark again."); return; }
  const total = store.getTotalCount ? store.getTotalCount() : store.getCount();
  say(`Reading ${total.toLocaleString()} customers from "${listName}"…`);
  const flat = (o, p = "", out = {}) => { for (const [k, v] of Object.entries(o || {})) { if (v === null || v === undefined) continue; if (Array.isArray(v)) { v.forEach((x, i) => (x && typeof x === "object" ? flat(x, `${p}${k}${i + 1}.`, out) : (out[`${p}${k}${i + 1}`] = x))); } else if (typeof v === "object" && !(v instanceof Date)) flat(v, `${p}${k}.`, out); else out[`${p}${k}`] = v instanceof Date ? v.toISOString().slice(0, 10) : v; } return out; };
  const rows = [];
  const keep = store.pageSize || 10;
  const per = 200;
  const pages = Math.max(1, Math.ceil(total / per));
  const loadPage = (n) => new Promise((res) => { store.pageSize = per; store.loadPage(n, { callback: (recs, op, ok) => res(ok === false ? null : recs || []), scope: store }); });
  for (let p = 1; p <= pages; p++) {
    const recs = await loadPage(p);
    if (recs === null) { done(`Xtime stopped answering on page ${p}. Try again in a minute.`); store.pageSize = keep; return; }
    for (const r of recs) rows.push(flat(r.raw && typeof r.raw === "object" ? r.raw : r.getData ? r.getData() : r.data));
    say(`Reading "${listName}": ${Math.min(rows.length, total).toLocaleString()} of ${total.toLocaleString()}…`);
    if (!recs.length) break;
  }
  store.pageSize = keep; store.loadPage(1);
  // Clean up: one row per customer (duplicates merged), names in normal case, phones formatted,
  // bad phone numbers dropped, and customers with no phone left out (they can't be called).
  const pick = (r, re) => { const k = Object.keys(r).find((x) => re.test(x)); return k ? String(r[k] ?? "").trim() : ""; };
  const digits = (v) => { let d = String(v ?? "").replace(/\D/g, ""); if (d.length === 11 && d[0] === "1") d = d.slice(1); return d.length === 10 && !/^(\d)\1{9}$/.test(d) && !/^[01]/.test(d) ? d : ""; };
  const fmt = (d) => `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  const nice = (v) => String(v || "").trim().replace(/\s+/g, " ").toLowerCase().replace(/(^|[\s\-'’.])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Ii|Iii|Iv)\b/g, (x) => x.toUpperCase()).replace(/\bMc([a-z])/g, (m, c) => "Mc" + c.toUpperCase());
  const phonesOf = (r) => [...new Set(Object.keys(r).filter((k) => /phone|number|mobile|cell/i.test(k)).map((k) => digits(r[k])).filter(Boolean))];
  const people = [];
  const byPhone = new Map(), byName = new Map();
  let dupes = 0, noPhone = 0;
  for (const r of rows) {
    const first = nice(pick(r, /first.?name/i)), last = nice(pick(r, /last.?name/i));
    const ph = phonesOf(r);
    if (!ph.length) { noPhone++; continue; }
    const vehicle = pick(r, /vehicle|year.?make|model/i).replace(/\s+/g, " ");
    const email = pick(r, /e.?mail/i).toLowerCase();
    const nameKey = `${first}|${last}`.toLowerCase();
    // Same customer if any phone matches, or the same full name with no phone conflict.
    let p = ph.map((d) => byPhone.get(d)).find(Boolean) || (first && last ? byName.get(nameKey) : null);
    if (p) {
      dupes++;
      p.times++;
      ph.forEach((d) => { if (!p.phones.includes(d)) p.phones.push(d); });
      if (vehicle && !p.vehicles.includes(vehicle)) p.vehicles.push(vehicle);
      if (!p.email && email) p.email = email;
    } else {
      p = { first, last, phones: [...ph], vehicles: vehicle ? [vehicle] : [], email, program: pick(r, /program|campaign/i) || listName, agent: pick(r, /agent|assign/i), status: pick(r, /work.?status|status/i), modified: pick(r, /modif|updated/i), times: 1 };
      people.push(p);
    }
    p.phones.forEach((d) => byPhone.set(d, p));
    if (first && last) byName.set(nameKey, p);
  }
  const head = ["First name", "Last name", "Phone 1", "Phone 2", "Phone 3", "Email", "Vehicle(s)", "Call program", "Agent", "Work status", "Last modified", "Times on Xtime list"];
  const lines = people.map((p) => [p.first, p.last, p.phones[0] ? fmt(p.phones[0]) : "", p.phones[1] ? fmt(p.phones[1]) : "", p.phones[2] ? fmt(p.phones[2]) : "", p.email, p.vehicles.join("; "), p.program, p.agent, p.status, p.modified, p.times]);
  const esc = (v) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = "﻿" + [head, ...lines].map((l) => l.map(esc).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `${listName.replace(/[^\w -]+/g, "").trim() || "xtime-list"} - ${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  done(`Downloaded ${people.length.toLocaleString()} customers from "${listName}" (Xtime had ${rows.length.toLocaleString()}: ${dupes.toLocaleString()} duplicates merged, ${noPhone.toLocaleString()} with no phone left out).`);
})().catch((e) => alert("Xtime export didn't work: " + (e && e.message ? e.message : e)));
