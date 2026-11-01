"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  Info,
  Building,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VoiceSearchButton } from "@/components/ui/voice-search-button";
import {
  getAdminUsersAction,
  adminSetUserRoleAction,
  adminSetUserActiveAction,
  type AdminUserRow,
  type AdminUsersListResult,
  type CanteenData,
} from "@/server/actions/admin";

interface UsersViewProps {
  initialData: AdminUsersListResult;
  canteens: CanteenData[];
}

export function UsersView({ initialData, canteens }: UsersViewProps) {
  const [data, setData] = useState<AdminUsersListResult>(initialData);
  const [search, setSearch] = useState("");
  const [selectedRole, setSelectedRole] = useState<string>("ALL");
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);

  // Role Edit Dialog
  const [activeUser, setActiveUser] = useState<AdminUserRow | null>(null);
  const [newRole, setNewRole] = useState<"student" | "staff" | "admin">("student");
  const [newCanteenId, setNewCanteenId] = useState<string>(canteens[0]?.id || "");
  const [isUpdating, setIsUpdating] = useState(false);

  const fetchUsers = async (targetPage: number, targetSearch: string, targetRole: string) => {
    setIsLoading(true);
    try {
      const res = await getAdminUsersAction({
        page: targetPage,
        limit: 25,
        search: targetSearch.trim() || undefined,
        role: targetRole !== "ALL" ? (targetRole as "student" | "staff" | "admin") : undefined,
      });
      if (res.success && res.data) {
        setData(res.data);
        setPage(targetPage);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchUsers(1, search, selectedRole);
  };

  const handleRoleFilter = (role: string) => {
    setSelectedRole(role);
    fetchUsers(1, search, role);
  };

  const openRoleModal = (user: AdminUserRow) => {
    setActiveUser(user);
    setNewRole(user.role as "student" | "staff" | "admin");
    setNewCanteenId(user.canteen_id || canteens[0]?.id || "");
  };

  const handleRoleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeUser) return;

    setIsUpdating(true);
    try {
      const res = await adminSetUserRoleAction(
        activeUser.id,
        newRole,
        newRole === "staff" ? newCanteenId : null
      );
      if (res.success) {
        toast.success(`Role for ${activeUser.full_name || activeUser.email} updated to ${newRole}`);
        const canteenName = canteens.find((c) => c.id === newCanteenId)?.name || null;
        setData((prev) => ({
          ...prev,
          users: prev.users.map((u) =>
            u.id === activeUser.id
              ? {
                  ...u,
                  role: newRole,
                  canteen_id: newRole === "staff" ? newCanteenId : null,
                  canteen_name: newRole === "staff" ? canteenName : null,
                }
              : u
          ),
        }));
        setActiveUser(null);
      } else {
        toast.error(res.error || "Failed to update user role");
      }
    } finally {
      setIsUpdating(false);
    }
  };

  const handleToggleActive = async (user: AdminUserRow) => {
    const nextStatus = !user.is_active;
    const actionLabel = nextStatus ? "reactivate" : "deactivate";

    if (!confirm(`Are you sure you want to ${actionLabel} ${user.full_name || user.email}?`)) {
      return;
    }

    try {
      const res = await adminSetUserActiveAction(user.id, nextStatus);
      if (res.success) {
        toast.success(`Account ${nextStatus ? "reactivated" : "deactivated"} successfully`);
        setData((prev) => ({
          ...prev,
          users: prev.users.map((u) =>
            u.id === user.id ? { ...u, is_active: nextStatus } : u
          ),
        }));
      } else {
        toast.error(res.error || `Failed to ${actionLabel} user`);
      }
    } catch {
      toast.error(`Network error attempting to ${actionLabel} user`);
    }
  };

  const totalPages = Math.ceil((data.total_count || 0) / 25) || 1;

  const getRoleBadge = (role: string) => {
    switch (role) {
      case "admin":
        return <Badge className="bg-purple-600 text-white font-semibold">Admin</Badge>;
      case "staff":
        return <Badge className="bg-amber-600 text-white font-semibold">Staff</Badge>;
      default:
        return <Badge variant="secondary">Student</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">User Management</h1>
          <p className="text-xs text-muted-foreground">
            Manage user roles, canteen assignments, and account active statuses.
          </p>
        </div>

        <Badge variant="outline" className="text-xs font-mono font-medium self-start sm:self-auto">
          {data.total_count.toLocaleString()} Registered Accounts
        </Badge>
      </div>

      {/* Role Session Note */}
      <div className="p-3.5 rounded-xl border border-primary/20 bg-primary/5 text-xs flex items-start gap-3">
        <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <p className="text-muted-foreground leading-relaxed">
          <strong className="text-foreground">Session Invalidation:</strong> Role updates and account activations take effect on the user&apos;s next request.
        </p>
      </div>

      {/* Filter and Search */}
      <div className="flex flex-col sm:flex-row gap-3">
        <form onSubmit={handleSearch} className="flex-1 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by email, name, or college ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-10 h-10"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center">
              <VoiceSearchButton
                size="sm"
                onSearch={(transcript) => {
                  setSearch(transcript);
                  fetchUsers(1, transcript, selectedRole);
                }}
              />
            </div>
          </div>
          <Button type="submit" disabled={isLoading} className="h-10 text-xs font-semibold px-4">
            Search
          </Button>
        </form>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          {["ALL", "student", "staff", "admin"].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => handleRoleFilter(r)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg capitalize transition-colors border ${
                selectedRole === r
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border/60 hover:text-foreground"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Users Table */}
      <Card className="border shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-muted/50 border-b text-muted-foreground font-semibold">
              <tr>
                <th className="p-3 pl-4">Name / Email</th>
                <th className="p-3">College ID</th>
                <th className="p-3">Role</th>
                <th className="p-3">Assigned Canteen</th>
                <th className="p-3">Status</th>
                <th className="p-3 pr-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {data.users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-muted-foreground">
                    No users found matching your search.
                  </td>
                </tr>
              ) : (
                data.users.map((user) => (
                  <tr key={user.id} className="hover:bg-muted/30 transition-colors">
                    <td className="p-3 pl-4">
                      <div className="font-semibold text-foreground">
                        {user.full_name || "Anonymous Member"}
                      </div>
                      <div className="text-[11px] text-muted-foreground font-mono">
                        {user.email}
                      </div>
                    </td>
                    <td className="p-3 font-mono text-muted-foreground">
                      {user.college_id || "--"}
                    </td>
                    <td className="p-3">
                      {getRoleBadge(user.role)}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {user.canteen_name ? (
                        <span className="flex items-center gap-1">
                          <Building className="h-3 w-3" />
                          {user.canteen_name}
                        </span>
                      ) : (
                        "--"
                      )}
                    </td>
                    <td className="p-3">
                      {user.is_active ? (
                        <Badge variant="outline" className="border-emerald-500 text-emerald-600 dark:text-emerald-400">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="destructive">Deactivated</Badge>
                      )}
                    </td>
                    <td className="p-3 pr-4 text-right space-x-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openRoleModal(user)}
                        className="h-7 text-xs"
                      >
                        Change Role
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleActive(user)}
                        className={`h-7 text-xs ${
                          user.is_active
                            ? "text-destructive hover:bg-destructive/10"
                            : "text-emerald-600 hover:bg-emerald-500/10"
                        }`}
                      >
                        {user.is_active ? "Deactivate" : "Activate"}
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="p-3 border-t bg-muted/20 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || isLoading}
              onClick={() => fetchUsers(page - 1, search, selectedRole)}
              className="h-8 gap-1 text-xs"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || isLoading}
              onClick={() => fetchUsers(page + 1, search, selectedRole)}
              className="h-8 gap-1 text-xs"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </Card>

      {/* Role Change Modal */}
      {activeUser && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <Card className="w-full max-w-md shadow-xl animate-in fade-in zoom-in-95">
            <CardHeader className="pb-3 border-b flex flex-row items-center justify-between">
              <CardTitle className="text-base">Change Role</CardTitle>
              <button
                type="button"
                onClick={() => setActiveUser(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </CardHeader>
            <form onSubmit={handleRoleSave}>
              <CardContent className="pt-4 space-y-4">
                <div className="text-xs rounded-lg border bg-muted/30 p-3 space-y-1">
                  <p className="font-semibold text-foreground">
                    {activeUser.full_name || "User"}
                  </p>
                  <p className="text-muted-foreground font-mono">{activeUser.email}</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold">Select New Role</label>
                  <select
                    value={newRole}
                    onChange={(e) =>
                      setNewRole(e.target.value as "student" | "staff" | "admin")
                    }
                    className="w-full h-10 px-3 rounded-lg border bg-background text-sm"
                  >
                    <option value="student">Student (Customer)</option>
                    <option value="staff">Canteen Staff</option>
                    <option value="admin">Administrator</option>
                  </select>
                </div>

                {newRole === "staff" && (
                  <div className="space-y-1.5 animate-in fade-in">
                    <label className="text-xs font-semibold">Assign Canteen *</label>
                    <select
                      required
                      value={newCanteenId}
                      onChange={(e) => setNewCanteenId(e.target.value)}
                      className="w-full h-10 px-3 rounded-lg border bg-background text-sm"
                    >
                      {canteens.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-muted-foreground">
                      Staff are strictly isolated to their assigned canteen.
                    </p>
                  </div>
                )}

                <div className="pt-2 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setActiveUser(null)}
                    disabled={isUpdating}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={isUpdating}>
                    {isUpdating ? "Updating..." : "Confirm Role Change"}
                  </Button>
                </div>
              </CardContent>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
