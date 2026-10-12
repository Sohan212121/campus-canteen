import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ICONS_DIR = path.resolve(process.cwd(), "public", "icons");

if (!fs.existsSync(ICONS_DIR)) {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
}

// Clean canteen utensils SVG with badge background
function generateSvg({ size, isMaskable = false }) {
  // Safe zone for maskable icon is the inner 80% (padding 10% on each edge)
  // Standard icon can have slightly more prominence (inner 86%)
  const paddingPercent = isMaskable ? 0.20 : 0.14; // margin from edges
  const artSize = size * (1 - paddingPercent * 2);
  const offset = size * paddingPercent;

  // Utensils path scaled to artSize
  // ViewBox of art is 24x24 (Lucide UtensilsCrossed / Fork & Spoon style)
  const scale = artSize / 24;

  return `
<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#18181b"/>
      <stop offset="100%" stop-color="#09090b"/>
    </linearGradient>
    <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f97316"/>
      <stop offset="100%" stop-color="#ea580c"/>
    </linearGradient>
  </defs>

  <!-- Background tile -->
  <rect width="${size}" height="${size}" rx="${isMaskable ? 0 : size * 0.22}" fill="url(#bgGrad)"/>

  <!-- Centered Inner Accent Container -->
  <g transform="translate(${offset}, ${offset}) scale(${scale})">
    <!-- Circle badge behind cutlery -->
    <circle cx="12" cy="12" r="10.5" fill="#27272a" stroke="#3f3f46" stroke-width="0.8"/>
    
    <!-- Plate rim subtle ring -->
    <circle cx="12" cy="12" r="8" fill="none" stroke="#52525b" stroke-width="0.5" stroke-dasharray="1.5 1"/>

    <!-- Fork & Knife crossed (Lucide UtensilsCrossed) -->
    <g fill="none" stroke="#f43f5e" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <!-- Fork on left -->
      <path d="m16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8" stroke="url(#accentGrad)"/>
      <path d="M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7" stroke="#ffffff"/>
      <path d="m2.1 21.8 6.4-6.3" stroke="url(#accentGrad)"/>
      <path d="m19 5-7 7" stroke="#ffffff"/>
    </g>
  </g>
</svg>
`;
}

async function main() {
  console.log("Generating PWA icons...");

  const targets = [
    { name: "icon-192.png", size: 192, maskable: false },
    { name: "icon-512.png", size: 512, maskable: false },
    { name: "icon-maskable-512.png", size: 512, maskable: true },
  ];

  for (const target of targets) {
    const svg = generateSvg({ size: target.size, isMaskable: target.maskable });
    const dest = path.join(ICONS_DIR, target.name);

    await sharp(Buffer.from(svg))
      .resize(target.size, target.size)
      .png({ compressionLevel: 9 })
      .toFile(dest);

    const stats = fs.statSync(dest);
    const meta = await sharp(dest).metadata();
    console.log(
      `✓ ${target.name}: ${meta.width}x${meta.height}px, ${stats.size} bytes (maskable: ${target.maskable})`
    );
  }

  console.log("PWA icon generation complete.");
}

main().catch((err) => {
  console.error("Failed to generate icons:", err);
  process.exit(1);
});
