// artifacts/thinking-spree/src/components/recipient-input.tsx
//
// Chip-style email recipient input.
// - Press Enter, Tab, or comma to commit the typed email as a chip.
// - Backspace on an empty input removes the last chip.
// - Paste a list of emails (comma/semicolon/space-separated) → all chips at once.
// - Invalid emails get a red ring and aren't accepted.
//
// Drop into `artifacts/thinking-spree/src/components/`.

import { useId, useRef, useState, type KeyboardEvent, type ClipboardEvent } from "react";
import { X, Mail } from "lucide-react";
// ADAPT: your shadcn util path
import { cn } from "@/lib/utils";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type RecipientInputProps = {
    label?: string;
    value: string[];
    onChange: (next: string[]) => void;
    placeholder?: string;
    disabled?: boolean;
    /** Render compactly inside a tight form row (no top label). */
    inline?: boolean;
};

export function RecipientInput({
    label,
    value,
    onChange,
    placeholder = "name@example.com",
    disabled,
    inline,
}: RecipientInputProps) {
    const id = useId();
    const inputRef = useRef<HTMLInputElement>(null);
    const [draft, setDraft] = useState("");
    const [error, setError] = useState<string | null>(null);

    function commit(raw: string) {
        const email = raw.trim().toLowerCase();
        if (!email) return;
        if (!EMAIL_RE.test(email)) {
            setError(`Not a valid email: ${raw}`);
            return;
        }
        if (value.includes(email)) {
            setError(`Already added: ${email}`);
            setDraft("");
            return;
        }
        setError(null);
        onChange([...value, email]);
        setDraft("");
    }

    function commitDraftFlexible() {
        // Allow the field to hold multiple emails at once (paste scenarios).
        const parts = draft.split(/[,;\s]+/).filter(Boolean);
        if (parts.length === 0) return;
        const next = [...value];
        let firstError: string | null = null;
        for (const part of parts) {
            const e = part.trim().toLowerCase();
            if (!e) continue;
            if (!EMAIL_RE.test(e)) {
                firstError ??= `Not a valid email: ${part}`;
                continue;
            }
            if (next.includes(e)) continue;
            next.push(e);
        }
        onChange(next);
        setDraft("");
        setError(firstError);
    }

    function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
        if (e.key === "Enter" || e.key === "Tab" || e.key === ",") {
            if (draft.trim()) {
                e.preventDefault();
                commitDraftFlexible();
            }
        } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
            // Pop the last chip on backspace at empty input.
            onChange(value.slice(0, -1));
        }
    }

    function onPaste(e: ClipboardEvent<HTMLInputElement>) {
        const text = e.clipboardData.getData("text");
        if (!text) return;
        if (/[,;\s]/.test(text)) {
            e.preventDefault();
            setDraft(text);
            // Defer one tick so the state lands, then commit.
            queueMicrotask(commitDraftFlexible);
        }
    }

    function removeAt(i: number) {
        const next = value.slice();
        next.splice(i, 1);
        onChange(next);
        inputRef.current?.focus();
    }

    return (
        <div className={inline ? "flex items-start gap-3" : "space-y-1.5"}>
            {label ? (
                <label
                    htmlFor={id}
                    className={cn(
                        "text-xs font-medium text-muted-foreground",
                        inline ? "pt-2 w-12 shrink-0" : "block",
                    )}
                >
                    {label}
                </label>
            ) : null}
            <div
                className={cn(
                    "flex-1 flex flex-wrap items-center gap-1.5 min-h-9 rounded-md border bg-background px-2 py-1.5 transition",
                    "focus-within:ring-2 focus-within:ring-ring focus-within:border-ring",
                    error ? "border-destructive ring-1 ring-destructive/30" : "border-input",
                    disabled && "opacity-60 pointer-events-none",
                )}
                onClick={() => inputRef.current?.focus()}
            >
                {value.map((email, i) => (
                    <span
                        key={email + i}
                        className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs"
                    >
                        <Mail className="h-3 w-3 opacity-60" aria-hidden />
                        <span className="font-mono">{email}</span>
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                removeAt(i);
                            }}
                            className="ml-0.5 rounded-full hover:bg-background/80 p-0.5"
                            aria-label={`Remove ${email}`}
                        >
                            <X className="h-3 w-3" />
                        </button>
                    </span>
                ))}
                <input
                    id={id}
                    ref={inputRef}
                    value={draft}
                    placeholder={value.length === 0 ? placeholder : ""}
                    onChange={(e) => {
                        setError(null);
                        setDraft(e.target.value);
                    }}
                    onKeyDown={onKeyDown}
                    onBlur={() => draft.trim() && commitDraftFlexible()}
                    onPaste={onPaste}
                    className="flex-1 min-w-32 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={disabled}
                />
            </div>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
    );
}
