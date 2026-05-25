import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import SignupPage from "@/pages/signup";
import DashboardPage from "@/pages/dashboard";
import VenturesPage from "@/pages/ventures";
import SprintsPage from "@/pages/sprints";
import SprintDetailPage from "@/pages/sprint-detail";
import SummaryPage from "@/pages/summary";
import SprintTrackingPage from "@/pages/sprint-tracking";
import SettingsPage from "@/pages/settings";
import AdminImportPage from "@/pages/admin/import";
import AdminTeamPage from "@/pages/admin/team";
import { customFetch } from "@workspace/api-client-react";

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
      <Route path="/ventures">
        <AuthGuard><VenturesPage /></AuthGuard>
      </Route>
      <Route path="/sprints/:id">
        <AuthGuard><SprintDetailPage /></AuthGuard>
      </Route>
      <Route path="/sprints">
        <AuthGuard><SprintsPage /></AuthGuard>
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
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
