"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BarChart3, Inbox, Building2, History, ListOrdered, Timer, UserCog, BookOpen, CalendarClock, CalendarPlus, Car, CarFront, CircleHelp, ClipboardCheck, ClipboardList, Gauge, GraduationCap, Info, KeyRound, Library, LogOut, Megaphone, Menu, MessageSquare, MessagesSquare, PanelLeftClose, PanelLeftOpen, Phone, PhoneCall, ScrollText, SlidersHorizontal, Store, Tags, Trophy, Upload, UserCheck, Users, UsersRound } from "lucide-react";
import { Clocks, TopSearch } from "@/components/top-tools";
import type { Role } from "@/lib/access";

// Same sections, order, names and roles as 3.0. Dealer Sync stays out because it's a Lovable app.
// Service site menu (carried over from Worldwide Service's Service section).
const GROUPS: { label: string; items: { label: string; href: string; icon: typeof Info; min: Role }[] }[] = [
  { label: "Service", items: [
    { label: "Command Center", href: "/command", icon: Gauge, min: "dealership" },
    { label: "Reference Library", href: "/service/glossary", icon: Library, min: "agent" },
    { label: "Service Data", href: "/service/info", icon: CircleHelp, min: "dealership" },
    { label: "Store Info", href: "/store-info", icon: Store, min: "agent" },
    { label: "Codes", href: "/codes", icon: KeyRound, min: "agent" },
  ] },
  { label: "Admin", items: [
    { label: "Service Admin", href: "/service/manage", icon: SlidersHorizontal, min: "admin" },
    { label: "Users", href: "/users", icon: UserCog, min: "manager" },
  ] },
];
// Every page has its own color, so it's easy to tell where you are.
const TONES: Record<string, string> = {
  "/command": "green", "/service/info": "indigo", "/service/glossary": "green", "/store-info": "cyan", "/codes": "violet", "/users": "pink",
  "/service/manage": "amber",
};
const RANK: Record<Role, number> = { dealership: 0, agent: 1, manager: 2, admin: 3 };

export function Shell({ user, children }: { user: { name: string; role: Role }; children: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const matches = (href: string) => path === href || (path.startsWith(`${href}/`));
  const here = GROUPS.flatMap((g) => g.items).find((i) => matches(i.href));
  const tone = (here && TONES[here.href]) ?? "blue";
  const initials = user.name.split(/[\s.@]+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");
  return (
    <div className="x-app" data-collapsed={collapsed}>
      {open && <button className="x-scrim" aria-label="Close menu" onClick={() => setOpen(false)} />}
      <aside className="x-rail" data-open={open}>
        <Link href="/service/info" className="x-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="Worldwide BDC" width={148} height={24} src="/brand/logo-worldwide.svg" />
        </Link>
        <nav aria-label="Primary" className="x-nav">
          {GROUPS.map((g) => {
            const items = g.items.filter((i) => RANK[user.role] >= RANK[i.min]);
            if (!items.length) return null;
            return (
              <div key={g.label} className="x-nav-group">
                {user.role !== "dealership" && <div className="x-nav-label">{g.label}</div>}
                {items.map((i) => {
                  const active = matches(i.href);
                  return (
                    <Link key={i.href} href={i.href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined} className="x-nav-item" data-tone={TONES[i.href] ?? "blue"} data-active={active}>
                      <i.icon size={17} aria-hidden />
                      <span>{i.label}</span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="x-rail-user">
          <span className="x-avatar" aria-hidden>{initials}</span>
          <span className="x-user-text"><strong>{user.name}</strong><small>{user.role[0].toUpperCase() + user.role.slice(1)}</small></span>
          <form action="/auth/signout" method="post"><button className="x-icon" title="Sign out" aria-label="Sign out"><LogOut size={16} /></button></form>
        </div>
      </aside>
      <div className="x-column" data-tone={tone}>
        <header className="x-topbar">
          <button className="x-icon x-menu-btn" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen(!open)}><Menu size={20} /></button>
          <button className="x-icon x-collapse-btn" aria-label={collapsed ? "Show menu" : "Hide menu"} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button>
          <TopSearch />
          <Clocks />
        </header>
        <main id="main-content" className="x-main">{children}</main>
      </div>
    </div>
  );
}
