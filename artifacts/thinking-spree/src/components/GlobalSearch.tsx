import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Search, Building2, Users, FileText, Sparkles, X, Loader2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type ResultKind = "company" | "lead" | "research" | "proposal";
type Result = {
  id: number;
  kind: ResultKind;
  title: string;
  subtitle: string | null;
  href: string;
};

const KIND_META: Record<ResultKind, { label: string; Icon: React.ElementType; color: string }> = {
  company:  { label: "Company",  Icon: Building2, color: "text-blue-700 bg-blue-50" },
  lead:     { label: "Lead",     Icon: Users,     color: "text-violet-700 bg-violet-50" },
  research: { label: "Research", Icon: Sparkles,  color: "text-emerald-700 bg-emerald-50" },
  proposal: { label: "Proposal", Icon: FileText,  color: "text-amber-700 bg-amber-50" },
};

/**
 * Global search input + dropdown results panel.
 *
 * Behaviour:
 *   - Debounced 200ms so we don't spam the server on every keystroke
 *   - Closes on outside click or Esc
 *   - Cmd/Ctrl+K opens it (focuses the input)
 *   - Shows max 8 results per kind, grouped under headings
 */
export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce the query so we hit the server only when the user pauses typing.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  // Outside-click and Esc close
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setOpen(false); inputRef.current?.blur(); }
      // Cmd/Ctrl+K focuses the input
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const { data, isFetching } = useQuery<{ results: Result[] }>({
    queryKey: ["/api/search", debounced],
    queryFn: () => customFetch(`${BASE}/api/search?q=${encodeURIComponent(debounced)}`, { credentials: "include" }),
    enabled: debounced.length >= 2,
    staleTime: 10_000,
  });

  // Group results by kind for headed dropdown
  const grouped: Record<ResultKind, Result[]> = { company: [], lead: [], research: [], proposal: [] };
  for (const r of data?.results ?? []) grouped[r.kind].push(r);

  const showDropdown = open && debounced.length >= 2;
  const totalResults = (data?.results ?? []).length;

  return (
    <div ref={wrapRef} className="relative flex-1 max-w-md">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search companies, leads, research… (⌘K)"
        className="w-full pl-9 pr-9 py-1.5 bg-card border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring"
      />
      {query && (
        <button
          onClick={() => { setQuery(""); inputRef.current?.focus(); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted"
          aria-label="Clear search"
        >
          <X className="h-3 w-3" />
        </button>
      )}

      {showDropdown && (
        <div className="absolute top-full mt-1.5 left-0 right-0 rounded-lg border border-border bg-card shadow-lg z-40 max-h-[480px] overflow-y-auto">
          {isFetching && totalResults === 0 ? (
            <div className="px-4 py-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Searching…
            </div>
          ) : totalResults === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              No results for "<span className="font-medium">{debounced}</span>"
            </div>
          ) : (
            (Object.keys(grouped) as ResultKind[]).map(kind => {
              const items = grouped[kind];
              if (items.length === 0) return null;
              const meta = KIND_META[kind];
              return (
                <div key={kind} className="border-t first:border-t-0 border-border">
                  <div className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                    {meta.label}
                    <span className="ml-1.5 opacity-60 tabular-nums">{items.length}</span>
                  </div>
                  <ul>
                    {items.map(r => (
                      <li key={`${r.kind}-${r.id}`}>
                        <Link href={r.href}>
                          <a
                            onClick={() => { setOpen(false); setQuery(""); }}
                            className="flex items-center gap-2.5 px-4 py-2 hover:bg-muted/40 transition cursor-pointer"
                          >
                            <span className={`rounded-md p-1.5 ${meta.color} flex-shrink-0`}>
                              <meta.Icon className="h-3.5 w-3.5" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium text-foreground truncate">{r.title}</div>
                              {r.subtitle && <div className="text-[11px] text-muted-foreground truncate">{r.subtitle}</div>}
                            </div>
                          </a>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
