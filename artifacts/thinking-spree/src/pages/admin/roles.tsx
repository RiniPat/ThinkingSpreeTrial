import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Shield } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type User = { id: number; name: string; email: string; role: string; createdAt: string };

export default function AdminRolesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ users: User[] }>({
    queryKey: ["/api/admin/users"],
    queryFn: () => customFetch(`${BASE}/api/admin/users`, { credentials: "include" }),
  });

  const mut = useMutation({
    mutationFn: async ({ id, role }: { id: number; role: string }) => {
      const res = await fetch(`${BASE}/api/admin/users/${id}/role`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Update failed");
    },
    onSuccess: () => {
      toast({ title: "Role updated" });
      qc.invalidateQueries({ queryKey: ["/api/admin/users"] });
      qc.invalidateQueries({ queryKey: ["/api/me/permissions"] });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  return (
    <Layout>
      <main className="flex-1 space-y-6 px-6 py-8 lg:px-10 max-w-[1100px] mx-auto">
        <section>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Admin</div>
          <h1 className="mt-2 font-serif text-4xl text-foreground">User Roles</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Assign one role per user. Consultants see everything. Sales / Research see only their respective tabs.
          </p>
        </section>

        <section className="rounded-xl border border-border bg-card overflow-hidden">
          {isLoading ? (
            <div className="p-5 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 rounded" />)}</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Role</th>
                </tr>
              </thead>
              <tbody>
                {(data?.users ?? []).map(u => (
                  <tr key={u.id} className="border-t border-border">
                    <td className="px-4 py-3 font-medium">{u.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                    <td className="px-4 py-3">
                      <select
                        value={u.role}
                        onChange={(e) => mut.mutate({ id: u.id, role: e.target.value })}
                        className="text-xs bg-background border border-input rounded px-2 py-1"
                      >
                        <option value="consultant">Consultant</option>
                        <option value="sales">Sales</option>
                        <option value="research">Research</option>
                        <option value="ops">Ops</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-xs text-blue-900 flex items-start gap-2">
          <Shield className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <div>
            <strong>Role definitions:</strong> Consultant sees everything (Companies, Summary, Sprint Tracking, Research, Sales) but in Sales follow-ups is scoped to companies they hosted or co-hosted. Sales sees only Sales tools (all cohorts). Research sees only Research tools. Ops sees the Sales tab across all cohorts/consultants plus the Operations tracking view (per-consultant follow-up progress); not a full admin. Admin sees everything + can manage roles.
          </div>
        </div>

        <footer className="pt-2 text-center text-xs text-muted-foreground">Thinking Spree · Consultant Suite v5.0</footer>
      </main>
    </Layout>
  );
}
