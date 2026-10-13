import { adminListAllowedDomainsAction } from "@/server/actions/admin-domains";
import { DomainsView } from "@/components/admin/domains-view";
import { Globe } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminDomainsPage() {
  const result = await adminListAllowedDomainsAction();

  if (!result.success) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center p-6 space-y-3">
        <Globe className="h-10 w-10 text-muted-foreground" />
        <h2 className="text-lg font-bold">Failed to Load Allowed Domains</h2>
        <p className="text-xs text-muted-foreground">{result.error}</p>
      </div>
    );
  }

  return <DomainsView initialDomains={result.data} />;
}
