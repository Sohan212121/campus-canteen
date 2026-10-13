"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Globe,
  Plus,
  Trash2,
  AlertTriangle,
  Loader2,
  Calendar,
  User,
  ShieldAlert,
} from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  adminAddAllowedDomainAction,
  adminRemoveAllowedDomainAction,
  type AllowedDomainItem,
} from "@/server/actions/admin-domains";

interface DomainsViewProps {
  initialDomains: AllowedDomainItem[];
}

export function DomainsView({ initialDomains }: DomainsViewProps) {
  const [domains, setDomains] = useState<AllowedDomainItem[]>(initialDomains);
  const [newDomain, setNewDomain] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [deletingDomain, setDeletingDomain] = useState<string | null>(null);

  // Freemail confirmation modal state
  const [freemailPrompt, setFreemailPrompt] = useState<{
    domain: string;
    warning: string;
  } | null>(null);

  // Remove confirmation modal state
  const [domainToRemove, setDomainToRemove] = useState<AllowedDomainItem | null>(null);

  const handleAddDomain = async (confirmFreemail: boolean = false) => {
    const domainToSubmit = freemailPrompt ? freemailPrompt.domain : newDomain.trim().toLowerCase();
    if (!domainToSubmit) return;

    setIsAdding(true);
    try {
      const res = await adminAddAllowedDomainAction(domainToSubmit, confirmFreemail);

      if (!res.success) {
        if (res.isFreemailWarning) {
          setFreemailPrompt({
            domain: domainToSubmit,
            warning: res.error,
          });
          return;
        }
        toast.error(res.error || "Failed to add domain");
        return;
      }

      setFreemailPrompt(null);
      setNewDomain("");
      if (res.data.changed) {
        toast.success(`Domain ${res.data.domain} added successfully.`);
        setDomains((prev) => [
          ...prev,
          {
            id: res.data.id || String(Date.now()),
            domain: res.data.domain,
            created_at: new Date().toISOString(),
            created_by: null,
            creator_name: "You (Admin)",
          },
        ].sort((a, b) => a.domain.localeCompare(b.domain)));
      } else {
        toast.info(`Domain ${res.data.domain} is already on the allowed list.`);
      }
    } catch {
      toast.error("An unexpected error occurred while adding domain.");
    } finally {
      setIsAdding(false);
    }
  };

  const handleConfirmRemove = async () => {
    if (!domainToRemove) return;

    setDeletingDomain(domainToRemove.domain);
    try {
      const res = await adminRemoveAllowedDomainAction(domainToRemove.domain);
      if (!res.success) {
        toast.error(res.error || "Failed to remove domain");
        return;
      }

      setDomains((prev) => prev.filter((d) => d.domain !== domainToRemove.domain));
      toast.success(`Domain ${domainToRemove.domain} removed.`);
      setDomainToRemove(null);
    } catch {
      toast.error("Failed to remove domain.");
    } finally {
      setDeletingDomain(null);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto py-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Globe className="h-6 w-6 text-primary" />
          Allowed Email Domains
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Only students registering with email addresses from these verified domains will be allowed to create an account.
        </p>
      </div>

      {/* Warning Notice if empty */}
      {domains.length === 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-900 dark:text-amber-200 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <div className="text-sm space-y-1">
            <p className="font-semibold">Signups Are Currently Closed (Fail-Closed)</p>
            <p className="text-xs text-amber-800 dark:text-amber-300">
              The allowed email domains list is currently empty. All public student registrations will be rejected until at least one campus domain is added.
            </p>
          </div>
        </div>
      )}

      {/* Add Domain Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Add Campus Domain</CardTitle>
          <CardDescription className="text-xs">
            Enter the exact root domain of your educational institution (e.g., <code className="bg-muted px-1 py-0.5 rounded">college.edu</code>).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleAddDomain(false);
            }}
            className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center"
          >
            <div className="relative flex-1">
              <Input
                type="text"
                placeholder="college.edu or campus.ac.in"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                disabled={isAdding}
                className="font-mono text-sm"
              />
            </div>
            <Button
              type="submit"
              disabled={isAdding || !newDomain.trim()}
              className="shrink-0"
            >
              {isAdding ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding…
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Domain
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Domains List */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-semibold">
              Configured Domains ({domains.length})
            </CardTitle>
            <CardDescription className="text-xs">
              Active domains permitted for student self-signup.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {domains.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              No domains added yet. Enter a domain above to enable campus registration.
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {domains.map((item) => (
                <div
                  key={item.id}
                  className="py-3.5 flex items-center justify-between gap-4"
                >
                  <div className="space-y-1 min-w-0">
                    <span className="font-mono font-medium text-sm text-foreground break-all">
                      @{item.domain}
                    </span>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(item.created_at).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                      {item.creator_name && (
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {item.creator_name}
                        </span>
                      )}
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDomainToRemove(item)}
                    disabled={deletingDomain === item.domain}
                    className="text-destructive hover:bg-destructive/10 shrink-0"
                    title={`Remove ${item.domain}`}
                  >
                    {deletingDomain === item.domain ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Freemail Warning Modal */}
      {freemailPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <Card className="max-w-md w-full border-destructive/30 shadow-lg">
            <CardHeader className="space-y-2">
              <div className="flex items-center gap-2 text-destructive">
                <ShieldAlert className="h-5 w-5" />
                <CardTitle className="text-base font-bold">Public Email Warning</CardTitle>
              </div>
              <CardDescription className="text-xs leading-relaxed text-foreground">
                {freemailPrompt.warning}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Allowing public providers like Gmail or Yahoo means anyone on the internet with a free email can sign up as a student. Are you completely sure you want to approve this?
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setFreemailPrompt(null)}
                  disabled={isAdding}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleAddDomain(true)}
                  disabled={isAdding}
                >
                  {isAdding ? "Approving…" : "Confirm & Allow Domain"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Removal Confirmation Modal */}
      {domainToRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <Card className="max-w-md w-full shadow-lg">
            <CardHeader className="space-y-2">
              <div className="flex items-center gap-2 text-destructive">
                <Trash2 className="h-5 w-5" />
                <CardTitle className="text-base font-bold">Remove Allowed Domain</CardTitle>
              </div>
              <CardDescription className="text-xs leading-relaxed">
                Are you sure you want to remove <strong className="font-mono font-semibold text-foreground">@{domainToRemove.domain}</strong>?
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Existing users will not be deleted, but any prospective students attempting to register with this domain will be immediately rejected.
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDomainToRemove(null)}
                  disabled={Boolean(deletingDomain)}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleConfirmRemove}
                  disabled={Boolean(deletingDomain)}
                >
                  {deletingDomain ? "Removing…" : "Remove Domain"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
