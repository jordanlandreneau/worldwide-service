import "server-only";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/data";
import { escapeHtml, sendMail } from "@/lib/mail";
import { SITE_URL } from "@/lib/site";

// Turns a Service BDC onboarding form (from the Admin Hub) into a store's Service Data page.
// New dealer → a new store, saved inactive so an admin can review it before agents see it.
// Existing dealer (same name) → only blank answers are filled in; nothing already entered is overwritten.

type Form = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 4000) : "");
const join = (...parts: (string | false | null | undefined)[]) => parts.filter((p) => p && String(p).trim()).join(" — ") || null;
const labeled = (pairs: [string, unknown][]) => {
  const out = pairs.map(([l, v]) => [l, str(v)] as const).filter(([, v]) => v);
  if (!out.length) return null;
  return out.length === 1 ? out[0][1] : out.map(([l, v]) => `${l}: ${v}`).join("\n");
};

// Form fields that are handled below, or never copied (the CRM password and NDA details stay in the Admin Hub).
const USED = new Set([
  "id", "dealer_name", "dealer_website", "sm_name", "sm_phone", "sm_email", "gsm_name", "gsm_phone", "gsm_email", "follow_up_thread_preference",
  "service_hours", "parts_hours", "can_schedule_diagnostic", "diagnostic_turnaround", "diagnostic_price", "diagnostic_waived_after_repair",
  "diagnostic_restrictions", "saturday_diagnosis", "saturday_diagnosis_last_time", "bodywork_collision", "bodyshop", "paint_touch",
  "glass_job", "glass_job_info", "windshield", "windshield_info", "window_tinting", "wheel_repair", "wheel_repair_info", "car_wash",
  "car_wash_info", "electric_charger", "electric_charger_info", "rental_vehicles", "rental_info", "loaner_vehicles", "loaner_info",
  "shuttle_service", "shuttle_info", "valet_service", "valet_info", "can_schedule_recalls", "recall_verification", "recall_when_scheduled",
  "recall_limitations", "recalls_other_makes", "warranty_responsible_dept", "other_dealer_maintenance_plan", "battery_warranty",
  "warranty_not_accepted", "financial_assistance", "payment_methods", "payments_over_phone", "first_appointment_time", "last_appointment_time",
  "service_limitations", "interval_service", "transmission_jobs", "services_electric_vehicles", "services_other_makes", "other_makes_maintenance",
  "other_makes_repairs", "accept_walk_ins", "notify_shop_walk_in", "accept_same_day", "same_day_info", "same_day_services", "crm_website",
  "crm_username", "crm_password", "daily_appointments", "daily_call_volume", "main_phone", "parts_phone", "service_phone", "sales_phone",
  "has_lounge", "has_coffee", "has_wifi", "has_tv", "has_kids_area", "accept_coupons", "additional_notes", "drop_off_box_location",
  "advisors", "form_type", "nda_accepted", "nda_accepted_at", "nda_version", "nda_ip_address", "created_at", "status", "submitted_at",
]);

