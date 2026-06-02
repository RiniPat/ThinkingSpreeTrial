# Frontend wire-up

## 1. Router

In your Wouter router (the App.tsx or main router component):

```tsx
import CohortsPage from "./pages/cohorts";
import CohortDetailPage from "./pages/cohort-detail";

<Switch>
  {/* ...existing routes... */}
  <Route path="/cohorts"      component={CohortsPage} />
  <Route path="/cohorts/:slug" component={CohortDetailPage} />
</Switch>
```

## 2. Sidebar item

In `Layout.tsx` (where the sidebar nav lives), add an item under "Workspace":

```tsx
<NavItem href="/cohorts" icon={Layers} label="Cohorts" />
```

(Use the `Layers` icon from `lucide-react` to match the in-page header.)

## 3. Use the email composer on the sprint detail page

Open `src/pages/sprint-detail.tsx` (referenced in `CHANGES.md`) and replace
the current "Send pre/post-sprint email" button with:

```tsx
import { EmailComposerDialog } from "@/components/email-composer";

const [composerOpen, setComposerOpen] = useState<null | "pre-sprint" | "post-sprint">(null);

// ...in the JSX:
<Button onClick={() => setComposerOpen("post-sprint")}>
  Send post-sprint email
</Button>

<EmailComposerDialog
  open={composerOpen === "post-sprint"}
  onOpenChange={(o) => setComposerOpen(o ? "post-sprint" : null)}
  sprintId={sprint.id}
  kind="post-sprint"
  initialTo={[sprint.founderEmail, sprint.founder2Email].filter(Boolean)}
  initialSubject={`Post-sprint summary — ${sprint.founderName}`}
  initialBodyHtml={postSprintDraftHtml ?? ""}
/>
```

For the pre-sprint button, pass `kind="pre-sprint"` and `disableThreading={true}`
(there's nothing to thread the first email onto).

## 4. shadcn primitives used

Components imported (already present in your project per the README):
`Dialog`, `Button`, `Input`, `Label`, `Textarea`, `Switch`, `Badge`, `Card`.

If `Switch` isn't installed, run:
```bash
pnpm dlx shadcn-ui@latest add switch
```

## 5. Summary Sheet — wire the Wadhwani tab

In `src/pages/summary.tsx`, where you already render ISB / JU tabs, add a
third tab that queries with `?cohortSlug=wadhwani-foundation`:

```tsx
const wadhwani = useQuery({
  queryKey: ["founders", "cohort", "wadhwani-foundation"],
  queryFn: () =>
    fetch("/api/founders?cohortSlug=wadhwani-foundation").then((r) => r.json()),
});
```

This makes the Summary Sheet tab reflect the cohort automatically — when
the sync adds a new company, the Summary tab shows it on the next refetch.
No separate storage, no second source of truth.
