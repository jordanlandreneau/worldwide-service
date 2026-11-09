// Outcomes an agent can record for one customer on a calling sheet.
export const OUTCOMES = [
  { value: "appointment", label: "Appointment set", tone: "green" },
  { value: "callback", label: "Call back", tone: "blue" },
  { value: "voicemail", label: "Left voicemail", tone: "amber" },
  { value: "no_answer", label: "No answer", tone: "slate" },
  { value: "not_interested", label: "Not interested", tone: "slate" },
  { value: "already_serviced", label: "Already serviced", tone: "slate" },
  { value: "wrong_number", label: "Wrong number", tone: "red" },
  { value: "do_not_call", label: "Do not call", tone: "red" },
] as const;
export type Outcome = (typeof OUTCOMES)[number]["value"];
export const outcome = (v: string | null | undefined) => OUTCOMES.find((o) => o.value === v);
// Still worth another try later, so the row stays in "To do".
export const RETRY = new Set(["callback", "voicemail", "no_answer"]);
