import { createElement as h } from "react";

export function presentationView(search: string): boolean {
  return new URLSearchParams(search).get("view") === "present";
}

/** Preserve the session transport mode and all other URL options. No navigation is needed. */
export function viewUrl(href: string, present: boolean): string {
  const url = new URL(href);
  if (present) url.searchParams.set("view", "present");
  else url.searchParams.delete("view");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function ViewToggle({ present, onChange }: { present: boolean; onChange: (present: boolean) => void }) {
  return h("div", { className: "view-toggle", role: "group", "aria-label": "Dashboard view" },
    h("button", { type: "button", "aria-pressed": !present, onClick: () => onChange(false) }, "Detailed"),
    h("button", { type: "button", "aria-pressed": present, onClick: () => onChange(true) }, "Presentation"),
  );
}
