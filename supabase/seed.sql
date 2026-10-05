-- ==============================================================================
-- Seed: seed.sql
-- Description: Idempotent seed data for Campus Canteen
-- Canteen: Main Campus Canteen
-- Categories: 6 categories
-- Menu Items: 24 realistic Indian campus food & drink items
-- Pickup Slots: 7 days of 15-minute break windows in Asia/Kolkata (IST)
-- ==============================================================================

DO $$
DECLARE
  v_canteen_id uuid;
  v_cat_breakfast uuid;
  v_cat_snacks uuid;
  v_cat_beverages uuid;
  v_cat_lunch uuid;
  v_cat_fastfood uuid;
  v_cat_combos uuid;
  v_day_offset integer;
  v_slot_date date;
  v_today_ist date;
BEGIN
  -- 1. CANTEEN (Safe re-run with ON CONFLICT)
  INSERT INTO public.canteens (name, location, is_active)
  VALUES ('Main Campus Canteen', 'Campus Central Block, Ground Floor', true)
  ON CONFLICT (name) DO UPDATE
    SET name = EXCLUDED.name
  RETURNING id INTO v_canteen_id;

  -- 2. CATEGORIES (6 Categories)
  INSERT INTO public.categories (canteen_id, name, display_order, is_active)
  VALUES (v_canteen_id, 'Breakfast', 1, true)
  ON CONFLICT (canteen_id, name) DO UPDATE
    SET name = EXCLUDED.name
  RETURNING id INTO v_cat_breakfast;

  INSERT INTO public.categories (canteen_id, name, display_order, is_active)
  VALUES (v_canteen_id, 'Snacks & Chaat', 2, true)
  ON CONFLICT (canteen_id, name) DO UPDATE
    SET name = EXCLUDED.name
  RETURNING id INTO v_cat_snacks;

  INSERT INTO public.categories (canteen_id, name, display_order, is_active)
  VALUES (v_canteen_id, 'Beverages', 3, true)
  ON CONFLICT (canteen_id, name) DO UPDATE
    SET name = EXCLUDED.name
  RETURNING id INTO v_cat_beverages;

  INSERT INTO public.categories (canteen_id, name, display_order, is_active)
  VALUES (v_canteen_id, 'Lunch & Thali', 4, true)
  ON CONFLICT (canteen_id, name) DO UPDATE
    SET name = EXCLUDED.name
  RETURNING id INTO v_cat_lunch;

  INSERT INTO public.categories (canteen_id, name, display_order, is_active)
  VALUES (v_canteen_id, 'Fast Food', 5, true)
  ON CONFLICT (canteen_id, name) DO UPDATE
    SET name = EXCLUDED.name
  RETURNING id INTO v_cat_fastfood;

  INSERT INTO public.categories (canteen_id, name, display_order, is_active)
  VALUES (v_canteen_id, 'Combos & Specials', 6, true)
  ON CONFLICT (canteen_id, name) DO UPDATE
    SET name = EXCLUDED.name
  RETURNING id INTO v_cat_combos;

  -- 3. MENU ITEMS (Prices in Paise: e.g. 5000 = ₹50.00)

  -- 3.1 Breakfast Items
  INSERT INTO public.menu_items (canteen_id, category_id, name, description, price_paise, is_veg, is_available, prep_minutes, is_active)
  VALUES
    (v_canteen_id, v_cat_breakfast, 'Masala Dosa', 'Crisp rice crepe stuffed with spiced potato mash, served with coconut chutney & sambar', 5000, true, true, 8, true),
    (v_canteen_id, v_cat_breakfast, 'Idli Vada Combo', '2 steamed rice cakes + 1 crispy medu vada with sambar and coconut chutney', 4500, true, true, 5, true),
    (v_canteen_id, v_cat_breakfast, 'Plain Dosa', 'Golden crispy crepe served with fresh sambar and podi chutney', 4000, true, true, 6, true),
    (v_canteen_id, v_cat_breakfast, 'Poha', 'Flattened rice tempered with mustard seeds, curry leaves, onions, and roasted peanuts', 3000, true, true, 4, true)
  ON CONFLICT (canteen_id, name) DO NOTHING;

  -- 3.2 Snacks & Chaat
  INSERT INTO public.menu_items (canteen_id, category_id, name, description, price_paise, is_veg, is_available, prep_minutes, is_active)
  VALUES
    (v_canteen_id, v_cat_snacks, 'Samosa (2 pcs)', 'Crisp golden pastry filled with spiced potatoes and green peas, served with mint & tamarind chutney', 3000, true, true, 3, true),
    (v_canteen_id, v_cat_snacks, 'Vada Pav', 'Mumbai style spiced batata vada inside a toasted pav with dry garlic chutney & green chili', 2500, true, true, 3, true),
    (v_canteen_id, v_cat_snacks, 'Pav Bhaji', 'Rich butter-mashed spiced vegetable curry served with 2 warm buttered pav buns', 6000, true, true, 10, true),
    (v_canteen_id, v_cat_snacks, 'Veg Puff', 'Flaky baked pastry filled with mildly spiced carrots, peas, and potatoes', 2000, true, true, 2, true),
    (v_canteen_id, v_cat_snacks, 'Paneer Bread Pakoda', 'Deep-fried bread sandwich stuffed with cottage cheese slice and tangy spiced potato filling', 3500, true, true, 5, true)
  ON CONFLICT (canteen_id, name) DO NOTHING;

  -- 3.3 Beverages
  INSERT INTO public.menu_items (canteen_id, category_id, name, description, price_paise, is_veg, is_available, prep_minutes, is_active)
  VALUES
    (v_canteen_id, v_cat_beverages, 'Masala Chai', 'Freshly brewed strong Indian tea infused with cardamom, ginger, and aromatic spices', 1500, true, true, 3, true),
    (v_canteen_id, v_cat_beverages, 'South Indian Filter Coffee', 'Traditional frothed chicory coffee brewed in a brass filter', 2000, true, true, 3, true),
    (v_canteen_id, v_cat_beverages, 'Sweet Punjabi Lassi', 'Chilled churned creamy yogurt drink topped with a dash of cardamom', 3500, true, true, 2, true),
    (v_canteen_id, v_cat_beverages, 'Fresh Nimbu Pani', 'Refreshing chilled lemonade with black salt and cumin', 2500, true, true, 3, true)
  ON CONFLICT (canteen_id, name) DO NOTHING;

  -- 3.4 Lunch & Thali
  INSERT INTO public.menu_items (canteen_id, category_id, name, description, price_paise, is_veg, is_available, prep_minutes, is_active)
  VALUES
    (v_canteen_id, v_cat_lunch, 'Student Veg Thali', 'Daily dal, seasonal subzi, 3 phulkas, steamed rice, pickle & salad', 8000, true, true, 10, true),
    (v_canteen_id, v_cat_lunch, 'Special Deluxe Thali', 'Paneer butter masala, dal makhani, seasonal veg, 2 butter rotis, jeera rice, papad & sweet', 12000, true, true, 12, true),
    (v_canteen_id, v_cat_lunch, 'Rajma Chawal Bowl', 'Slow-cooked Punjabi red kidney beans in thick gravy over fragrant basmati rice', 7000, true, true, 5, true),
    (v_canteen_id, v_cat_lunch, 'Chole Bhature', '2 fluffy fried bhature with tangy Amritsari chickpea curry, pickled onions, and green chili', 7500, true, true, 8, true)
  ON CONFLICT (canteen_id, name) DO NOTHING;

  -- 3.5 Fast Food
  INSERT INTO public.menu_items (canteen_id, category_id, name, description, price_paise, is_veg, is_available, prep_minutes, is_active)
  VALUES
    (v_canteen_id, v_cat_fastfood, 'Veg Cheese Grilled Sandwich', 'Triple-layer sandwich with spiced potatoes, cucumber, tomato & melted processed cheese', 6000, true, true, 7, true),
    (v_canteen_id, v_cat_fastfood, 'Paneer Kathi Roll', 'Flaky paratha wrap stuffed with marinated tandoori paneer cubes, onions, and mint sauce', 8000, true, true, 8, true),
    (v_canteen_id, v_cat_fastfood, 'Veg Hakka Noodles', 'Wok-tossed noodles with shredded cabbage, bell peppers, carrots, and light soy sauce', 7000, true, true, 8, true),
    (v_canteen_id, v_cat_fastfood, 'Egg Fried Rice', 'Fragrant basmati rice stir-fried with farm eggs, spring onions, and oriental spices', 8500, false, true, 8, true),
    (v_canteen_id, v_cat_fastfood, 'Chicken Kathi Roll', 'Crisp paratha rolled with seasoned shredded chicken, caramelized onions, and spicy mayo', 9500, false, true, 9, true)
  ON CONFLICT (canteen_id, name) DO NOTHING;

  -- 3.6 Combos & Specials
  INSERT INTO public.menu_items (canteen_id, category_id, name, description, price_paise, is_veg, is_available, prep_minutes, is_active)
  VALUES
    (v_canteen_id, v_cat_combos, 'Break Fast-Track: Samosa & Chai', '1 Plate Samosa (2 pcs) paired with a piping hot cup of Masala Chai', 4000, true, true, 3, true),
    (v_canteen_id, v_cat_combos, 'South Indian Power Combo', 'Masala Dosa + 1 Medu Vada + South Indian Filter Coffee', 7500, true, true, 8, true)
  ON CONFLICT (canteen_id, name) DO NOTHING;

  -- 4. PICKUP SLOTS (Next 7 days in Asia/Kolkata IST)
  -- Windows:
  -- Morning Break: 10:30-10:45 & 10:45-11:00
  -- Lunch Break:   13:00-13:15 & 13:15-13:30
  v_today_ist := (now() AT TIME ZONE 'Asia/Kolkata')::date;

  FOR v_day_offset IN 0..6 LOOP
    v_slot_date := v_today_ist + v_day_offset;

    -- Morning Slot 1
    INSERT INTO public.pickup_slots (canteen_id, slot_date, start_time, end_time, max_orders, cutoff_minutes, is_active)
    VALUES (v_canteen_id, v_slot_date, '10:30:00', '10:45:00', 30, 15, true)
    ON CONFLICT (canteen_id, slot_date, start_time, end_time) DO NOTHING;

    -- Morning Slot 2
    INSERT INTO public.pickup_slots (canteen_id, slot_date, start_time, end_time, max_orders, cutoff_minutes, is_active)
    VALUES (v_canteen_id, v_slot_date, '10:45:00', '11:00:00', 30, 15, true)
    ON CONFLICT (canteen_id, slot_date, start_time, end_time) DO NOTHING;

    -- Lunch Slot 1
    INSERT INTO public.pickup_slots (canteen_id, slot_date, start_time, end_time, max_orders, cutoff_minutes, is_active)
    VALUES (v_canteen_id, v_slot_date, '13:00:00', '13:15:00', 30, 15, true)
    ON CONFLICT (canteen_id, slot_date, start_time, end_time) DO NOTHING;

    -- Lunch Slot 2
    INSERT INTO public.pickup_slots (canteen_id, slot_date, start_time, end_time, max_orders, cutoff_minutes, is_active)
    VALUES (v_canteen_id, v_slot_date, '13:15:00', '13:30:00', 30, 15, true)
    ON CONFLICT (canteen_id, slot_date, start_time, end_time) DO NOTHING;
  END LOOP;

  RAISE NOTICE 'Seed completed successfully for canteen id: %', v_canteen_id;
END;
$$;
