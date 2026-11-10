import Image from "next/image";
import { cn } from "@/lib/utils";

interface BrandWordmarkProps {
  className?: string;
  imageClassName?: string;
  priority?: boolean;
}

/**
 * Shared C@MPBITE brand title wordmark component.
 *
 * Guarantees:
 * 1. Uses ONLY the official brand title artwork (/brand/campbite-title-light.png and /brand/campbite-title-dark.png)
 * 2. Switched cleanly via dark: classes (dark:hidden on light, hidden dark:block on dark)
 * 3. Keeps the distinctive crimson red '@' symbol and chunky custom letterforms exactly as designed
 * 4. Ensures accessible text for screen readers ("C@mpBite")
 */
export function BrandWordmark({
  className,
  imageClassName = "h-5 xs:h-6 sm:h-7 w-auto object-contain",
  priority = false,
}: BrandWordmarkProps) {
  return (
    <span className={cn("inline-flex items-center select-none", className)}>
      <span className="sr-only">C@mpBite</span>
      {/* Light mode wordmark */}
      <Image
        src="/brand/campbite-title-light.png"
        alt="C@MPBITE"
        width={180}
        height={29}
        className={cn("dark:hidden", imageClassName)}
        priority={priority}
      />
      {/* Dark mode wordmark */}
      <Image
        src="/brand/campbite-title-dark.png"
        alt="C@MPBITE"
        width={180}
        height={29}
        className={cn("hidden dark:block", imageClassName)}
        priority={priority}
      />
    </span>
  );
}
