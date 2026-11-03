import { requireRole } from "@/server/auth";
import { createReadOnlyClient } from "@/lib/supabase/server";
import { ProfileView } from "@/components/student/profile-view";
import { ThemeToggle } from "@/components/ui/theme-toggle";

interface RecentOrderRow {
  id: string;
  order_code: number;
  status: string;
  placed_at: string;
  total_paise: number;
  order_items: Array<{ name_snapshot: string; quantity: number }> | null;
}

export default async function ProfilePage() {
  const profile = await requireRole(["student"]);
  const supabase = await createReadOnlyClient();

  // Fetch auth user email
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch user orders count and 2 most recent orders
  const { count: ordersCount, data: recentOrdersData } = await supabase
    .from("orders")
    .select(
      `
      id,
      order_code,
      status,
      placed_at,
      total_paise,
      order_items (
        name_snapshot,
        quantity
      )
    `,
      { count: "exact" }
    )
    .eq("user_id", profile.id)
    .order("placed_at", { ascending: false })
    .limit(2);

  const typedOrders = (recentOrdersData || []) as unknown as RecentOrderRow[];

  const recentOrders = typedOrders.map((o) => {
    const rawItems = o.order_items || [];
    const summary = rawItems
      .map((item) =>
        item.quantity > 1 ? `${item.name_snapshot} (${item.quantity})` : item.name_snapshot
      )
      .join(", ");

    return {
      id: o.id,
      order_code: o.order_code,
      status: o.status,
      placed_at: o.placed_at,
      total_paise: o.total_paise,
      items_summary: summary,
    };
  });

  return (
    <ProfileView
      profile={profile}
      email={user?.email || ""}
      ordersCount={ordersCount ?? 0}
      recentOrders={recentOrders}
      themeToggleSection={
        <section
          className="bg-[#f1ede6] dark:bg-[#121319] rounded-2xl p-3.5 border border-[#e6e2da] dark:border-[#222533] shadow-xs flex items-center justify-between"
          data-purpose="theme-toggle"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#1c1c17] dark:bg-[#1e2230] text-[#ff8843] dark:text-[#FBBF24] flex items-center justify-center shadow-xs">
              <svg className="w-5 h-5 fill-current" viewBox="0 0 20 20">
                <path
                  clipRule="evenodd"
                  d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"
                  fillRule="evenodd"
                />
              </svg>
            </div>
            <div className="flex flex-col">
              <h3 className="font-bold text-[#1c1c17] dark:text-white text-sm leading-snug">
                Theme & Appearance
              </h3>
              <p className="text-[11px] text-[#564240] dark:text-stone-400 mt-0.5 leading-snug">
                Switch between Light and Dark mode for C@mpBite.
              </p>
            </div>
          </div>
          <ThemeToggle />
        </section>
      }
    />
  );
}