export function toServiceData(f: Form) {
  const general: Record<string, string | null> = {
    dealer_website_url: str(f.dealer_website) || null,
    service_manager_name: str(f.sm_name) || null,
    service_manager_email: str(f.sm_email) || null,
    store_manager_name: str(f.gsm_name) || null,
    store_manager_email: str(f.gsm_email) || null,
    follow_up_thread: str(f.follow_up_thread_preference) || null,
    service_hours: str(f.service_hours) || null,
    parts_hours: str(f.parts_hours) || null,
    first_appointment: str(f.first_appointment_time) || null,
    last_appointment: str(f.last_appointment_time) || null,
    diagnostics: str(f.can_schedule_diagnostic) || null,
    diagnostics_price: str(f.diagnostic_price) || null,
    diagnostics_turnaround: str(f.diagnostic_turnaround) || null,
    diagnostics_waiver_after_repair: str(f.diagnostic_waived_after_repair) || null,
    diagnostics_restrictions: str(f.diagnostic_restrictions) || null,
    saturday_diagnostics: join(str(f.saturday_diagnosis), str(f.saturday_diagnosis_last_time) && `last time to schedule: ${str(f.saturday_diagnosis_last_time)}`),
    walk_ins: join(str(f.accept_walk_ins), str(f.notify_shop_walk_in) && `notify shop: ${str(f.notify_shop_walk_in)}`),
    same_day_appointments: labeled([["Accepted", f.accept_same_day], ["Details", f.same_day_info], ["Services", f.same_day_services]]),
    bodywork_collision: str(f.bodywork_collision) || null,
    bodyshop: str(f.bodyshop) || null,
    paint_touch_up_wheel_repair: labeled([["Paint touch-up", f.paint_touch], ["Wheel repair", join(str(f.wheel_repair), str(f.wheel_repair_info))]]),
    glass_work: join(str(f.glass_job), str(f.glass_job_info)),
    windshield: join(str(f.windshield), str(f.windshield_info)),
    window_tints: str(f.window_tinting) || null,
    car_wash_service: join(str(f.car_wash), str(f.car_wash_info)),
    electric_charging: join(str(f.electric_charger), str(f.electric_charger_info)),
    rentals: join(str(f.rental_vehicles), str(f.rental_info)),
    loaners: join(str(f.loaner_vehicles), str(f.loaner_info)),
    shuttle: join(str(f.shuttle_service), str(f.shuttle_info)),
    valet_service: join(str(f.valet_service), str(f.valet_info)),
    recalls: labeled([["Can schedule", f.can_schedule_recalls], ["When", f.recall_when_scheduled], ["Other makes & models", f.recalls_other_makes]]),
    vin_verification: str(f.recall_verification) || null,
    warranty: str(f.warranty_responsible_dept) || null,
    other_dealer_maintenance_plan: str(f.other_dealer_maintenance_plan) || null,
    battery_warranty: str(f.battery_warranty) || null,
    warranty_not_accepted: str(f.warranty_not_accepted) || null,
    financial_assistance: str(f.financial_assistance) || null,
    payment_methods: join(str(f.payment_methods), str(f.payments_over_phone) && `payments over the phone: ${str(f.payments_over_phone)}`),
    interval_service: str(f.interval_service) || null,
    transmission_work: str(f.transmission_jobs) || null,
    electric_vehicles: str(f.services_electric_vehicles) || null,
    other_makes_models: labeled([["Service other makes", f.services_other_makes], ["Maintenance", f.other_makes_maintenance], ["Repairs", f.other_makes_repairs]]),
    drop_off_box: str(f.drop_off_box_location) || null,
    coupons_from_other_dealers: str(f.accept_coupons) || null,
    daily_appointments: str(f.daily_appointments) || null,
    daily_call_volume: str(f.daily_call_volume) || null,
    amenities: [["has_lounge", "Lounge / waiting area"], ["has_coffee", "Coffee / beverages"], ["has_wifi", "Free Wi-Fi"], ["has_tv", "TVs"], ["has_kids_area", "Kids' play area"]]
      .filter(([k]) => f[k] === true).map(([, l]) => l).join(", ") || null,
    additional_notes: str(f.additional_notes) || null,
  };
  // Anything new on the form that isn't mapped yet still comes across.
  for (const [k, v] of Object.entries(f)) if (!USED.has(k) && typeof v === "string" && v.trim() && !/password|secret|token/i.test(k)) general[k] = str(v);

  const contacts: Record<string, unknown>[] = [];
  const person = (name: unknown, title: string, phone: unknown, email: unknown, comments?: unknown) => {
    if (str(name) || str(phone) || str(email)) contacts.push({ id: randomUUID(), name: str(name) || null, title, phone: str(phone) || null, email: str(email) || null, comments: str(comments) || null });
  };
  person(f.sm_name, "Service Manager", f.sm_phone, f.sm_email);
  person(f.gsm_name, "General Store Manager", f.gsm_phone, f.gsm_email);
  for (const a of Array.isArray(f.advisors) ? f.advisors.slice(0, 30) : []) person((a as any)?.name, "Service Advisor", (a as any)?.phone, (a as any)?.email, (a as any)?.other_info);
  for (const [k, t] of [["main_phone", "Main line"], ["service_phone", "Service line"], ["parts_phone", "Parts line"], ["sales_phone", "Sales line"]] as const) if (str(f[k])) person(t, t, f[k], null);

  const limitations: Record<string, unknown>[] = [];
  for (const k of ["service_limitations", "recall_limitations"]) if (str(f[k])) limitations.push({ id: randomUUID(), text: str(f[k]), severity: "warning", active: true, label: k === "recall_limitations" ? "Recalls" : "Service" });

  for (const k of Object.keys(general)) if (general[k] === null) delete general[k];
  return { general, contacts, limitations };
}

