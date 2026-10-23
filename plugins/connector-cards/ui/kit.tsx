/**
 * Connector cards — the shared UI kit. Tokens, card chrome, the portaled Picker, SaveBar, glyphs,
 * and the contract a connector's ui.tsx fulfils. Nothing here knows about issues or events.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ComponentType, CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, Pill } from "@bonsai/plugin-ui-sdk/ui";

/* ---------- the contract a connector's UI fulfils ---------- */
export type UiCtx = {
  /** The tool result's `details`: `{ connector, kind, …payload, timing }`. */
  details: any;
  phase: string;
  sessionId: string;
  /** Send a message as the person (the card's Save / Create / Comment commands). */
  send: (text: string) => Promise<void>;
  /** Open a URL in the system browser. */
  openUrl: (url: string) => void;
};
export type ConnectorUi = {
  id: string;
  label: string;
  /** Draws every `details.kind` the connector's agent side produces. */
  component: ComponentType<{ ctx: UiCtx; note?: string }>;
  /** Shown while the tool runs: "Reading Linear…". */
  runningText?: (kind: "view" | "record" | "draft" | "apply") => string;
};

/* ---------- tokens and chrome ---------- */
export const v = (n: string) => `var(--kay-color-${n})`;
export const card: CSSProperties = { border: `1px solid ${v("border")}`, borderRadius: 12, background: v("bg-elevated"), overflow: "hidden", maxWidth: 720, color: v("text-primary"), fontSize: 14 };
export const pad: CSSProperties = { padding: "18px 20px 14px", display: "flex", flexDirection: "column", gap: 12 };
export const bare: CSSProperties = { width: "100%", background: "transparent", border: 0, outline: "none", padding: 0, color: v("text-primary"), font: "inherit", resize: "none" };
export const muted: CSSProperties = { color: v("text-secondary") };
export const row: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 };
export const mono: CSSProperties = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" };
export const footer: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: `1px solid ${v("border")}`, padding: "10px 16px" };
export const hoverable = { onMouseEnter: (e: any) => (e.currentTarget.style.background = v("interactive-hover")), onMouseLeave: (e: any) => (e.currentTarget.style.background = "transparent") };

