// The Service team's dispositions for one customer on a calling sheet.
export const OUTCOMES = [
  { value: "appointment_booked", label: "APPOINTMENT BOOKED", tone: "green" },
  { value: "call_didnt_go_through", label: "CALL DIDN'T GO THROUGH", tone: "amber" },
  { value: "changed_dealership", label: "CHANGED THE DEALERSHIP", tone: "slate" },
  { value: "customer_will_call_back", label: "CUSTOMER WILL CALL BACK", tone: "blue" },
  { value: "dnc", label: "DNC", tone: "red" },
  { value: "fixed", label: "FIXED", tone: "slate" },
  { value: "follow_up", label: "FOLLOW UP", tone: "blue" },
  { value: "had_appointment", label: "HAD AN APPOINTMENT", tone: "slate" },
  { value: "info_not_found", label: "INFO NOT FOUND", tone: "slate" },
  { value: "llc", label: "LLC", tone: "slate" },
  { value: "no_answer_tm_sent", label: "NO ANSWER TM SENT", tone: "amber" },
  { value: "no_remedy", label: "NO REMEDY", tone: "slate" },
  { value: "not_interested", label: "NOT INTERESTED/DECLINED", tone: "slate" },
  { value: "other", label: "OTHER", tone: "slate" },
  { value: "sold", label: "SOLD", tone: "slate" },
  { value: "too_old", label: "TOO OLD", tone: "slate" },
  { value: "totaled", label: "TOTALED", tone: "slate" },
  { value: "waiting_for_parts", label: "WAITING FOR PARTS", tone: "blue" },
  { value: "wrong_customer_info", label: "WRONG CUSTOMER INFORMATION", tone: "red" },
] as const;
export type Outcome = (typeof OUTCOMES)[number]["value"];
export const outcome = (v: string | null | undefined) => OUTCOMES.find((o) => o.value === v);
// Worth another try later, so these land in "Call back" instead of "Done".
export const RETRY = new Set(["call_didnt_go_through", "customer_will_call_back", "follow_up", "no_answer_tm_sent", "waiting_for_parts"]);