export async function importOnboarding(f: Form): Promise<{ ok: true; storeId: string; result: "created" | "filled" | "duplicate" } | { error: string }> {
  const name = str(f.dealer_name).slice(0, 200);
  if (!name) return { error: "dealer_name is required" };
  const sourceId = str(f.id).slice(0, 100) || null;
  const client = db();
  if (sourceId) {
    const { data: seen } = await client.from("onboarding_submissions").select("dealership_id").eq("source_id", sourceId).maybeSingle();
    if (seen?.dealership_id) return { ok: true, storeId: seen.dealership_id, result: "duplicate" };
  }
  const { general, contacts, limitations } = toServiceData(f);
  const now = new Date().toISOString();
  const website = str(f.dealer_website) ? (/^https?:\/\//i.test(str(f.dealer_website)) ? str(f.dealer_website) : `https://${str(f.dealer_website)}`) : null;
  const { data: same } = await client.from("dealerships").select("id,name,address,timezone,website,phone").ilike("name", name.replace(/[\\%_]/g, "\\$&")).limit(1);
  let storeId = (same ?? [])[0]?.id as string | undefined;
  let result: "created" | "filled" = "filled";

  if (!storeId) {
    storeId = randomUUID();
    result = "created";
    const { error } = await client.from("dealerships").insert({
      id: storeId, name, website, phone: str(f.main_phone) || str(f.service_phone) || null, timezone: "America/New_York",
      active: false, status: "Onboarding", service_required: true, created_at: now, updated_at: now,
      special_note: "Created from the Service onboarding form. Check the details, set the time zone and address, then turn on Active.",
    });
    if (error) return { error: "couldn't create the store" };
    const { data: dept } = await client.from("departments").select("id").ilike("name", "service").maybeSingle();
    if (dept?.id) await client.from("dealership_departments").upsert({ dealership_id: storeId, department_id: dept.id, active: true });
  } else {
    const s = same![0] as any;
    const patch: Record<string, unknown> = {};
    if (!s.website && website) patch.website = website;
    if (!s.phone && (str(f.main_phone) || str(f.service_phone))) patch.phone = str(f.main_phone) || str(f.service_phone);
    if (Object.keys(patch).length) await client.from("dealerships").update({ ...patch, updated_at: now }).eq("id", storeId);
  }

  // Service Data: fill blanks only.
  const { data: row } = await client.from("service_profiles").select("data").eq("dealership_id", storeId).maybeSingle();
  const data: Record<string, any> = (row?.data as any) ?? { dealership: { id: storeId, name, address: null, timezone: "America/New_York" }, generalInfo: {}, pricing: [], contacts: [], contactImages: [], limitations: [], announcements: [], hours: [] };
  const g = { ...(data.generalInfo ?? {}) };
  for (const [k, v] of Object.entries(general)) if (g[k] === null || g[k] === undefined || String(g[k]).trim() === "") g[k] = v;
  g.updatedAt = now;
  const haveContact = new Set(((data.contacts ?? []) as any[]).map((c) => `${String(c.name ?? "").toLowerCase()}|${String(c.phone ?? "").replace(/\D/g, "")}`));
  const newContacts = contacts.filter((c) => !haveContact.has(`${String(c.name ?? "").toLowerCase()}|${String(c.phone ?? "").replace(/\D/g, "")}`));
  const haveLimit = new Set(((data.limitations ?? []) as any[]).map((l) => String(l.text ?? "").trim()));
  const newLimits = limitations.filter((l) => !haveLimit.has(String(l.text)));
  const next = { ...data, generalInfo: g, contacts: [...(data.contacts ?? []), ...newContacts], limitations: [...(data.limitations ?? []), ...newLimits], onboarding: { submittedAt: str(f.created_at) && !Number.isNaN(Date.parse(str(f.created_at))) ? new Date(str(f.created_at)).toISOString() : now, sourceId, by: str(f.sm_email) || null } };
  const { error: pe } = await client.from("service_profiles").upsert({ dealership_id: storeId, data: next });
  if (pe) return { error: "couldn't save the Service Data" };

  // The CRM link and username go to the store's Service login. The password is not copied: add it on the store page.
  if (str(f.crm_website) || str(f.crm_username)) {
    const { data: dept } = await client.from("departments").select("id").ilike("name", "service").maybeSingle();
    const { count } = dept?.id ? await client.from("crm_credentials").select("id", { count: "exact", head: true }).eq("dealership_id", storeId).eq("department_id", dept.id) : { count: 1 };
    if (dept?.id && !count) {
      let url = str(f.crm_website);
      if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
      let host = "CRM";
      try { host = url ? new URL(url).hostname.replace(/^www\./, "") : "CRM"; } catch { /* keep CRM */ }
      await client.from("crm_credentials").insert({ id: randomUUID(), dealership_id: storeId, department_id: dept.id, crm_type: host, username: str(f.crm_username) || null, login_url: url || null, has_password: false, created_at: now, updated_at: now });
    }
  }

  const { crm_password: _drop, nda_ip_address: _ip, ...kept } = f as any;
  await client.from("onboarding_submissions").insert({ source_id: sourceId, dealership_id: storeId, dealer_name: name, submitter_email: str(f.sm_email) || null, result, payload: kept });
  await client.from("edit_log").insert({ user_email: "onboarding-form", table_name: "dealerships", row_id: storeId, action: result === "created" ? "store created from onboarding" : "service data filled from onboarding" });

  const link = `/stores/${storeId}`;
  const title = result === "created" ? `New store from onboarding: ${name}` : `${name}: onboarding form filled in Service Data`;
  const body = result === "created" ? "Its Service Data page is ready. Review it and turn on Active." : `${Object.keys(general).length} answers, ${newContacts.length} new contacts`;
  await client.from("site_events").insert({ kind: "onboarding", dealership_id: storeId, title, body, link, created_by: "onboarding-form" });
  const to = (process.env.CHANGE_REQUEST_EMAILS ?? "lauren@worldwidebdc.com,leanetm@worldwidebdc.com").split(",").map((s) => s.trim()).filter(Boolean);
  await sendMail({
    to, subject: title,
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5">
      <p>${result === "created" ? `A Service onboarding form came in for <strong>${escapeHtml(name)}</strong>, so the store and its Service Data page were created. It's saved as <strong>inactive</strong> until someone reviews it.` : `A Service onboarding form came in for <strong>${escapeHtml(name)}</strong>. Blank Service Data answers were filled in; nothing already entered was changed.`}</p>
      <p>Still to do: address, time zone, the JustCall numbers for codes${str(f.crm_username) ? ", and the CRM password (it isn't copied over)" : ""}.</p>
      <p><a href="${SITE_URL}${link}" style="display:inline-block;background:#1f5fbf;color:#fff;padding:9px 16px;border-radius:3px;text-decoration:none">Review the store</a></p>
    </div>`,
  }).catch(() => false);
  revalidatePath("/stores");
  revalidatePath(link);
  revalidatePath("/service/info");
  return { ok: true, storeId: storeId as string, result };
}
