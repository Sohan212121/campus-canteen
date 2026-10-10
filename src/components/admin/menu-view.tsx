"use client";

import { useState, useRef } from "react";
import Image from "next/image";
import { toast } from "sonner";
import {
  Search,
  Plus,
  Edit,
  Archive,
  UtensilsCrossed,
  Info,
  Layers,
  Upload,
  X,
  CheckCircle2,
  Ban,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPaise, parseRupeesToPaise } from "@/lib/money";
import {
  type AdminCategory,
  type AdminMenuItem,
  adminCreateCategoryAction,
  adminUpdateCategoryAction,
  adminArchiveCategoryAction,
  adminCreateMenuItemAction,
  adminUpdateMenuItemAction,
  adminArchiveMenuItemAction,
  uploadMenuImageAction,
} from "@/server/actions/admin";

interface MenuViewProps {
  canteenId: string;
  initialCategories: AdminCategory[];
  initialItems: AdminMenuItem[];
}

export function MenuView({
  canteenId,
  initialCategories,
  initialItems,
}: MenuViewProps) {
  const [categories, setCategories] = useState<AdminCategory[]>(initialCategories);
  const [items, setItems] = useState<AdminMenuItem[]>(initialItems);
  const [search, setSearch] = useState("");
  const [selectedCatId, setSelectedCatId] = useState<string>("ALL");

  // Category Modal State
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<AdminCategory | null>(null);
  const [catNameInput, setCatNameInput] = useState("");
  const [catOrderInput, setCatOrderInput] = useState("0");
  const [catSubmitting, setCatSubmitting] = useState(false);

  // Item Modal State
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<AdminMenuItem | null>(null);
  const [itemName, setItemName] = useState("");
  const [itemDesc, setItemDesc] = useState("");
  const [itemCategory, setItemCategory] = useState("");
  const [itemPriceRupees, setItemPriceRupees] = useState("");
  const [itemVeg, setItemVeg] = useState(true);
  const [itemAvailable, setItemAvailable] = useState(true);
  const [itemStock, setItemStock] = useState("");
  const [itemPrepMinutes, setItemPrepMinutes] = useState("10");
  const [itemImageUrl, setItemImageUrl] = useState<string | null>(null);
  const [itemSubmitting, setItemSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Active categories only for the item selector and tab filter
  const activeCategories = categories.filter((c) => c.is_active);

  const filteredItems = items.filter((item) => {
    // Only show active items unless searched specifically
    if (!item.is_active) return false;
    const matchesSearch =
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      (item.description &&
        item.description.toLowerCase().includes(search.toLowerCase()));
    const matchesCategory =
      selectedCatId === "ALL" || item.category_id === selectedCatId;
    return matchesSearch && matchesCategory;
  });

  // -------------------------------------------------------------------------
  // Category Actions
  // -------------------------------------------------------------------------
  const openCategoryModal = (cat?: AdminCategory) => {
    if (cat) {
      setEditingCategory(cat);
      setCatNameInput(cat.name);
      setCatOrderInput(String(cat.display_order));
    } else {
      setEditingCategory(null);
      setCatNameInput("");
      setCatOrderInput(String(categories.length * 10));
    }
    setCategoryModalOpen(true);
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catNameInput.trim()) return;

    setCatSubmitting(true);
    const orderNum = parseInt(catOrderInput, 10) || 0;

    try {
      if (editingCategory) {
        const res = await adminUpdateCategoryAction(
          editingCategory.id,
          catNameInput.trim(),
          orderNum,
          editingCategory.is_active
        );
        if (res.success) {
          toast.success("Category updated successfully");
          setCategories((prev) =>
            prev.map((c) =>
              c.id === editingCategory.id
                ? { ...c, name: catNameInput.trim(), display_order: orderNum }
                : c
            )
          );
          setCategoryModalOpen(false);
        } else {
          toast.error(res.error || "Failed to update category");
        }
      } else {
        const res = await adminCreateCategoryAction(
          canteenId,
          catNameInput.trim(),
          orderNum
        );
        if (res.success) {
          toast.success("Category created successfully");
          setCategories((prev) => [...prev, res.data]);
          setCategoryModalOpen(false);
        } else {
          toast.error(res.error);
        }
      }
    } finally {
      setCatSubmitting(false);
    }
  };

  const handleArchiveCategory = async (catId: string) => {
    if (!confirm("Are you sure you want to archive this category? It will be hidden from students.")) {
      return;
    }

    const res = await adminArchiveCategoryAction(catId);
    if (res.success) {
      toast.success("Category archived");
      setCategories((prev) =>
        prev.map((c) => (c.id === catId ? { ...c, is_active: false } : c))
      );
      if (selectedCatId === catId) setSelectedCatId("ALL");
    } else {
      toast.error(res.error || "Failed to archive category");
    }
  };

  // -------------------------------------------------------------------------
  // Item Modal & Actions
  // -------------------------------------------------------------------------
  const openItemModal = (item?: AdminMenuItem) => {
    if (item) {
      setEditingItem(item);
      setItemName(item.name);
      setItemDesc(item.description || "");
      setItemCategory(item.category_id || (activeCategories[0]?.id ?? ""));
      setItemPriceRupees((item.price_paise / 100).toFixed(2).replace(/\.00$/, ""));
      setItemVeg(item.is_veg);
      setItemAvailable(item.is_available);
      setItemStock(item.stock !== null ? String(item.stock) : "");
      setItemPrepMinutes(String(item.prep_minutes));
      setItemImageUrl(item.image_url);
    } else {
      setEditingItem(null);
      setItemName("");
      setItemDesc("");
      setItemCategory(selectedCatId !== "ALL" ? selectedCatId : (activeCategories[0]?.id ?? ""));
      setItemPriceRupees("");
      setItemVeg(true);
      setItemAvailable(true);
      setItemStock("");
      setItemPrepMinutes("10");
      setItemImageUrl(null);
    }
    setItemModalOpen(true);
  };

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error("File size exceeds 2 MB limit");
      return;
    }

    setUploadingImage(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await uploadMenuImageAction(formData);
      if (res.success) {
        setItemImageUrl(res.data.publicUrl);
        toast.success("Image uploaded successfully");
      } else {
        toast.error(res.error);
      }
    } catch {
      toast.error("Network error uploading image");
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemName.trim() || !itemCategory) {
      toast.error("Please fill in item name and category");
      return;
    }

    const priceCheck = parseRupeesToPaise(itemPriceRupees);
    if (!priceCheck.success) {
      toast.error(priceCheck.error || "Invalid price");
      return;
    }

    setItemSubmitting(true);
    const stockVal = itemStock.trim() !== "" ? parseInt(itemStock, 10) : null;
    const prepMins = parseInt(itemPrepMinutes, 10) || 10;

    const payload = {
      canteen_id: canteenId,
      category_id: itemCategory,
      name: itemName.trim(),
      description: itemDesc.trim() || null,
      price_rupees: itemPriceRupees,
      image_url: itemImageUrl,
      is_veg: itemVeg,
      is_available: itemAvailable,
      stock: stockVal,
      prep_minutes: prepMins,
    };

    try {
      if (editingItem) {
        const res = await adminUpdateMenuItemAction(
          editingItem.id,
          payload,
          editingItem.image_url
        );
        if (res.success) {
          toast.success("Menu item updated");
          setItems((prev) =>
            prev.map((i) =>
              i.id === editingItem.id
                ? {
                    ...i,
                    ...payload,
                    price_paise: priceCheck.paise!,
                    image_url: itemImageUrl,
                    stock: stockVal,
                    description: payload.description,
                  }
                : i
            )
          );
          setItemModalOpen(false);
        } else {
          toast.error(res.error || "Failed to update item");
        }
      } else {
        const res = await adminCreateMenuItemAction(payload);
        if (res.success) {
          toast.success("Menu item created");
          setItems((prev) => [...prev, res.data]);
          setItemModalOpen(false);
        } else {
          toast.error(res.error);
        }
      }
    } finally {
      setItemSubmitting(false);
    }
  };

  const handleArchiveItem = async (itemId: string) => {
    if (!confirm("Are you sure you want to archive this menu item? It will be removed from customer menus, while all historical orders remain preserved.")) {
      return;
    }

    const res = await adminArchiveMenuItemAction(itemId);
    if (res.success) {
      toast.success("Menu item archived");
      setItems((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, is_active: false } : i))
      );
    } else {
      toast.error(res.error || "Failed to archive item");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header and Add Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Menu & Categories</h1>
          <p className="text-xs text-muted-foreground">
            Manage canteen offerings, pricing, stock levels, and food categorization.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => openCategoryModal()}
            className="gap-1.5 text-xs font-semibold"
          >
            <Layers className="h-4 w-4" />
            Add Category
          </Button>
          <Button
            size="sm"
            onClick={() => openItemModal()}
            disabled={activeCategories.length === 0}
            className="gap-1.5 text-xs font-semibold"
          >
            <Plus className="h-4 w-4" />
            Add Item
          </Button>
        </div>
      </div>

      {/* Pricing Immutability Notice Banner */}
      <div className="p-3.5 rounded-xl border border-primary/20 bg-primary/5 text-xs flex items-start gap-3">
        <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <p className="text-muted-foreground leading-relaxed">
          <strong className="text-foreground">Historical Integrity Guarantee:</strong> Modifying an item&apos;s price or title only applies to future checkouts. Historical student orders permanently retain their checkout price snapshots.
        </p>
      </div>

      {/* Filter and Category Pills */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search items by name or description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-10"
          />
        </div>

        {/* Categories scrollable pill list */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          <button
            type="button"
            onClick={() => setSelectedCatId("ALL")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors border ${
              selectedCatId === "ALL"
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border/60 hover:text-foreground"
            }`}
          >
            All Items ({items.filter((i) => i.is_active).length})
          </button>
          {activeCategories.map((cat) => (
            <div key={cat.id} className="inline-flex items-center group">
              <button
                type="button"
                onClick={() => setSelectedCatId(cat.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-l-lg whitespace-nowrap transition-colors border border-r-0 ${
                  selectedCatId === cat.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-muted-foreground border-border/60 hover:text-foreground"
                }`}
              >
                {cat.name}
              </button>
              <button
                type="button"
                title="Edit Category"
                onClick={() => openCategoryModal(cat)}
                className={`px-1.5 py-1.5 text-xs border border-l-0 rounded-r-lg transition-colors ${
                  selectedCatId === cat.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-muted-foreground border-border/60 hover:text-foreground"
                }`}
              >
                <Edit className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Items Grid */}
      {filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 text-center rounded-xl border border-dashed">
          <UtensilsCrossed className="h-10 w-10 text-muted-foreground/50 mb-3" />
          <p className="font-semibold text-base">No menu items found</p>
          <p className="text-xs text-muted-foreground mt-1">
            {activeCategories.length === 0
              ? "Create at least one category before adding food items."
              : "Try adjusting your search query or add a new menu item."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredItems.map((item) => {
            const catName =
              categories.find((c) => c.id === item.category_id)?.name || "General";

            return (
              <Card
                key={item.id}
                className="overflow-hidden border border-border/60 shadow-2xs hover:shadow-sm transition-all flex flex-col justify-between"
              >
                <div>
                  {/* Image banner if present */}
                  {item.image_url ? (
                    <div className="relative h-36 w-full bg-muted">
                      <Image
                        src={item.image_url}
                        alt={item.name}
                        fill
                        unoptimized
                        className="object-cover"
                      />
                    </div>
                  ) : null}

                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                              item.is_veg ? "bg-emerald-500" : "bg-rose-500"
                            }`}
                            title={item.is_veg ? "Vegetarian" : "Non-Vegetarian"}
                          />
                          <h3 className="font-bold text-base leading-tight">
                            {item.name}
                          </h3>
                        </div>
                        <Badge variant="outline" className="text-[10px] mt-1">
                          {catName}
                        </Badge>
                      </div>

                      <span className="font-bold font-mono text-primary text-base shrink-0">
                        {formatPaise(item.price_paise)}
                      </span>
                    </div>

                    {item.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {item.description}
                      </p>
                    )}

                    <div className="flex items-center justify-between text-xs pt-1 border-t text-muted-foreground">
                      <span>Prep: <strong>{item.prep_minutes}m</strong></span>
                      <span>
                        Stock: <strong>{item.stock !== null ? item.stock : "Unlimited"}</strong>
                      </span>
                      <span>
                        {item.is_available ? (
                          <span className="text-emerald-600 font-semibold flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Available
                          </span>
                        ) : (
                          <span className="text-rose-500 font-semibold flex items-center gap-1">
                            <Ban className="h-3 w-3" /> Sold Out
                          </span>
                        )}
                      </span>
                    </div>
                  </CardContent>
                </div>

                {/* Actions Footer */}
                <div className="px-4 py-3 bg-muted/30 border-t flex items-center justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openItemModal(item)}
                    className="h-8 text-xs gap-1"
                  >
                    <Edit className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleArchiveItem(item.id)}
                    className="h-8 text-xs text-destructive hover:bg-destructive/10 gap-1"
                  >
                    <Archive className="h-3.5 w-3.5" />
                    Archive
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Category Create/Edit Modal */}
      {/* ------------------------------------------------------------------ */}
      {categoryModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <Card className="w-full max-w-md shadow-xl animate-in fade-in zoom-in-95">
            <CardHeader className="pb-3 border-b flex flex-row items-center justify-between">
              <CardTitle className="text-base">
                {editingCategory ? "Edit Category" : "New Category"}
              </CardTitle>
              <button
                type="button"
                onClick={() => setCategoryModalOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </CardHeader>
            <form onSubmit={handleSaveCategory}>
              <CardContent className="pt-4 space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold">Category Name</label>
                  <Input
                    required
                    placeholder="e.g. Breakfast, Snacks, Beverages"
                    value={catNameInput}
                    onChange={(e) => setCatNameInput(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold">Display Order</label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={catOrderInput}
                    onChange={(e) => setCatOrderInput(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Lower numbers appear first on customer menus.
                  </p>
                </div>

                <div className="pt-2 flex items-center justify-between">
                  {editingCategory ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        handleArchiveCategory(editingCategory.id);
                        setCategoryModalOpen(false);
                      }}
                      className="text-destructive hover:bg-destructive/10 text-xs"
                    >
                      Archive Category
                    </Button>
                  ) : <div />}

                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setCategoryModalOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" size="sm" disabled={catSubmitting}>
                      {catSubmitting ? "Saving..." : "Save Category"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </form>
          </Card>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Menu Item Create/Edit Modal */}
      {/* ------------------------------------------------------------------ */}
      {itemModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <Card className="w-full max-w-lg shadow-xl animate-in fade-in zoom-in-95 my-8">
            <CardHeader className="pb-3 border-b flex flex-row items-center justify-between">
              <CardTitle className="text-base">
                {editingItem ? "Edit Menu Item" : "New Menu Item"}
              </CardTitle>
              <button
                type="button"
                onClick={() => setItemModalOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </CardHeader>
            <form onSubmit={handleSaveItem}>
              <CardContent className="pt-4 space-y-4 max-h-[75vh] overflow-y-auto">
                {/* Name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold">Item Name *</label>
                  <Input
                    required
                    placeholder="e.g. Masala Dosa"
                    value={itemName}
                    onChange={(e) => setItemName(e.target.value)}
                  />
                </div>

                {/* Category & Price in Rupees */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold">Category *</label>
                    <select
                      required
                      value={itemCategory}
                      onChange={(e) => setItemCategory(e.target.value)}
                      className="w-full h-10 px-3 rounded-lg border bg-background text-sm"
                    >
                      {activeCategories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold">Price in Rupees (₹) *</label>
                    <Input
                      required
                      type="text"
                      placeholder="e.g. 50.00"
                      value={itemPriceRupees}
                      onChange={(e) => setItemPriceRupees(e.target.value)}
                    />
                  </div>
                </div>

                {/* Description */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold">Description</label>
                  <textarea
                    rows={2}
                    placeholder="Crispy rice crepe served with coconut chutney and sambar..."
                    value={itemDesc}
                    onChange={(e) => setItemDesc(e.target.value)}
                    className="w-full p-2.5 rounded-lg border bg-background text-sm resize-none"
                  />
                </div>

                {/* Prep Minutes & Stock */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold">Prep Duration (minutes)</label>
                    <Input
                      type="number"
                      min="1"
                      max="180"
                      value={itemPrepMinutes}
                      onChange={(e) => setItemPrepMinutes(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold">Daily Stock (leave empty if unlimited)</label>
                    <Input
                      type="number"
                      min="0"
                      placeholder="Unlimited"
                      value={itemStock}
                      onChange={(e) => setItemStock(e.target.value)}
                    />
                  </div>
                </div>

                {/* Veg & Availability Toggles */}
                <div className="flex items-center gap-6 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold">
                    <input
                      type="checkbox"
                      checked={itemVeg}
                      onChange={(e) => setItemVeg(e.target.checked)}
                      className="rounded text-primary h-4 w-4"
                    />
                    Vegetarian Item
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold">
                    <input
                      type="checkbox"
                      checked={itemAvailable}
                      onChange={(e) => setItemAvailable(e.target.checked)}
                      className="rounded text-primary h-4 w-4"
                    />
                    Available for Ordering
                  </label>
                </div>

                {/* Image Upload Dropzone */}
                <div className="space-y-2 pt-2 border-t">
                  <label className="text-xs font-semibold flex items-center justify-between">
                    <span>Menu Image (Max 2 MB, JPEG/PNG/WebP)</span>
                    {itemImageUrl && (
                      <button
                        type="button"
                        onClick={() => setItemImageUrl(null)}
                        className="text-destructive hover:underline text-[11px]"
                      >
                        Remove Image
                      </button>
                    )}
                  </label>

                  {itemImageUrl ? (
                    <div className="relative h-32 w-full rounded-lg overflow-hidden border bg-muted">
                      <Image
                        src={itemImageUrl}
                        alt="Preview"
                        fill
                        unoptimized
                        className="object-cover"
                      />
                    </div>
                  ) : (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:bg-muted/30 transition-colors flex flex-col items-center justify-center gap-1.5"
                    >
                      <Upload className="h-6 w-6 text-muted-foreground" />
                      <span className="text-xs font-medium text-muted-foreground">
                        {uploadingImage ? "Uploading..." : "Click to upload food photo"}
                      </span>
                    </div>
                  )}

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={handleImageFileChange}
                    disabled={uploadingImage}
                  />
                </div>

                <div className="pt-4 border-t flex items-center justify-between">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setItemModalOpen(false)}
                    disabled={itemSubmitting || uploadingImage}
                  >
                    Cancel
                  </Button>

                  <Button
                    type="submit"
                    size="sm"
                    disabled={itemSubmitting || uploadingImage}
                  >
                    {itemSubmitting ? "Saving..." : editingItem ? "Save Changes" : "Create Item"}
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