export function parse<T>(raw: string | undefined): T | null { if (!raw) return null; try { return JSON.parse(raw) as T; } catch { return null; } }
export const dayShort = (s?: string) => (s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");

/* ---------- follow-ups: the card shows its primary surface plus the few controls Jev picked; More reveals the rest (locally) ---------- */
export function useFollowUps(offered: string[] | undefined, resetOn: unknown) {
  const [more, setMore] = useState(false);
  useEffect(() => { setMore(false); }, [resetOn]);
  const set = new Set(offered ?? []);
  const gated = Array.isArray(offered);
  return { has: (id: string) => !gated || more || set.has(id), more, toggle: () => setMore((m) => !m), gated };
}
export function MoreChip({ on, onClick, label }: { on: boolean; onClick: () => void; label?: string }) {
  return <button type="button" onClick={onClick} title={on ? "Fewer controls" : "More controls"} style={{ ...bare, width: "auto", padding: "2px 8px", borderRadius: 6, fontSize: 12, color: v("text-secondary"), cursor: "pointer", background: on ? v("bg-subtle") : "transparent" }}>{on ? "Less" : label ?? "More"}</button>;
}

export function ErrorCard({ message }: { message: string }) { return <div style={{ ...card, ...pad, ...muted }}>{message}</div>; }
export function Placeholder({ text }: { text: string }) { return <div style={{ ...card, ...pad, ...muted }}>{text}</div>; }
export function Timing({ t, labels }: { t?: Record<string, string>; labels?: Record<string, string> }) {
  if (!t) return null;
  const parts = Object.entries(t).filter(([k]) => k !== "total").map(([k, val]) => `${labels?.[k] ?? k[0].toUpperCase() + k.slice(1)} ${val}`);
  return parts.length ? <span>{parts.join(" · ")}</span> : null;
}

/* ---------- glyphs every connector can use ---------- */
export const OpenGlyph = () => <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3H3.5A1.5 1.5 0 0 0 2 4.5v7A1.5 1.5 0 0 0 3.5 13h7a1.5 1.5 0 0 0 1.5-1.5V9M9 2h4v4M13 2L7 8" /></svg>;
export const UserGlyph = () => <svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="4.5" r="2.6" fill="currentColor" /><path d="M2 12.5c.6-2.9 2.4-4.3 5-4.3s4.4 1.4 5 4.3z" fill="currentColor" /></svg>;
export const PinGlyph = () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M7 13s4-3.9 4-7A4 4 0 0 0 3 6c0 3.1 4 7 4 7z" /><circle cx="7" cy="6" r="1.4" /></svg>;
export const ClockGlyph = () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="7" cy="7" r="5.5" /><path d="M7 4v3.2l2 1.3" strokeLinecap="round" /></svg>;
export const NotesGlyph = () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M2.5 3.5h9M2.5 7h9M2.5 10.5h6" /></svg>;
export const VideoGlyph = () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><rect x="1.5" y="3.5" width="8" height="7" rx="1.5" /><path d="M9.5 6.3l3-1.8v5l-3-1.8z" /></svg>;

/** An icon button that opens a URL in the system browser (a bare anchor does not leave the app). */
export function OpenExternal({ url, title, onOpen }: { url: string; title: string; onOpen: (url: string) => void }) {
  return (
    <button type="button" onClick={() => onOpen(url)} title={title} aria-label={title} {...hoverable}
      style={{ ...bare, display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 6, color: v("text-secondary"), cursor: "pointer" }}>
      <OpenGlyph />
    </button>
  );
}

/* ---------- Picker: a pill (or a bare glyph) that opens a portaled list ---------- */
export function Picker<T>({ items, value, onPick, label, lead, keyOf, labelOf, emphasis, multi, compact, title, readOnly }: {
  items: T[]; value: T | T[] | undefined; onPick: (t: T) => void; label: string;
  lead: (t: T | undefined) => ReactNode; keyOf: (t: T) => string; labelOf: (t: T) => string; emphasis?: boolean; multi?: boolean; compact?: boolean; title?: string;
  /** Show the value as a plain pill (no caret, no menu): the property is not one of this card's follow-ups. */
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const trigger = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const h = Math.min(items.length, 8) * 34 + 10;
    const below = r.bottom + 6 + h <= window.innerHeight;
    setPos({ top: below ? r.bottom + 6 : Math.max(8, r.top - 6 - h), left: Math.min(r.left, window.innerWidth - 200) });
  }, [open, items.length]);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { const t = e.target as Node; if (!trigger.current?.contains(t) && !menu.current?.contains(t)) setOpen(false); };
    const close = () => setOpen(false);
    document.addEventListener("mousedown", down); window.addEventListener("scroll", close, true); window.addEventListener("resize", close);
    return () => { document.removeEventListener("mousedown", down); window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [open]);
  const selected = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const text = selected.length ? selected.map(labelOf).join(", ") : label;
  const isSel = (t: T) => selected.some(s => keyOf(s) === keyOf(t));
  const single = Array.isArray(value) ? undefined : value;
  if (readOnly) {
    if (compact) return <span title={title ?? `${label}: ${text}`} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 22, height: 22, color: v("text-secondary"), padding: "0 3px" }}>{lead(single)}</span>;
    return <span style={{ display: "inline-flex" }}><Pill tone={emphasis ? "emphasis" : "neutral"} surface={emphasis ? "bare" : "glass"} lead={lead(single)}>{text}</Pill></span>;
  }
  return (
    <div ref={trigger} style={{ display: "inline-flex" }} onClick={e => e.stopPropagation()}>
      {compact
        ? <button type="button" title={title ?? `${label}: ${text}`} aria-label={`${label}: ${text}`} aria-expanded={open} onClick={() => setOpen(o => !o)}
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 22, height: 22, border: 0, borderRadius: 5, background: open ? v("interactive-hover") : "transparent", color: v("text-secondary"), cursor: "pointer", padding: "0 3px" }}
            onMouseEnter={e => (e.currentTarget.style.background = v("interactive-hover"))} onMouseLeave={e => (e.currentTarget.style.background = open ? v("interactive-hover") : "transparent")}>
            {lead(single)}
          </button>
        : <Pill tone={emphasis ? "emphasis" : "neutral"} surface={emphasis ? "bare" : "glass"} caret lead={lead(single)} onClick={() => setOpen(o => !o)} aria-expanded={open}>{text}</Pill>}
      {open && pos ? createPortal(
        <div ref={menu} role="listbox" style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 1000, minWidth: 180, maxHeight: 290, overflowY: "auto", padding: 4, borderRadius: 8, border: `1px solid ${v("border")}`, background: v("bg-floating"), boxShadow: "0 8px 24px rgba(0,0,0,.14)", color: v("text-primary"), fontSize: 13 }}>
          {items.length === 0 ? <div style={{ padding: "6px 8px", color: v("text-secondary") }}>No options</div> : null}
          {items.map(t => (
            <button key={keyOf(t)} type="button" role="option" aria-selected={isSel(t)} onClick={() => { onPick(t); if (!multi) setOpen(false); }} {...hoverable}
              style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px", border: 0, borderRadius: 6, background: "transparent", color: "inherit", font: "inherit", textAlign: "left", cursor: "pointer" }}>
              <span style={{ display: "inline-flex", width: 14, justifyContent: "center", color: v("text-secondary") }}>{lead(t)}</span>
              <span style={{ flex: 1 }}>{labelOf(t)}</span>
              {isSel(t) ? <span style={{ color: v("accent") }}>✓</span> : null}
            </button>
          ))}
        </div>, document.body) : null}
    </div>
  );
}

