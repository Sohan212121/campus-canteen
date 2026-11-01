"use client";

import { useState } from "react";
import {
  Search,
  Eye,
  X,
  ChevronLeft,
  ChevronRight,
  Clock,
  User,
  CreditCard,
  Building,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VoiceSearchButton } from "@/components/ui/voice-search-button";
import { formatPaise } from "@/lib/money";
import { formatIstDateTime } from "@/lib/order-status";
import {
  getAdminOrdersAction,
  type AdminOrderRow,
  type AdminOrdersListResult,
} from "@/server/actions/admin";

interface OrdersViewProps {
  initialData: AdminOrdersListResult;
}

const statusOptions = [
  "ALL",
  "PLACED",
  "ACCEPTED",
  "PREPARING",
  "READY",
  "COLLECTED",
  "CANCELLED",
  "REJECTED",
  "NO_SHOW",
];

export function OrdersView({ initialData }: OrdersViewProps) {
  const [data, setData] = useState<AdminOrdersListResult>(initialData);
  const [search, setSearch] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);

  // Detail Modal (Read-Only)
  const [activeOrder, setActiveOrder] = useState<AdminOrderRow | null>(null);

  const fetchOrders = async (
    targetPage: number,
    targetSearch: string,
    targetStatus: string
  ) => {
    setIsLoading(true);
    try {
      const res = await getAdminOrdersAction({
        page: targetPage,
        limit: 25,
        search: targetSearch.trim() || undefined,
        status: targetStatus !== "ALL" ? [targetStatus] : undefined,
      });
      if (res.success && res.data) {
        setData(res.data);
        setPage(targetPage);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchOrders(1, search, selectedStatus);
  };

  const handleStatusFilter = (status: string) => {
    setSelectedStatus(status);
    fetchOrders(1, search, status);
  };

  const totalPages = Math.ceil((data.total_count || 0) / 25) || 1;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "PLACED":
        return <Badge variant="outline" className="border-amber-500 text-amber-500">Placed</Badge>;
      case "ACCEPTED":
        return <Badge variant="outline" className="border-blue-500 text-blue-500">Accepted</Badge>;
      case "PREPARING":
        return <Badge className="bg-amber-500/10 text-amber-600 border border-amber-500/20">Preparing</Badge>;
      case "READY":
        return <Badge className="bg-emerald-600 text-white">Ready</Badge>;
      case "COLLECTED":
        return <Badge variant="secondary" className="bg-muted text-muted-foreground">Collected</Badge>;
      case "CANCELLED":
        return <Badge variant="destructive">Cancelled</Badge>;
      case "REJECTED":
        return <Badge variant="destructive">Rejected</Badge>;
      case "NO_SHOW":
        return <Badge variant="destructive" className="bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/20">No-Show</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Orders Monitor</h1>
          <p className="text-xs text-muted-foreground">
            Search, filter, and inspect campus orders across all lifecycle states.
          </p>
        </div>

        <Badge variant="outline" className="text-xs font-mono font-medium self-start sm:self-auto">
          {data.total_count.toLocaleString()} Total Orders
        </Badge>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3">
        <form onSubmit={handleSearchSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by order code (e.g. CN10025) or customer name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-10 h-10"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center">
              <VoiceSearchButton
                size="sm"
                onSearch={(transcript) => {
                  setSearch(transcript);
                  fetchOrders(1, transcript, selectedStatus);
                }}
              />
            </div>
          </div>
          <Button type="submit" disabled={isLoading} className="h-10 text-xs font-semibold px-4">
            Search
          </Button>
        </form>

        {/* Status Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {statusOptions.map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => handleStatusFilter(st)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors border ${
                selectedStatus === st
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border/60 hover:text-foreground"
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* Orders Table */}
      <Card className="border shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-muted/50 border-b text-muted-foreground font-semibold">
              <tr>
                <th className="p-3 pl-4">Order Code</th>
                <th className="p-3">Customer</th>
                <th className="p-3">Items</th>
                <th className="p-3">Total Bill</th>
                <th className="p-3">Placed (IST)</th>
                <th className="p-3">Status</th>
                <th className="p-3 pr-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {data.orders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-muted-foreground">
                    No orders match your filter criteria.
                  </td>
                </tr>
              ) : (
                data.orders.map((order) => (
                  <tr key={order.id} className="hover:bg-muted/30 transition-colors">
                    <td className="p-3 pl-4 font-mono font-bold text-foreground">
                      #{order.order_code}
                    </td>
                    <td className="p-3 font-medium">
                      {order.student_name}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {order.item_count} items
                    </td>
                    <td className="p-3 font-mono font-semibold text-primary">
                      {formatPaise(order.total_paise)}
                    </td>
                    <td className="p-3 text-muted-foreground whitespace-nowrap">
                      {formatIstDateTime(order.placed_at)}
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      {getStatusBadge(order.status)}
                    </td>
                    <td className="p-3 pr-4 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setActiveOrder(order)}
                        className="h-7 text-xs gap-1"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Details
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
              onClick={() => fetchOrders(page - 1, search, selectedStatus)}
              className="h-8 gap-1 text-xs"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || isLoading}
              onClick={() => fetchOrders(page + 1, search, selectedStatus)}
              className="h-8 gap-1 text-xs"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </Card>

      {/* Read-Only Order Details Drawer */}
      {activeOrder && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <Card className="w-full max-w-md shadow-xl animate-in fade-in zoom-in-95">
            <CardHeader className="pb-3 border-b flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <span>Order #{activeOrder.order_code}</span>
                  {getStatusBadge(activeOrder.status)}
                </CardTitle>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Placed on {formatIstDateTime(activeOrder.placed_at)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveOrder(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="space-y-2 text-xs rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5" /> Customer
                  </span>
                  <span className="font-semibold text-foreground">
                    {activeOrder.student_name}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <Building className="h-3.5 w-3.5" /> Canteen
                  </span>
                  <span className="font-semibold text-foreground">
                    {activeOrder.canteen_name}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <CreditCard className="h-3.5 w-3.5" /> Payment
                  </span>
                  <span className="font-semibold text-foreground">
                    {activeOrder.payment_method} ({activeOrder.payment_status})
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" /> Est. Ready
                  </span>
                  <span className="font-semibold text-foreground">
                    {formatIstDateTime(activeOrder.estimated_ready_at)}
                  </span>
                </div>
              </div>

              <div className="flex justify-between items-center py-2 px-3 rounded-lg border bg-background font-bold text-sm">
                <span>Total Amount</span>
                <span className="text-primary font-mono text-base">
                  {formatPaise(activeOrder.total_paise)}
                </span>
              </div>

              <div className="pt-2 flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setActiveOrder(null)}
                >
                  Close
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
