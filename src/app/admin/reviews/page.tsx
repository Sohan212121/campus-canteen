import { requireRole } from "@/server/auth";
import { ReviewModerationTable } from "@/components/admin/review-moderation-table";

export default async function AdminReviewsPage() {
  await requireRole(["admin"]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Review Moderation
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
          Monitor verified-purchase customer feedback and hide abusive or inappropriate reviews.
        </p>
      </div>

      {/* Moderation Table */}
      <ReviewModerationTable />
    </div>
  );
}
