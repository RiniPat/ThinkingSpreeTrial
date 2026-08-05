import { useMemo, useState } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import { Layers, Check, Plus, Trash2, Search, Loader2, Building2 } from "lucide-react";

/**
 * SavedRunsDrawer — one shared, deliberately-subtle surface for revisiting
 * previously-generated work across Research, Pre-Sprint and Competitive
 * Mapping. It lives behind a single header button (with a count badge) and
 * slides in from the right, so past runs are one click away without ever
 * dominating the workspace.
 *
 * Uniformity is the point: every tab renders the *same* component, so the
 * "see my past companies" gesture is identical everywhere. The list is
 * ordered newest-first by the caller (the API already sorts that way), and
 * the currently-open run is pinned to the top and highlighted.
 */
export type SavedRun = {
  id: number | string;
  title: string;
  subtitle?: string | null;
  meta?: string | null;   // e.g. a formatted date or status
  logo?: string | null;
  active?: boolean;
};

export function SavedRunsDrawer({
  triggerLabel,
  title,
  items,
  onOpen,
  onDelete,
  emptyText = "Nothing saved yet.",
  searchable = false,
  loading = false,
  newLabel,
  onNew,
}: {
  triggerLabel: string;
  title: string;
  items: SavedRun[];
  onOpen: (id: number | string) => void;
  onDelete?: (id: number | string) => void;
  emptyText?: string;
  searchable?: boolean;
  loading?: boolean;
  newLabel?: string;
  onNew?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Pin the active run to the top, then keep the caller's (newest-first) order.
  const ordered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? items.filter((i) =>
          `${i.title} ${i.subtitle ?? ""}`.toLowerCase().includes(q))
      : items;
    return [...filtered].sort((a, b) => Number(!!b.active) - Number(!!a.active));
  }, [items, query]);

  function handleOpen(id: number | string) { onOpen(id); setOpen(false); }
  function handleNew() { onNew?.(); setOpen(false); }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-foreground/20"
          data-testid="saved-runs-trigger"
        >
          <Layers size={15} className="text-muted-foreground" />
          {triggerLabel}
          {items.length > 0 && (
            <span className="ml-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
              {items.length}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[340px] sm:w-[380px]">
        <SheetHeader>
          <SheetTitle className="font-serif text-2xl">{title}</SheetTitle>
        </SheetHeader>

        {searchable && (
          <div className="relative mt-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </div>
        )}

        <div className="mt-4 space-y-1.5 overflow-y-auto pr-1" style={{ maxHeight: "calc(100vh - 200px)" }}>
          {loading && (
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          )}
          {!loading && ordered.length === 0 && (
            <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              {query.trim() ? "No matches." : emptyText}
            </div>
          )}
          {ordered.map((it) => (
            <div
              key={it.id}
              className="group flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors"
              style={{
                borderColor: it.active ? "var(--gold, hsl(36 65% 55%))" : "hsl(var(--border))",
                background: it.active ? "hsl(36 65% 96%)" : "hsl(var(--card))",
              }}
            >
              <button onClick={() => handleOpen(it.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md" style={{ background: "hsl(36 65% 94%)" }}>
                  {it.logo
                    ? <img src={it.logo} alt="" className="h-full w-full object-contain" />
                    : <Building2 size={13} style={{ color: "hsl(30 55% 40%)" }} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">{it.title}</span>
                  {it.subtitle && <span className="block truncate text-xs text-muted-foreground">{it.subtitle}</span>}
                  {it.meta && <span className="block truncate text-[11px] text-muted-foreground">{it.meta}</span>}
                </span>
              </button>
              {it.active && <Check size={14} className="shrink-0" style={{ color: "hsl(30 55% 40%)" }} />}
              {onDelete && (
                <button
                  onClick={() => { if (confirm("Delete this saved result? This cannot be undone.")) onDelete(it.id); }}
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                  title="Delete"
                  aria-label="Delete saved result"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>

        {newLabel && onNew && (
          <button
            onClick={handleNew}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold"
            style={{ background: "var(--gold, hsl(36 65% 55%))", color: "hsl(222 38% 15%)" }}
          >
            <Plus size={15} /> {newLabel}
          </button>
        )}
      </SheetContent>
    </Sheet>
  );
}
