"use client";

import { useEffect, useState, useMemo } from "react";
import { generateConfettiPieces, CONFETTI_COLORS } from "@/lib/confetti";

interface ConfettiBurstProps {
  count?: number;
  reducedMotion?: boolean;
}

export function ConfettiBurst({
  count = 28,
  reducedMotion = false,
}: ConfettiBurstProps) {
  const [isAlive, setIsAlive] = useState(true);

  // Deterministic pieces computed once per mount
  const pieces = useMemo(() => {
    return generateConfettiPieces(count);
  }, [count]);

  // Automatically remove pieces from the DOM after animation completes (~3.2 seconds)
  useEffect(() => {
    if (reducedMotion) return;

    const timer = setTimeout(() => {
      setIsAlive(false);
    }, 3200);

    return () => clearTimeout(timer);
  }, [reducedMotion]);

  if (reducedMotion || !isAlive) {
    return null;
  }

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
    >
      {pieces.map((piece) => {
        const bg = CONFETTI_COLORS[piece.colorIndex];
        const borderRadius =
          piece.shape === "circle"
            ? "50%"
            : piece.shape === "square"
            ? "2px"
            : "1px";
        const width = piece.shape === "rect" ? piece.sizePx * 2 : piece.sizePx;
        const height = piece.sizePx;

        return (
          <span
            key={piece.id}
            className="absolute block pointer-events-none"
            style={
              {
                left: "50%",
                top: "38%",
                width: `${width}px`,
                height: `${height}px`,
                backgroundColor: bg,
                borderRadius,
                "--cc-tx": `${piece.x}px`,
                "--cc-ty": `${piece.y}px`,
                "--cc-rot": `${piece.rotation}deg`,
                animation: `cc-confetti-burst ${piece.durationMs}ms cubic-bezier(0.25, 0.46, 0.45, 0.94) ${piece.delayMs}ms both`,
              } as React.CSSProperties
            }
          />
        );
      })}
    </div>
  );
}

