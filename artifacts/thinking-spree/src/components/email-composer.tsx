// artifacts/thinking-spree/src/components/email-composer.tsx
//
// Sprint email composer.
// - Multi-recipient (To / Cc / Bcc) via chips
// - Auto-detects whether a pre-sprint email exists for this sprint and
//   defaults to threading the post-sprint email as a reply
// - "Thread it" toggle — opt out if needed
// - Subject auto-prepends "Re:" when threading
//
// Wire into your sprint detail page (artifacts/thinking-spree/src/pages/sprint-detail.tsx):
//
//   const [open, setOpen] = useState(false);
//   <Button onClick={() => setOpen(true)}>Send post-sprint email</Button>
//   <EmailComposerDialog
//     open={open}
//     onOpenChange={setOpen}
//     sprintId={sprint.id}
//     kind="post-sprint"
//     initialTo={[sprint.founderEmail].filter(Boolean)}
//     initialSubject={`Post-sprint summary — ${sprint.founderName}`}
//   />

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CornerDownRight, Loader2, Send } from "lucide-react";

// ADAPT: shadcn/ui paths (these are the standard scaffold paths)
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

import { RecipientInput } from "./recipient-input";

type EmailKind = "pre-sprint" | "post-sprint" | "check-in" | "other";

type ThreadAnchor = {
    id: number;
    messageId: string | null;
    subject: string;
    sentAt: string;
    recipientsTo: string[];
    recipientsCc: string[];
};

export type EmailComposerProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    sprintId: number;
    kind: EmailKind;
    initialTo?: string[];
    initialCc?: string[];
    initialBcc?: string[];
    initialSubject?: string;
    initialBodyHtml?: string;
    /** Default the threading toggle off (e.g. for pre-sprint emails which have nothing to reply to anyway). */
    disableThreading?: boolean;
};