/* ---------- SaveBar: edits batch behind Save, never a write per click ---------- */
export function SaveBar({ count, saving, onDiscard, onSave, note, savingText, saveText }: { count: number; saving: boolean; onDiscard: () => void; onSave: () => void; note?: string; savingText?: string; saveText?: string }) {
  if (count === 0 && !saving) return note ? <div style={{ ...footer, ...muted, fontSize: 12 }}>{note}</div> : null;
  return (
    <div style={footer}>
      <span style={{ ...muted, fontSize: 12 }}>{saving ? (savingText ?? "Saving…") : `${count} ${count === 1 ? "change" : "changes"}`}</span>
      <span style={{ display: "inline-flex", gap: 8 }}>
        <Button variant="secondary" size="sm" disabled={saving} onClick={onDiscard}>Discard</Button>
        <Button variant="primary" size="sm" disabled={saving || count === 0} onClick={onSave}>{saving ? "Saving…" : (saveText ?? "Save changes")}</Button>
      </span>
    </div>
  );
}

export function GroupHeader({ lead, label, count }: { lead: ReactNode; label: string; count?: number }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 8px", fontSize: 13, fontWeight: 600 }}>{lead}{label}{count !== undefined ? <span style={{ ...muted, fontWeight: 400 }}>{count}</span> : null}</div>;
}
export function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: v("bg-subtle"), overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: v("success") }} /></div>
      <span style={{ ...muted, fontSize: 12, width: 96, textAlign: "right" }}>{done}/{total} done · {pct}%</span>
    </div>
  );
}
/** Expandable multi-line text (markdown-ish, flattened). */
export function LongText({ md, lines: max = 3 }: { md: string; lines?: number }) {
  const [open, setOpen] = useState(false);
  const lines = md.replace(/`/g, "").split("\n").filter(l => l.trim());
  const shown = open ? lines : lines.slice(0, max);
  return (
    <div style={{ ...muted, lineHeight: "22px" }}>
      {shown.map((l, i) => l.startsWith("#") ? <div key={i} style={{ fontWeight: 500, color: v("text-primary"), marginTop: 4 }}>{l.replace(/^#+\s*/, "")}</div> : <div key={i}>{l.replace(/^[*-]\s+/, "• ")}</div>)}
      {lines.length > max ? <button type="button" onClick={() => setOpen(o => !o)} style={{ ...bare, width: "auto", marginTop: 4, fontSize: 12, color: v("text-secondary"), cursor: "pointer" }}>{open ? "Show less" : `Show more (${lines.length - max} lines)`}</button> : null}
    </div>
  );
}
export { Button, Pill };
