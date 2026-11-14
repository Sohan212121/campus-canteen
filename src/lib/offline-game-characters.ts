/**
 * Food characters and canvas rendering routines for the offline mini-game.
 *
 * Each character shares the EXACT SAME hitbox dimensions (BURGER_WIDTH x BURGER_HEIGHT_NORMAL,
 * and BURGER_HEIGHT_DUCK when ducking) for 100% fair gameplay.
 *
 * Persists character selection via `cc_offline_character_v1` in localStorage.
 */

import { BurgerPlayer } from "./offline-game";

export const CHARACTER_STORAGE_KEY = "cc_offline_character_v1";

export type CharacterId =
  | "burger"
  | "pizza"
  | "samosa"
  | "donut"
  | "fries"
  | "hotdog"
  | "icecream";

export interface FoodCharacter {
  id: CharacterId;
  name: string;
  draw: (
    ctx: CanvasRenderingContext2D,
    player: BurgerPlayer,
    legCycle: number,
    isDark: boolean
  ) => void;
}

// ============================================================================
// 1. CHARACTER STORAGE HELPER
// ============================================================================

const VALID_CHARACTER_IDS = new Set<CharacterId>([
  "burger",
  "pizza",
  "samosa",
  "donut",
  "fries",
  "hotdog",
  "icecream",
]);

function getStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
    if (
      typeof globalThis !== "undefined" &&
      (globalThis as unknown as { localStorage?: Storage }).localStorage
    ) {
      return (globalThis as unknown as { localStorage: Storage }).localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

export function getOfflineCharacter(): CharacterId {
  const storage = getStorage();
  if (!storage) return "burger";
  try {
    const raw = storage.getItem(CHARACTER_STORAGE_KEY);
    if (!raw) return "burger";
    const cleaned = raw.trim().toLowerCase();
    return VALID_CHARACTER_IDS.has(cleaned as CharacterId)
      ? (cleaned as CharacterId)
      : "burger";
  } catch {
    return "burger";
  }
}

export function saveOfflineCharacter(id: CharacterId): CharacterId {
  const storage = getStorage();
  const safeId: CharacterId = VALID_CHARACTER_IDS.has(id) ? id : "burger";
  if (!storage) return safeId;
  try {
    storage.setItem(CHARACTER_STORAGE_KEY, safeId);
    return safeId;
  } catch {
    return safeId;
  }
}

// ============================================================================
// 2. SHARED RUNNING LEGS RENDERER
// ============================================================================

function drawRunningLegs(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  legCycle: number,
  isDark: boolean
) {
  const legOffset = Math.sin(legCycle) * 3;
  ctx.strokeStyle = isDark ? "#E2E8F0" : "#44403C";
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";

  // Left leg
  ctx.beginPath();
  ctx.moveTo(width * 0.35, height - 2);
  ctx.lineTo(width * 0.35 - legOffset, height + 4);
  ctx.stroke();

  // Right leg
  ctx.beginPath();
  ctx.moveTo(width * 0.65, height - 2);
  ctx.lineTo(width * 0.65 + legOffset, height + 4);
  ctx.stroke();
}

// ============================================================================
// 3. CHARACTER CANVAS DRAWING ROUTINES (Pure Canvas Vectors)
// ============================================================================

/**
 * 1. Burger (Classic Burger with sesame seeds, patty, cheese, lettuce)
 */
export function drawBurger(
  ctx: CanvasRenderingContext2D,
  player: BurgerPlayer,
  legCycle: number,
  isDark: boolean
) {
  const { x, y, width, height, isGrounded, isDucking } = player;

  ctx.save();
  ctx.translate(x, y);

  if (isGrounded && !isDucking) {
    drawRunningLegs(ctx, width, height, legCycle, isDark);
  }

  // Bottom bun
  ctx.fillStyle = isDark ? "#E5A93C" : "#D48B30";
  ctx.beginPath();
  ctx.roundRect(0, height * 0.72, width, height * 0.28, [0, 0, 5, 5]);
  ctx.fill();

  // Patty
  ctx.fillStyle = isDark ? "#6E361A" : "#4E210D";
  ctx.beginPath();
  ctx.roundRect(2, height * 0.52, width - 4, height * 0.22, 3);
  ctx.fill();

  // Cheese layer
  ctx.fillStyle = "#F59E0B";
  ctx.beginPath();
  ctx.moveTo(3, height * 0.52);
  ctx.lineTo(width - 3, height * 0.52);
  ctx.lineTo(width * 0.6, height * 0.62);
  ctx.lineTo(width * 0.45, height * 0.53);
  ctx.closePath();
  ctx.fill();

  // Wavy Lettuce
  ctx.fillStyle = "#22C55E";
  ctx.beginPath();
  ctx.roundRect(1, height * 0.4, width - 2, height * 0.14, 2);
  ctx.fill();

  // Top bun dome
  ctx.fillStyle = isDark ? "#F59E0B" : "#E08F2A";
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height * 0.42, [10, 10, 2, 2]);
  ctx.fill();

  // Sesame seeds
  ctx.fillStyle = "#FEF3C7";
  const seeds = [
    [width * 0.3, height * 0.16],
    [width * 0.52, height * 0.12],
    [width * 0.7, height * 0.18],
    [width * 0.4, height * 0.26],
  ];
  for (const [sx, sy] of seeds) {
    ctx.beginPath();
    ctx.ellipse(sx, sy, 1.4, 0.8, -0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/**
 * 2. Pizza Slice (Triangular cheesy slice with pepperoni dots)
 */
export function drawPizza(
  ctx: CanvasRenderingContext2D,
  player: BurgerPlayer,
  legCycle: number,
  isDark: boolean
) {
  const { x, y, width, height, isGrounded, isDucking } = player;

  ctx.save();
  ctx.translate(x, y);

  if (isGrounded && !isDucking) {
    drawRunningLegs(ctx, width, height, legCycle, isDark);
  }

  // Crust at the top
  ctx.fillStyle = isDark ? "#D97706" : "#B45309";
  ctx.beginPath();
  ctx.roundRect(1, 1, width - 2, height * 0.22, 4);
  ctx.fill();

  // Pizza body triangle (crust to tip)
  ctx.fillStyle = isDark ? "#F59E0B" : "#FBBF24";
  ctx.beginPath();
  ctx.moveTo(3, height * 0.22);
  ctx.lineTo(width - 3, height * 0.22);
  ctx.lineTo(width * 0.5, height - 2);
  ctx.closePath();
  ctx.fill();

  // Melted cheese drip highlights
  ctx.fillStyle = "#FEF08A";
  ctx.beginPath();
  ctx.arc(width * 0.4, height * 0.38, 2, 0, Math.PI * 2);
  ctx.arc(width * 0.65, height * 0.46, 2.2, 0, Math.PI * 2);
  ctx.fill();

  // Pepperoni slices
  ctx.fillStyle = isDark ? "#DC2626" : "#B91C1C";
  const peps = [
    [width * 0.5, height * 0.4, 3.2],
    [width * 0.35, height * 0.6, 2.5],
    [width * 0.65, height * 0.62, 2.5],
  ];
  for (const [px, py, pr] of peps) {
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
  }

  // Basil/herb flakes
  ctx.fillStyle = "#16A34A";
  ctx.fillRect(width * 0.52, height * 0.72, 2, 2);
  ctx.fillRect(width * 0.42, height * 0.5, 2, 2);

  ctx.restore();
}

/**
 * 3. Samosa (Crispy golden triangular fried pastry with spice specks)
 */
export function drawSamosa(
  ctx: CanvasRenderingContext2D,
  player: BurgerPlayer,
  legCycle: number,
  isDark: boolean
) {
  const { x, y, width, height, isGrounded, isDucking } = player;

  ctx.save();
  ctx.translate(x, y);

  if (isGrounded && !isDucking) {
    drawRunningLegs(ctx, width, height, legCycle, isDark);
  }

  // Golden triangular body
  ctx.fillStyle = isDark ? "#D97706" : "#C27803";
  ctx.beginPath();
  ctx.moveTo(width * 0.5, 2);
  ctx.lineTo(width - 2, height - 3);
  ctx.lineTo(2, height - 3);
  ctx.closePath();
  ctx.fill();

  // Crispy bottom crimped edge fold
  ctx.fillStyle = isDark ? "#B45309" : "#92400E";
  ctx.beginPath();
  ctx.roundRect(1, height - 6, width - 2, 5, 2);
  ctx.fill();

  // Pastry seam line
  ctx.strokeStyle = isDark ? "#FBBF24" : "#FDE68A";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(width * 0.5, 4);
  ctx.lineTo(width * 0.42, height - 6);
  ctx.stroke();

  // Fried cumin / ajwain seed specks
  ctx.fillStyle = isDark ? "#78350F" : "#451A03";
  const specks = [
    [width * 0.35, height * 0.45],
    [width * 0.6, height * 0.38],
    [width * 0.55, height * 0.65],
    [width * 0.3, height * 0.72],
  ];
  for (const [sx, sy] of specks) {
    ctx.beginPath();
    ctx.ellipse(sx, sy, 1.2, 0.6, 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/**
 * 4. Donut (Glazed ring donut with strawberry icing and sprinkles)
 */
export function drawDonut(
  ctx: CanvasRenderingContext2D,
  player: BurgerPlayer,
  legCycle: number,
  isDark: boolean
) {
  const { x, y, width, height, isGrounded, isDucking } = player;

  ctx.save();
  ctx.translate(x, y);

  if (isGrounded && !isDucking) {
    drawRunningLegs(ctx, width, height, legCycle, isDark);
  }

  const cx = width / 2;
  const cy = height / 2;
  const rx = width / 2 - 2;
  const ry = height / 2 - 2;

  // Golden dough ring
  ctx.fillStyle = isDark ? "#D97706" : "#D48B30";
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();

  // Strawberry frosting
  ctx.fillStyle = isDark ? "#F43F5E" : "#FB7185";
  ctx.beginPath();
  ctx.ellipse(cx, cy - 1, rx * 0.88, ry * 0.85, 0, 0, Math.PI * 2);
  ctx.fill();

  // Dough cutout center hole
  ctx.fillStyle = isDark ? "#0B0D13" : "#F7F2E8";
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * 0.32, ry * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();

  // Sprinkles (white, yellow, cyan)
  const sprinkles = [
    { x: cx - 8, y: cy - 7, color: "#FFFFFF", rot: 0.2 },
    { x: cx + 6, y: cy - 6, color: "#FACC15", rot: -0.4 },
    { x: cx - 7, y: cy + 5, color: "#38BDF8", rot: 0.7 },
    { x: cx + 7, y: cy + 4, color: "#FFFFFF", rot: -0.2 },
    { x: cx, y: cy - 9, color: "#4ADE80", rot: 0.5 },
  ];
  for (const s of sprinkles) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.rot);
    ctx.fillStyle = s.color;
    ctx.fillRect(-2, -0.8, 4, 1.6);
    ctx.restore();
  }

  ctx.restore();
}

/**
 * 5. Fries Box (Red campus canteen carton with crispy golden fries)
 */
export function drawFries(
  ctx: CanvasRenderingContext2D,
  player: BurgerPlayer,
  legCycle: number,
  isDark: boolean
) {
  const { x, y, width, height, isGrounded, isDucking } = player;

  ctx.save();
  ctx.translate(x, y);

  if (isGrounded && !isDucking) {
    drawRunningLegs(ctx, width, height, legCycle, isDark);
  }

  // Golden fries sticking out of box
  ctx.fillStyle = isDark ? "#F59E0B" : "#FBBF24";
  const friesList = [
    { x: width * 0.18, top: height * 0.08, w: 3.5 },
    { x: width * 0.32, top: height * 0.02, w: 3.5 },
    { x: width * 0.48, top: height * 0.05, w: 3.5 },
    { x: width * 0.64, top: height * 0.01, w: 3.5 },
    { x: width * 0.78, top: height * 0.1, w: 3.5 },
  ];
  for (const f of friesList) {
    ctx.beginPath();
    ctx.roundRect(f.x, f.top, f.w, height * 0.6, 1.5);
    ctx.fill();
  }

  // Red carton body
  ctx.fillStyle = isDark ? "#DC2626" : "#EF4444";
  ctx.beginPath();
  ctx.moveTo(2, height * 0.42);
  ctx.lineTo(width - 2, height * 0.42);
  ctx.lineTo(width - 5, height - 2);
  ctx.lineTo(5, height - 2);
  ctx.closePath();
  ctx.fill();

  // Carton cutout scoop on front
  ctx.fillStyle = isDark ? "#B91C1C" : "#DC2626";
  ctx.beginPath();
  ctx.ellipse(width * 0.5, height * 0.42, width * 0.38, height * 0.08, 0, 0, Math.PI);
  ctx.fill();

  // Yellow badge/lettermark on carton
  ctx.fillStyle = "#FACC15";
  ctx.beginPath();
  ctx.arc(width * 0.5, height * 0.68, 4.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/**
 * 6. Hot Dog (Grilled sausage in a warm bun with mustard zigzag)
 */
export function drawHotDog(
  ctx: CanvasRenderingContext2D,
  player: BurgerPlayer,
  legCycle: number,
  isDark: boolean
) {
  const { x, y, width, height, isGrounded, isDucking } = player;

  ctx.save();
  ctx.translate(x, y);

  if (isGrounded && !isDucking) {
    drawRunningLegs(ctx, width, height, legCycle, isDark);
  }

  // Bun bottom
  ctx.fillStyle = isDark ? "#D97706" : "#D48B30";
  ctx.beginPath();
  ctx.roundRect(1, height * 0.48, width - 2, height * 0.48, 6);
  ctx.fill();

  // Grilled sausage
  ctx.fillStyle = isDark ? "#991B1B" : "#B91C1C";
  ctx.beginPath();
  ctx.roundRect(0, height * 0.3, width, height * 0.32, 6);
  ctx.fill();

  // Bun top side lip
  ctx.fillStyle = isDark ? "#F59E0B" : "#E08F2A";
  ctx.beginPath();
  ctx.roundRect(2, height * 0.16, width - 4, height * 0.24, 4);
  ctx.fill();

  // Wavy mustard zigzag
  ctx.strokeStyle = "#FACC15";
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(4, height * 0.46);
  ctx.lineTo(10, height * 0.36);
  ctx.lineTo(16, height * 0.48);
  ctx.lineTo(22, height * 0.36);
  ctx.lineTo(28, height * 0.46);
  ctx.stroke();

  ctx.restore();
}

/**
 * 7. Ice Cream Cone (Waffle cone with double scoops and a cherry)
 */
export function drawIceCream(
  ctx: CanvasRenderingContext2D,
  player: BurgerPlayer,
  legCycle: number,
  isDark: boolean
) {
  const { x, y, width, height, isGrounded, isDucking } = player;

  ctx.save();
  ctx.translate(x, y);

  if (isGrounded && !isDucking) {
    drawRunningLegs(ctx, width, height, legCycle, isDark);
  }

  // Waffle cone triangle
  ctx.fillStyle = isDark ? "#B45309" : "#D97706";
  ctx.beginPath();
  ctx.moveTo(4, height * 0.48);
  ctx.lineTo(width - 4, height * 0.48);
  ctx.lineTo(width * 0.5, height - 2);
  ctx.closePath();
  ctx.fill();

  // Waffle cone grid lines
  ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(width * 0.35, height * 0.48);
  ctx.lineTo(width * 0.5, height * 0.85);
  ctx.moveTo(width * 0.65, height * 0.48);
  ctx.lineTo(width * 0.5, height * 0.85);
  ctx.stroke();

  // Bottom scoop (vanilla/strawberry)
  ctx.fillStyle = isDark ? "#FB7185" : "#FDA4AF";
  ctx.beginPath();
  ctx.arc(width * 0.5, height * 0.38, width * 0.38, 0, Math.PI * 2);
  ctx.fill();

  // Top scoop (mint/cream)
  ctx.fillStyle = isDark ? "#34D399" : "#6EE7B7";
  ctx.beginPath();
  ctx.arc(width * 0.5, height * 0.2, width * 0.28, 0, Math.PI * 2);
  ctx.fill();

  // Cherry on top
  ctx.fillStyle = "#EF4444";
  ctx.beginPath();
  ctx.arc(width * 0.5, height * 0.08, 3, 0, Math.PI * 2);
  ctx.fill();

  // Cherry stem
  ctx.strokeStyle = isDark ? "#A1A1AA" : "#57534E";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(width * 0.5, height * 0.05);
  ctx.quadraticCurveTo(width * 0.6, height * 0.01, width * 0.68, height * 0.02);
  ctx.stroke();

  ctx.restore();
}

// ============================================================================
// 4. CHARACTER REGISTRY
// ============================================================================

export const FOOD_CHARACTERS: FoodCharacter[] = [
  { id: "burger", name: "Burger", draw: drawBurger },
  { id: "pizza", name: "Pizza Slice", draw: drawPizza },
  { id: "samosa", name: "Samosa", draw: drawSamosa },
  { id: "donut", name: "Donut", draw: drawDonut },
  { id: "fries", name: "Fries Box", draw: drawFries },
  { id: "hotdog", name: "Hot Dog", draw: drawHotDog },
  { id: "icecream", name: "Ice Cream", draw: drawIceCream },
];

export function getCharacterById(id: CharacterId): FoodCharacter {
  const found = FOOD_CHARACTERS.find((c) => c.id === id);
  return found ?? FOOD_CHARACTERS[0];
}
