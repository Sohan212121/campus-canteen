import { requireRole } from "@/server/auth";
import { getNotificationsAction } from "@/server/actions/notifications";
import { NotificationsView } from "@/components/student/notifications-view";

export default async function NotificationsPage() {
  const profile = await requireRole(["student"]);
  const res = await getNotificationsAction(40);

  return (
    <NotificationsView
      userId={profile.id}
      initialNotifications={res.notifications || []}
    />
  );
}
