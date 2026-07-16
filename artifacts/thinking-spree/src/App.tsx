import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import SignupPage from "@/pages/signup";
import DashboardPage from "@/pages/dashboard";
import CompaniesPage from "@/pages/companies";
import CompanyDetailPage from "@/pages/company-detail";
import SummaryPage from "@/pages/summary";
import SprintTrackingPage from "@/pages/sprint-tracking";
import SettingsPage from "@/pages/settings";
import AdminImportPage from "@/pages/admin/import";
import AdminTeamPage from "@/pages/admin/team";
import AdminRolesPage from "@/pages/admin/roles";
import ResearchPage from "@/pages/research";
import SalesLeadsPage from "@/pages/sales-leads";
import LinkedInOutreachPage from "@/pages/linkedin-outreach";
import ProposalBuilderPage from "@/pages/proposal-builder";
import OutcomesReportPage from "@/pages/outcomes-report";
import BuilderPage from "@/pages/builder";
import PreSprintPage from "@/pages/pre-sprint";
import PostSprintPage from "@/pages/post-sprint";
import InspirationResearchPage from "@/pages/research-inspiration";
import { customFetch } from "@workspace/api-client-react";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
});

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading, isError, isFetching } = useQuery({
    queryKey: ["me"],
    queryFn: () =>
      customFetch(`${BASE}/api/auth/me`, { credentials: "include" }),
    retry: false,
    staleTime: 30_000,
  });

  if (isLoading || isFetching) {
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
      <Route path="/post-sprint">
        <AuthGuard><PostSprintPage /></AuthGuard>
      </Route>
      <Route path="/sales" component={() => <Redirect to="/sales/leads" />} />
      <Route path="/admin" component={() => <Redirect to="/admin/import" />} />
      <Route path="/companies/:id">
        <AuthGuard><CompanyDetailPage /></AuthGuard>
      </Route>
      <Route path="/companies">
        <AuthGuard><CompaniesPage /></AuthGuard>
      </Route>
      {/* Legacy /ventures and /sprints URLs redirect to the new Companies page
          so bookmarks and old links keep working. */}
      <Route path="/ventures" component={() => <Redirect to="/companies" />} />
      <Route path="/sprints" component={() => <Redirect to="/companies" />} />
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
      <Route path="/research/tools">
        <AuthGuard><ResearchPage /></AuthGuard>
      </Route>
      <Route path="/sales/leads">
        <AuthGuard><SalesLeadsPage /></AuthGuard>
      </Route>
      <Route path="/sales/linkedin">
        <AuthGuard><LinkedInOutreachPage /></AuthGuard>
      </Route>
      <Route path="/sales/proposals">
        <AuthGuard><ProposalBuilderPage /></AuthGuard>
      </Route>
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
