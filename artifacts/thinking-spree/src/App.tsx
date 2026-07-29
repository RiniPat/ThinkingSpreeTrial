import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import SignupPage from "@/pages/signup";
import DashboardPage from "@/pages/dashboard";
import CompanyDetailPage from "@/pages/company-detail";
import SummaryPage from "@/pages/summary";
import SprintTrackingPage from "@/pages/sprint-tracking";
import SettingsPage from "@/pages/settings";
import AdminImportPage from "@/pages/admin/import";
import AdminHomePage from "@/pages/admin/home";
import AdminTeamPage from "@/pages/admin/team";
import AdminRolesPage from "@/pages/admin/roles";
import ResearchPage from "@/pages/research";
import SalesInboxPage from "@/pages/sales-inbox";
import OutcomesReportPage from "@/pages/outcomes-report";
import BuilderPage from "@/pages/builder";
import PreSprintPage from "@/pages/pre-sprint";
import EmailsPage from "@/pages/emails";
import PostSprintPage from "@/pages/post-sprint";
import InspirationResearchPage from "@/pages/research-inspiration";
import CompetitiveMappingPage from "@/pages/competitive-mapping";
import { customFetch } from "@workspace/api-client-react";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const queryClient = new QueryClient({
  defaultOptions: {
    // refetchOnWindowFocus was silently re-running the `me` query every time
    // the browser tab regained focus. Combined with the AuthGuard below (which
    // used to show a skeleton on every *fetch*, not just the first load) it
    // unmounted the whole page and wiped in-progress state. Turning it off —
    // and gating the guard on first load only — keeps the screen exactly as
    // the consultant left it when they switch tabs and come back.
    queries: { retry: false, refetchOnWindowFocus: false },
  },
});

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading, isError } = useQuery({
    queryKey: ["me"],
    queryFn: () =>
      customFetch(`${BASE}/api/auth/me`, { credentials: "include" }),
    retry: false,
    staleTime: 30_000,
  });

  // Only block on the *initial* load (no cached user yet). A background
  // revalidation must never unmount the page underneath the consultant.
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="space-y-3 w-64">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    );
  }

  if (isError || !user) {
    return <Redirect to="/login" />;
  }

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/signup" component={SignupPage} />
      <Route path="/" component={() => <Redirect to="/dashboard" />} />
      <Route path="/dashboard">
        <AuthGuard><DashboardPage /></AuthGuard>
      </Route>
      <Route path="/pre-sprint">
        <AuthGuard><PreSprintPage /></AuthGuard>
      </Route>
      <Route path="/emails">
        <AuthGuard><EmailsPage /></AuthGuard>
      </Route>
      <Route path="/post-sprint">
        <AuthGuard><PostSprintPage /></AuthGuard>
      </Route>
      <Route path="/sales">
        <AuthGuard><SalesInboxPage /></AuthGuard>
      </Route>
      <Route path="/admin">
        <AuthGuard><AdminHomePage /></AuthGuard>
      </Route>
      <Route path="/companies/:id">
        <AuthGuard><CompanyDetailPage /></AuthGuard>
      </Route>
      <Route path="/companies">
        {/* The Companies list page has been retired. Sprint Tracking is the
            master list now; deep links to a specific company still work via
            /companies/:id (used by Summary, Sprint Tracking & Growth Report). */}
        <Redirect to="/sprint-tracking" />
      </Route>
      {/* Legacy /ventures and /sprints URLs now land on Sprint Tracking. */}
      <Route path="/ventures" component={() => <Redirect to="/sprint-tracking" />} />
      <Route path="/sprints" component={() => <Redirect to="/sprint-tracking" />} />
      <Route path="/sprints/:id">
        {(params: { id: string }) => <Redirect to={`/companies/${params.id}`} />}
      </Route>
      <Route path="/summary">
        <AuthGuard><SummaryPage /></AuthGuard>
      </Route>
      <Route path="/sprint-tracking">
        <AuthGuard><SprintTrackingPage /></AuthGuard>
      </Route>
      <Route path="/settings">
        <AuthGuard><SettingsPage /></AuthGuard>
      </Route>
      <Route path="/admin/import">
        <AuthGuard><AdminImportPage /></AuthGuard>
      </Route>
      <Route path="/admin/team">
        <AuthGuard><AdminTeamPage /></AuthGuard>
      </Route>
      <Route path="/admin/roles">
        <AuthGuard><AdminRolesPage /></AuthGuard>
      </Route>
      <Route path="/research">
        <AuthGuard><InspirationResearchPage /></AuthGuard>
      </Route>
      <Route path="/competitive-mapping">
        <AuthGuard><CompetitiveMappingPage /></AuthGuard>
      </Route>
      <Route path="/research/tools">
        <AuthGuard><ResearchPage /></AuthGuard>
      </Route>
      {/* Sales Leads, LinkedIn Outreach & Proposal Builder were retired in
          favour of the Inbox CRM. Legacy URLs redirect to /sales. */}
      <Route path="/sales/leads" component={() => <Redirect to="/sales" />} />
      <Route path="/sales/linkedin" component={() => <Redirect to="/sales" />} />
      <Route path="/sales/proposals" component={() => <Redirect to="/sales" />} />
      <Route path="/reports/outcomes">
        <AuthGuard><OutcomesReportPage /></AuthGuard>
      </Route>
      <Route path="/builder">
        <AuthGuard><BuilderPage /></AuthGuard>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <ErrorBoundary>
            <Router />
          </ErrorBoundary>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
