import { PickupScannerView } from "@/components/staff/pickup-scanner-view";

export const dynamic = "force-dynamic";

export default function StaffPickupPage() {
  return (
    <div className="py-2">
      <PickupScannerView />
    </div>
  );
}
