import { useState, useEffect } from "react";
import { Layout } from "@/components/Layout";
import { useGetMe, customFetch } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Redirect } from "wouter";
import {
  Users, ShieldCheck, User, Mail, Loader2, ChevronDown,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type TeamUser = {
  id: number;
  email: string;
  name: string;
  role: "admin" | "consultant";
  avatarUrl: string | null;
  isAdmin: boolean;
  hasGoogleAccount: boolean;
};

export default function AdminTeamPage() {
  const { data: me, isLoading: meLoading } = useGetMe();
  const { toast } = useToast();
  const [users, setUsers] = useState<TeamUser[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  async function loadUsers() {
    setLoading(true);
    try {
      const data = await customFetch<TeamUser[]>(`${BASE}/api/auth/users`, { credentials: "include" });
      setUsers(data);
    } catch (err: any) {
      toast({ title: "Couldn't load team", description: err?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if ((me as any)?.isAdmin) loadUsers(); }, [me]);

  if (meLoading) return <Layout><div className="p-6">Loading…</div></Layout>;
  if (!(me as any)?.isAdmin) return <Redirect to="/dashboard" />;

  async function setRole(u: TeamUser, role: "admin" | "consultant") {
    setUpdatingId(u.id);
    try {
      const updated = await customFetch<TeamUser>(`${BASE}/api/auth/users/${u.id}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
        credentials: "include",
      });
      setUsers(list => list?.map(x => x.id === updated.id ? updated : x) ?? null);
      toast({
        title: role === "admin" ? "Promoted to admin" : "Demoted to consultant",
        description: u.name,
      });
    } catch (err: any) {
      toast({ title: "Update failed", description: err?.message, variant: "destructive" });
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <Layout>
      <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Team Management</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Promote consultants to admin or demote admins. The last remaining admin can't be demoted.
          </p>
        </div>

        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center gap-2">
            <Users size={14} className="text-primary" />
            <h2 className="text-sm font-semibold text-foreground">All members</h2>
            <span className="text-xs text-muted-foreground ml-2">
              {users ? `${users.length} total` : ""}
            </span>
          </div>
          {loading ? (
            <div className="p-8 flex items-center justify-center text-muted-foreground text-sm gap-2">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : !users || users.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">No team members yet</div>
          ) : (
            <ul className="divide-y divide-border">
              {users.map(u => {
                const isMe = (me as any)?.id === u.id;
                return (
                  <li key={u.id} className="px-5 py-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm flex-shrink-0">
                      {u.avatarUrl
                        ? <img src={u.avatarUrl} alt="" className="w-full h-full rounded-full object-cover" />
                        : u.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">
                        {u.name}{isMe && <span className="text-xs text-muted-foreground"> · you</span>}
                      </p>
                      <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                        <Mail size={10} />{u.email}
                        {u.hasGoogleAccount && (
                          <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                            Google
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex-shrink-0">
                      <div className="relative inline-block">
                        <select
                          value={u.role}
                          disabled={updatingId === u.id}
                          onChange={e => setRole(u, e.target.value as any)}
                          className="appearance-none pl-3 pr-8 py-1.5 text-xs font-medium bg-background border border-input rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 cursor-pointer"
                        >
                          <option value="consultant">Consultant</option>
                          <option value="admin">Admin</option>
                        </select>
                        <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                      </div>
                    </div>
                    {u.role === "admin" && (
                      <span title="Admin">
                        <ShieldCheck size={14} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <p className="text-xs text-muted-foreground mt-4">
          Note: when a new user signs up, they're a consultant by default. The very first user becomes admin automatically.
        </p>
      </div>
    </Layout>
  );
}
