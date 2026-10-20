"use client";

import { useState, useRef } from "react";
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
import { MenuItemImage } from "@/components/ui/menu-item-image";
import { compressImageForUpload } from "@/lib/client-image";

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
  const [filterMissingDetailsOnly, setFilterMissingDetailsOnly] = useState(false);

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
  const [itemCalories, setItemCalories] = useState("");
  const [itemIngredients, setItemIngredients] = useState<string[]>([]);
  const [ingredientInput, setIngredientInput] = useState("");
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
    const isMissingDetails =
      item.calories_kcal == null || !item.ingredients || item.ingredients.length === 0;
    const matchesMissingFilter = !filterMissingDetailsOnly || isMissingDetails;
    return matchesSearch && matchesCategory && matchesMissingFilter;
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
      setItemCalories(item.calories_kcal != null ? String(item.calories_kcal) : "");
      setItemIngredients(item.ingredients ? [...item.ingredients] : []);
      setIngredientInput("");
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
      setItemCalories("");
      setItemIngredients([]);
      setIngredientInput("");
    }
    setItemModalOpen(true);
  };

  const handleAddIngredient = (rawInput?: string) => {
    const textToAdd = rawInput !== undefined ? rawInput : ingredientInput;
    if (!textToAdd.trim()) return;

    // Support comma-separated batch adding/pasting
    const candidates = textToAdd
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const updated = [...itemIngredients];
    for (const cand of candidates) {
      if (cand.length > 60) {
        toast.error(`"${cand.slice(0, 20)}..." exceeds 60 characters.`);
        continue;
      }
      if (updated.length >= 30) {
        toast.error("Maximum 30 ingredients allowed.");
        break;
      }
      // Case-insensitive duplicate check
      const isDuplicate = updated.some(
        (existing) => existing.toLowerCase() === cand.toLowerCase()
      );
      if (isDuplicate) {
        toast.error(`"${cand}" is already added.`);
        continue;
      }
      updated.push(cand);
    }

    setItemIngredients(updated);
    setIngredientInput("");
  };

  const handleRemoveIngredient = (indexToRemove: number) => {
    setItemIngredients((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingImage(true);

    try {
      // 1. Client-side resize and compression (max 1200px, WebP/JPEG, target < 500 KB, guaranteed < 2 MB)
      const compressedFile = await compressImageForUpload(file);

      // 2. Server upload
      const formData = new FormData();
      formData.append("file", compressedFile);

      const res = await uploadMenuImageAction(formData);
      if (res.success) {
        setItemImageUrl(res.data.publicUrl);
        const origKb = Math.round(file.size / 1024);
        const compKb = Math.round(compressedFile.size / 1024);
        toast.success(`Image optimized (${origKb} KB → ${compKb} KB) and uploaded`);
      } else {
        toast.error(res.error || "Failed to upload image");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to process image.";
      toast.error(message);
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
    const calTrimmed = itemCalories.trim();
    const caloriesVal = calTrimmed === "" ? null : parseInt(calTrimmed, 10);

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
      calories_kcal: caloriesVal,
      ingredients: itemIngredients,
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
                    calories_kcal: caloriesVal,
                    ingredients: itemIngredients,
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
              selectedCatId === "ALL" && !filterMissingDetailsOnly
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border/60 hover:text-foreground"
            }`}
          >
            All Items ({items.filter((i) => i.is_active).length})
          </button>
          <button
            type="button"
            onClick={() => setFilterMissingDetailsOnly((prev) => !prev)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors border ${
              filterMissingDetailsOnly
                ? "bg-amber-600 text-white border-amber-600 shadow-xs"
                : "bg-card text-amber-700 dark:text-amber-400 border-amber-500/40 hover:bg-amber-500/10"
            }`}
          >
            Missing Details Only ({items.filter((i) => i.is_active && (i.calories_kcal == null || !i.ingredients || i.ingredients.length === 0)).length})
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
                  {/* Fixed aspect ratio card thumbnail */}
                  <div className="w-full">
                    <MenuItemImage
                      src={item.image_url}
                      alt={item.name}
                      aspect="4/3"
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      className="h-full w-full object-cover"
                      containerClassName="w-full h-40"
                    />
                  </div>

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
                        <div className="flex flex-wrap items-center gap-1 mt-1">
                          <Badge variant="outline" className="text-[10px]">
                            {catName}
                          </Badge>
                          {(item.calories_kcal == null || !item.ingredients || item.ingredients.length === 0) && (
                            <Badge
                              variant="secondary"
                              className="text-[10px] bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 font-medium"
                            >
                              Details missing
                            </Badge>
                          )}
                          {item.calories_kcal != null && (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">
                              {item.calories_kcal} kcal
                            </Badge>
                          )}
                        </div>
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

                {/* Calories & Ingredients Section */}
                <div className="space-y-3 pt-2 border-t">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold">Calories (kcal)</label>
                      <span className="text-[11px] text-muted-foreground">Optional (0 - 5,000 kcal)</span>
                    </div>
                    <Input
                      type="number"
                      min="0"
                      max="5000"
                      placeholder="e.g. 350"
                      value={itemCalories}
                      onChange={(e) => setItemCalories(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold">Ingredients</label>
                      <span className="text-[11px] text-muted-foreground">
                        {itemIngredients.length}/30 items (max 60 chars each)
                      </span>
                    </div>

                    <div className="flex gap-2">
                      <Input
                        placeholder="Type ingredient and press Enter (or paste comma-separated)..."
                        value={ingredientInput}
                        onChange={(e) => setIngredientInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddIngredient();
                          }
                        }}
                        disabled={itemIngredients.length >= 30}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => handleAddIngredient()}
                        disabled={!ingredientInput.trim() || itemIngredients.length >= 30}
                      >
                        Add
                      </Button>
                    </div>

                    {itemIngredients.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1.5 max-h-36 overflow-y-auto p-1.5 bg-muted/30 rounded-lg border">
                        {itemIngredients.map((ing, idx) => (
                          <span
                            key={`${ing}-${idx}`}
                            className="inline-flex items-center gap-1 rounded-md bg-background px-2.5 py-1 text-xs font-medium border text-foreground shadow-2xs"
                          >
                            <span>{ing}</span>
                            <button
                              type="button"
                              onClick={() => handleRemoveIngredient(idx)}
                              className="text-muted-foreground hover:text-destructive rounded-full p-0.5"
                              aria-label={`Remove ingredient ${ing}`}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
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
                    <div className="space-y-2">
                      <div className="relative h-40 w-full rounded-lg overflow-hidden border bg-muted">
                        <MenuItemImage
                          src={itemImageUrl}
                          alt="Preview"
                          aspect="4/3"
                          sizes="500px"
                          className="h-full w-full object-cover"
                          containerClassName="h-full w-full"
                        />
                        {uploadingImage && (
                          <div className="absolute inset-0 bg-background/70 backdrop-blur-[1px] flex items-center justify-center text-xs font-semibold gap-2 z-20">
                            <Upload className="h-4 w-4 animate-bounce" />
                            <span>Optimizing & uploading...</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploadingImage}
                          className="text-xs h-9 flex-1 gap-1.5"
                        >
                          <Upload className="h-3.5 w-3.5" />
                          <span>Replace Photo</span>
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => setItemImageUrl(null)}
                          disabled={uploadingImage}
                          className="text-xs h-9 gap-1.5"
                        >
                          <X className="h-3.5 w-3.5" />
                          <span>Remove</span>
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div
                      onClick={() => !uploadingImage && fileInputRef.current?.click()}
                      className="border-2 border-dashed rounded-lg p-5 text-center cursor-pointer hover:bg-muted/30 transition-colors flex flex-col items-center justify-center gap-1.5"
                    >
                      <Upload className="h-6 w-6 text-muted-foreground" />
                      <span className="text-xs font-medium text-muted-foreground">
                        {uploadingImage ? "Optimizing & uploading..." : "Click to select food photo (JPEG, PNG, WebP)"}
                      </span>
                      <span className="text-[10px] text-muted-foreground/80">
                        Auto-resized (max 1200px) & compressed under 500 KB
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