export function EmailComposerDialog(props: EmailComposerProps) {
    const {
        open,
        onOpenChange,
        sprintId,
        kind,
        initialTo = [],
        initialCc = [],
        initialBcc = [],
        initialSubject = "",
        initialBodyHtml = "",
        disableThreading = false,
    } = props;

    const qc = useQueryClient();

    const [to, setTo] = useState<string[]>(initialTo);
    const [cc, setCc] = useState<string[]>(initialCc);
    const [bcc, setBcc] = useState<string[]>(initialBcc);
    const [showCc, setShowCc] = useState(initialCc.length > 0);
    const [showBcc, setShowBcc] = useState(initialBcc.length > 0);
    const [subject, setSubject] = useState(initialSubject);
    const [bodyHtml, setBodyHtml] = useState(initialBodyHtml);
    const [threadIt, setThreadIt] = useState(!disableThreading && kind === "post-sprint");

    // Reset on re-open in case the parent passed new initials.
    useEffect(() => {
        if (open) {
            setTo(initialTo);
            setCc(initialCc);
            setBcc(initialBcc);
            setShowCc(initialCc.length > 0);
            setShowBcc(initialBcc.length > 0);
            setSubject(initialSubject);
            setBodyHtml(initialBodyHtml);
            setThreadIt(!disableThreading && kind === "post-sprint");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Look up the pre-sprint anchor when this is a post-sprint email.
    const anchorQuery = useQuery({
        queryKey: ["sprint-email-anchor", sprintId, "pre-sprint"],
        enabled: open && kind === "post-sprint" && !disableThreading,
        queryFn: async (): Promise<ThreadAnchor | null> => {
            const r = await fetch(`/api/sprints/${sprintId}/emails/thread-anchor?kind=pre-sprint`);
            if (!r.ok) throw new Error("Failed to load thread anchor");
            const j = (await r.json()) as { anchor: ThreadAnchor | null };
            return j.anchor;
        },
    });

    const sendMutation = useMutation({
        mutationFn: async () => {
            const r = await fetch(`/api/sprints/${sprintId}/emails`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    kind,
                    to,
                    cc: showCc ? cc : [],
                    bcc: showBcc ? bcc : [],
                    subject,
                    bodyHtml,
                    threadReplyTo: threadIt && anchorQuery.data ? "pre-sprint" : null,
                }),
            });
            if (!r.ok) {
                const j = await r.json().catch(() => ({}));
                throw new Error(j.error?.formErrors?.[0] ?? j.error ?? `Send failed (${r.status})`);
            }
            return r.json();
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["sprint-emails", sprintId] });
            onOpenChange(false);
        },
    });

    const subjectDisplay = useMemo(() => {
        if (threadIt && anchorQuery.data) {
            return /^re:\s/i.test(subject) ? subject : subject;
        }
        return subject;
    }, [subject, threadIt, anchorQuery.data]);

    const anchor = anchorQuery.data;
    const canThread = !disableThreading && kind === "post-sprint" && !!anchor?.messageId;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="font-serif">
                        {kind === "post-sprint"
                            ? "Send post-sprint email"
                            : kind === "pre-sprint"
                                ? "Send pre-sprint email"
                                : "Send email"}
                    </DialogTitle>
                </DialogHeader>

                {/* Threading banner — only shown when there's a real anchor */}
                {canThread ? (
                    <ThreadBanner
                        anchor={anchor!}
                        active={threadIt}
                        onToggle={() => setThreadIt((v) => !v)}
                    />
                ) : null}

                <div className="space-y-3">
                    <RecipientInput label="To" value={to} onChange={setTo} inline />

                    {showCc ? (
                        <RecipientInput label="Cc" value={cc} onChange={setCc} inline />
                    ) : (
                        <button
                            type="button"
                            className="text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => setShowCc(true)}
                        >
                            + Add Cc
                        </button>
                    )}

                    {showBcc ? (
                        <RecipientInput label="Bcc" value={bcc} onChange={setBcc} inline />
                    ) : (
                        <button
                            type="button"
                            className="text-xs text-muted-foreground hover:text-foreground ml-3"
                            onClick={() => setShowBcc(true)}
                        >
                            + Add Bcc
                        </button>
                    )}

                    <div className="flex items-center gap-3">
                        <Label htmlFor="subj" className="text-xs w-12 shrink-0 text-muted-foreground">
                            Subject
                        </Label>
                        <div className="flex-1 flex items-center gap-2">
                            {threadIt && canThread ? (
                                <Badge variant="secondary" className="font-mono text-xs">
                                    Re:
                                </Badge>
                            ) : null}
                            <Input
                                id="subj"
                                value={subjectDisplay}
                                onChange={(e) => setSubject(e.target.value)}
                                placeholder="Subject"
                            />
                        </div>
                    </div>

                    <Textarea
                        value={bodyHtml}
                        onChange={(e) => setBodyHtml(e.target.value)}
                        rows={10}
                        placeholder="Write your email…"
                        className="font-sans text-sm"
                    />
                </div>

                {sendMutation.error ? (
                    <p className="text-sm text-destructive">
                        {(sendMutation.error as Error).message}
                    </p>
                ) : null}

                <DialogFooter className="flex items-center justify-between gap-2 pt-2">
                    <div className="text-xs text-muted-foreground">
                        {to.length + (showCc ? cc.length : 0) + (showBcc ? bcc.length : 0)} recipient
                        {to.length + (showCc ? cc.length : 0) + (showBcc ? bcc.length : 0) === 1 ? "" : "s"}
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button
                            onClick={() => sendMutation.mutate()}
                            disabled={
                                sendMutation.isPending ||
                                to.length === 0 ||
                                subject.trim() === "" ||
                                bodyHtml.trim() === ""
                            }
                        >
                            {sendMutation.isPending ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <Send className="mr-2 h-4 w-4" />
                            )}
                            {threadIt && canThread ? "Send as reply" : "Send"}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function ThreadBanner({
    anchor,
    active,
    onToggle,
}: {
    anchor: ThreadAnchor;
    active: boolean;
    onToggle: () => void;
}) {
    return (
        <div className="flex items-start gap-3 rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5">
            <CornerDownRight className="h-4 w-4 mt-0.5 text-primary" aria-hidden />
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-primary">
                    {active ? "Replying to pre-sprint thread" : "Pre-sprint thread available"}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                    "{anchor.subject}" · sent{" "}
                    {new Date(anchor.sentAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                    })}{" "}
                    to {anchor.recipientsTo.length} recipient
                    {anchor.recipientsTo.length === 1 ? "" : "s"}
                </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
                <Label htmlFor="thread-toggle" className="text-xs text-primary cursor-pointer">
                    Thread it
                </Label>
                <Switch id="thread-toggle" checked={active} onCheckedChange={onToggle} />
            </div>
        </div>
    );
}
