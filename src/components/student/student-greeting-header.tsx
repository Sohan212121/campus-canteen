"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { RotateCw, ArrowRight } from "lucide-react";

interface StudentGreetingHeaderProps {
  fullName?: string | null;
  initialHour?: number;
}

export interface ZomatoQuote {
  category: "Cheesy" | "Flirty" | "Humour" | "Motivation" | "Campus Life";
  emoji: string;
  headline: string;
  quote: string;
}

export const ZOMATO_FOOD_QUOTES: ZomatoQuote[] = [
  // Flirty & Cheesy (Zomato Classic Notifications)
  {
    category: "Flirty",
    emoji: "🍟",
    headline: "Can't resist you",
    quote: "Are you french fries? Because no matter how full I am, I always have space for you.",
  },
  {
    category: "Cheesy",
    emoji: "🧀",
    headline: "Melted over you",
    quote: "You're the extra melted cheese on my pizza—holding my whole chaotic day together.",
  },
  {
    category: "Flirty",
    emoji: "🍗",
    headline: "All I ever wanted",
    quote: "Are you chicken dum biryani? Because even with extra elaichi, you're the best part of my day.",
  },
  {
    category: "Cheesy",
    emoji: "☕",
    headline: "Piping hot bond",
    quote: "Relationship status: In a committed, unbreakable relationship with hot cutting chai and samosas.",
  },
  {
    category: "Flirty",
    emoji: "🌯",
    headline: "Spicy crush",
    quote: "Stop staring at your campus crush during lectures—they won't feed you. Order that paneer kathi roll instead.",
  },
  {
    category: "Cheesy",
    emoji: "🍕",
    headline: "True commitment",
    quote: "I love you more than cold pizza at 2 AM, and honestly, that's the highest honor I can give.",
  },
  {
    category: "Flirty",
    emoji: "🍯",
    headline: "Sweet tooth",
    quote: "Are you warm gulab jamun? Because you're dangerously sweet and impossible to stop at one.",
  },
  {
    category: "Cheesy",
    emoji: "🥟",
    headline: "Poetic cravings",
    quote: "Roses are red, samosas are hot. I promised I'd take one bite, but devoured the whole lot.",
  },
  {
    category: "Flirty",
    emoji: "🌶️",
    headline: "Instant connection",
    quote: "Is your name butter chicken? Because you just made everything in my day 10x richer.",
  },
  {
    category: "Cheesy",
    emoji: "🥪",
    headline: "Soulmate test",
    quote: "If we both reach for the last grilled cheese sandwich at the counter, is it true love or a campus duel?",
  },
  {
    category: "Flirty",
    emoji: "🍩",
    headline: "Sweet surrender",
    quote: "Forget butterflies in the stomach. I want chocolate donuts and crispy puffs in my stomach.",
  },
  {
    category: "Cheesy",
    emoji: "🫓",
    headline: "Heart's GPS",
    quote: "I followed my heart, and it led me straight to the canteen's fresh paratha counter.",
  },

  // Humour & Relatable Campus Life
  {
    category: "Humour",
    emoji: "🥗",
    headline: "Diet update",
    quote: "I've been on a 30-day strict diet. So far, I've lost 15 days and absolutely 0 grams of biryani.",
  },
  {
    category: "Campus Life",
    emoji: "📚",
    headline: "Risk assessment",
    quote: "Attendance at 74%? Extremely risky. But skipping your canteen break? Unacceptable behavior.",
  },
  {
    category: "Humour",
    emoji: "🧪",
    headline: "Break physics",
    quote: "Calories consumed between 10 AM and 4 PM during break do not count. It's written in campus bylaws.",
  },
  {
    category: "Campus Life",
    emoji: "🏃",
    headline: "Cardio training",
    quote: "The only sprint I ever train for is rushing to the canteen before the whole batch empties the snack counter.",
  },
  {
    category: "Humour",
    emoji: "🧀",
    headline: "Assignment therapy",
    quote: "Stressed about assignments? Add extra cheese. Science proves everything hurts 40% less with cheese.",
  },
  {
    category: "Campus Life",
    emoji: "⚡",
    headline: "Supreme flex",
    quote: "Walking past the crowded physical canteen queue with a ready pre-order token is the ultimate student flex.",
  },
  {
    category: "Humour",
    emoji: "🍔",
    headline: "Grammar lesson",
    quote: "There is no 'we' in food. It's 'me', 'myself', and this double patty burger. Don't touch the fries.",
  },
  {
    category: "Campus Life",
    emoji: "🔔",
    headline: "Conditioned response",
    quote: "The lecture bell ringing is just Pavlovian conditioning for your stomach to scream 'Canteen time!'.",
  },
  {
    category: "Humour",
    emoji: "🧠",
    headline: "Brain vs Hunger",
    quote: "Dear brain: please perform in exams with the same unmatched enthusiasm as you display while picking lunch.",
  },
  {
    category: "Humour",
    emoji: "💸",
    headline: "Budget clash",
    quote: "My bank balance says 'eat air', but the canteen aroma insists 'you deserve a rich butter masala dosa'.",
  },
  {
    category: "Campus Life",
    emoji: "🤝",
    headline: "Campus truce",
    quote: "There is no group project conflict that cannot be amicably solved over hot chai and Maggi.",
  },
  {
    category: "Humour",
    emoji: "🚨",
    headline: "Emergency dispatch",
    quote: "Hunger is the only emergency on campus that can be fully cured in 4 minutes flat with a hot roll.",
  },
  {
    category: "Humour",
    emoji: "🍪",
    headline: "Zero regrets",
    quote: "I regret nothing. Except that one time in first semester when I chose not to order extra fries.",
  },
  {
    category: "Campus Life",
    emoji: "🎒",
    headline: "Survival kit",
    quote: "Pens: optional. Notebooks: borrowed. Pre-ordered canteen token: loaded and ready.",
  },

  // Food Motivation & Uplifting Quotes
  {
    category: "Motivation",
    emoji: "🎯",
    headline: "Priority check",
    quote: "First we eat, then we conquer the semester. Prioritize your victories in the right order.",
  },
  {
    category: "Motivation",
    emoji: "🌟",
    headline: "Know your worth",
    quote: "Never let anyone treat you like leftover tiffin sabzi. You are fresh weekend dum biryani.",
  },
  {
    category: "Motivation",
    emoji: "🍰",
    headline: "Cosmic sign",
    quote: "Stress spelled backwards is literally Desserts. The universe is telling you to take a delicious break.",
  },
  {
    category: "Motivation",
    emoji: "🚀",
    headline: "Future fuel",
    quote: "Your future graduated self will thank you for fueling up with good food right now. Go eat!",
  },
  {
    category: "Motivation",
    emoji: "☕",
    headline: "Engine fuel",
    quote: "One cannot think well, love well, or debug code well, if one has not dined well.",
  },
  {
    category: "Motivation",
    emoji: "🔋",
    headline: "Recharge mode",
    quote: "Low battery? A warm meal with hot masala chai recharges 100% of your academic stamina.",
  },
  {
    category: "Motivation",
    emoji: "❤️",
    headline: "Heart's truth",
    quote: "Never let anyone convince you that one samosa is enough. Always listen to your heart.",
  },
  {
    category: "Motivation",
    emoji: "🌈",
    headline: "Turnaround power",
    quote: "Even the toughest lecture day looks 100x brighter after a piping hot plate of chole bhature.",
  },
  {
    category: "Motivation",
    emoji: "🌯",
    headline: "Balanced life",
    quote: "A perfectly balanced college lifestyle is a roll in each hand and zero regrets in your heart.",
  },
  {
    category: "Motivation",
    emoji: "🫖",
    headline: "Sip of peace",
    quote: "Keep calm, breathe deep, and let the aroma of fresh cardamom chai reset your whole mood.",
  },
  {
    category: "Motivation",
    emoji: "🍪",
    headline: "You got this",
    quote: "You're working hard this semester. Treat yourself to something delicious—you earned every bite.",
  },
  {
    category: "Motivation",
    emoji: "👑",
    headline: "Campus royalty",
    quote: "Eat well, walk to the counter with your head held high, and never apologize for second helpings.",
  },
];

/**
 * Creates a randomized permutation of array indices using Fisher-Yates,
 * ensuring the first item of a new shuffle does not repeat the last item of the previous deck.
 */
function createShuffledIndices(length: number, previousLastIndex: number = -1): number[] {
  const indices = Array.from({ length }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  if (previousLastIndex >= 0 && indices[0] === previousLastIndex && indices.length > 1) {
    [indices[0], indices[indices.length - 1]] = [indices[indices.length - 1], indices[0]];
  }
  return indices;
}

export function StudentGreetingHeader({ fullName }: StudentGreetingHeaderProps) {
  // Extract clean first name
  const firstName = fullName?.trim() ? fullName.trim().split(" ")[0] : "Student";

  // 3D Card flip state: false = Front (Welcome greeting), true = Back (Food quote card)
  const [isFlipped, setIsFlipped] = useState(false);
  const [isSpinningNext, setIsSpinningNext] = useState(false);

  // 3D Tilt container reference and animation frame tracking
  const tiltRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  // Non-repeating randomized quote deck: guarantees a different message on every single click
  const deckRef = useRef<number[]>([]);
  const deckPointerRef = useRef<number>(0);
  const lastPickedIndexRef = useRef<number>(-1);

  // Initial quote
  const [currentQuote, setCurrentQuote] = useState<ZomatoQuote>(ZOMATO_FOOD_QUOTES[0]);

  // Pull next unique random quote from the shuffle deck
  const getNextQuote = useCallback((): ZomatoQuote => {
    if (deckRef.current.length === 0 || deckPointerRef.current >= deckRef.current.length) {
      deckRef.current = createShuffledIndices(ZOMATO_FOOD_QUOTES.length, lastPickedIndexRef.current);
      deckPointerRef.current = 0;
    }
    const quoteIndex = deckRef.current[deckPointerRef.current];
    deckPointerRef.current += 1;
    lastPickedIndexRef.current = quoteIndex;
    return ZOMATO_FOOD_QUOTES[quoteIndex];
  }, []);

  // Handler: Flips to back face and loads a fresh quote
  const handleFrontClick = useCallback(() => {
    const nextQuote = getNextQuote();
    setCurrentQuote(nextQuote);
    setIsFlipped(true);
  }, [getNextQuote]);

  // Handler: Flips back to the greeting front face
  const handleFlipBack = useCallback(() => {
    setIsFlipped(false);
  }, []);

  // Handler: Cycles to the next quote on the back face with smooth 3D flip spin
  const handleNextQuote = useCallback(() => {
    if (isSpinningNext) return;
    setIsSpinningNext(true);

    // Halfway through spin (when edge-on), swap to the next unique quote
    setTimeout(() => {
      const nextQuote = getNextQuote();
      setCurrentQuote(nextQuote);
    }, 200);

    // Reset spin animation class
    setTimeout(() => {
      setIsSpinningNext(false);
    }, 450);
  }, [getNextQuote, isSpinningNext]);

  // 3D Tilt handlers: Cursor tracking with buttery smooth spring transition and depth shadow
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!tiltRef.current) return;
    const rect = tiltRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const percentX = Math.max(-1, Math.min(1, (x - centerX) / centerX));
    const percentY = Math.max(-1, Math.min(1, (y - centerY) / centerY));

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = requestAnimationFrame(() => {
      if (!tiltRef.current) return;
      const rotateX = -percentY * 8.5;
      const rotateY = percentX * 8.5;
      const shadowX = -percentX * 16;
      const shadowY = -percentY * 16 + 20;
      const glareX = Math.max(0, Math.min(100, (x / rect.width) * 100));
      const glareY = Math.max(0, Math.min(100, (y / rect.height) * 100));

      tiltRef.current.style.setProperty("--tilt-rx", `${rotateX.toFixed(2)}deg`);
      tiltRef.current.style.setProperty("--tilt-ry", `${rotateY.toFixed(2)}deg`);
      tiltRef.current.style.setProperty("--tilt-scale", "1.018");
      tiltRef.current.style.setProperty("--shadow-x", `${shadowX.toFixed(1)}px`);
      tiltRef.current.style.setProperty("--shadow-y", `${shadowY.toFixed(1)}px`);
      tiltRef.current.style.setProperty("--glare-x", `${glareX.toFixed(1)}%`);
      tiltRef.current.style.setProperty("--glare-y", `${glareY.toFixed(1)}%`);
      tiltRef.current.style.setProperty("--glare-opacity", "1");
    });
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (!tiltRef.current) return;
    tiltRef.current.setAttribute("data-hovered", "true");
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    if (!tiltRef.current) return;
    tiltRef.current.removeAttribute("data-hovered");
    tiltRef.current.style.setProperty("--tilt-rx", "0deg");
    tiltRef.current.style.setProperty("--tilt-ry", "0deg");
    tiltRef.current.style.setProperty("--tilt-scale", "1");
    tiltRef.current.style.setProperty("--shadow-x", "0px");
    tiltRef.current.style.setProperty("--shadow-y", "6px");
    tiltRef.current.style.setProperty("--glare-opacity", "0");
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (!tiltRef.current || e.touches.length === 0) return;
    const touch = e.touches[0];
    const rect = tiltRef.current.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    if (x < 0 || x > rect.width || y < 0 || y > rect.height) {
      handleMouseLeave();
      return;
    }
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const percentX = Math.max(-1, Math.min(1, (x - centerX) / centerX));
    const percentY = Math.max(-1, Math.min(1, (y - centerY) / centerY));

    tiltRef.current.setAttribute("data-hovered", "true");
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = requestAnimationFrame(() => {
      if (!tiltRef.current) return;
      const rotateX = -percentY * 6;
      const rotateY = percentX * 6;
      const shadowX = -percentX * 12;
      const shadowY = -percentY * 12 + 16;
      const glareX = Math.max(0, Math.min(100, (x / rect.width) * 100));
      const glareY = Math.max(0, Math.min(100, (y / rect.height) * 100));

      tiltRef.current.style.setProperty("--tilt-rx", `${rotateX.toFixed(2)}deg`);
      tiltRef.current.style.setProperty("--tilt-ry", `${rotateY.toFixed(2)}deg`);
      tiltRef.current.style.setProperty("--tilt-scale", "1.012");
      tiltRef.current.style.setProperty("--shadow-x", `${shadowX.toFixed(1)}px`);
      tiltRef.current.style.setProperty("--shadow-y", `${shadowY.toFixed(1)}px`);
      tiltRef.current.style.setProperty("--glare-x", `${glareX.toFixed(1)}%`);
      tiltRef.current.style.setProperty("--glare-y", `${glareY.toFixed(1)}%`);
      tiltRef.current.style.setProperty("--glare-opacity", "1");
    });
  }, [handleMouseLeave]);

  const handleTouchEnd = useCallback(() => {
    handleMouseLeave();
  }, [handleMouseLeave]);

  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  return (
    <div
      ref={tiltRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="tilt-card-wrapper relative w-full rounded-2xl select-none"
      aria-label="Interactive campus greeting and food cravings card"
    >
      <div className="flip-card-container w-full">
        <div
          className={`flip-card-inner ${isFlipped ? "flip-card-flipped" : ""} ${
            isSpinningNext ? "animate-flip-quote-spin" : ""
          }`}
        >
          {/* =========================================================================
              FRONT FACE: CLEAN, PROFESSIONAL GREETING WITH COOL FOOD MOOD BUTTON
              ========================================================================= */}
          <div
            role="button"
            tabIndex={0}
            onClick={handleFrontClick}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleFrontClick();
              }
            }}
            className="flip-card-face rounded-2xl border border-[#ded5c4] dark:border-[#222533] bg-[#eae2d2] dark:bg-[#121319] p-5 flex flex-col justify-between cursor-pointer hover:border-[#181513]/30 dark:hover:border-[#EF4444]/50 transition-colors duration-200 select-none text-left min-h-[185px] relative"
            title="Click to flip for food cravings!"
          >
            {/* Dynamic 3D Glare Lighting Sheen (Front Face) */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-20 rounded-2xl overflow-hidden transition-opacity duration-300 dark:hidden"
              style={{
                opacity: "var(--glare-opacity, 0)",
                background:
                  "radial-gradient(circle 380px at var(--glare-x, 50%) var(--glare-y, 50%), rgba(255, 255, 255, 0.22) 0%, rgba(255, 255, 255, 0.05) 45%, transparent 80%)",
              }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-20 rounded-2xl overflow-hidden transition-opacity duration-300 hidden dark:block"
              style={{
                opacity: "var(--glare-opacity, 0)",
                background:
                  "radial-gradient(circle 380px at var(--glare-x, 50%) var(--glare-y, 50%), rgba(239, 68, 68, 0.16) 0%, rgba(255, 255, 255, 0.04) 45%, transparent 80%)",
              }}
            />

            {/* Top row: Status indicator */}
            <div className="flex items-center justify-between gap-2 relative z-10">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#DC2626] dark:bg-[#EF4444] dark:pulse-dot shrink-0"></span>
                <span className="text-xs font-semibold text-[#635e58] dark:text-slate-300 font-headline uppercase tracking-wider text-[11px]">
                  Ready for lunch rush?
                </span>
              </div>
            </div>

            {/* Center: Welcome Heading with 'Yo,' Rising from Bottom and Falling Letter Cascade Name */}
            <div className="my-auto py-2 relative z-10">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight uppercase font-display truncate">
                  <span className="greeting-yo-group inline-flex items-center text-[#181513] dark:text-white mr-1.5">
                    {["Y", "O", ","].map((char, index) => (
                      <span
                        key={`yo-${index}`}
                        className="greeting-yo-letter inline-block"
                        style={{ "--yo-index": index } as React.CSSProperties}
                      >
                        {char}
                      </span>
                    ))}
                  </span>
                  <span className="greeting-student-name font-extrabold inline-flex items-center text-[#DC2626] dark:text-[#EF4444]">
                    {Array.from(`${firstName}!`).map((char, index) => (
                      <span
                        key={`name-${char}-${index}`}
                        className="greeting-letter inline-block"
                        style={{ "--char-index": index } as React.CSSProperties}
                      >
                        {char === " " ? "\u00A0" : char}
                      </span>
                    ))}
                  </span>
                </h1>
                <span className="w-2.5 h-2.5 rounded-full bg-[#DC2626] dark:bg-[#EF4444] inline-block shrink-0 shadow-[0_0_8px_rgba(220,38,38,0.5)]" />
              </div>
            </div>

            {/* Bottom row: Call-to-action & Prominent Food Mood Button */}
            <div className="pt-3 border-t border-[#ded5c4] dark:border-[#1E202B] flex items-center justify-between gap-3 relative z-10">
              <span className="text-xs font-medium text-[#635e58] dark:text-slate-400">
                What are you craving today?
              </span>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleFrontClick();
                }}
                className="min-h-[38px] h-9 px-4 rounded-xl font-bold text-xs bg-[#1b1917] dark:bg-[#1C1F2B] hover:bg-[#DC2626] dark:hover:bg-[#EF4444] dark:hover:text-white text-[#f5efe4] dark:text-[#FBBF24] border border-[#36322e] dark:border-[#2D3142] font-headline uppercase tracking-wider active:scale-95 transition-all shadow-sm inline-flex items-center gap-2 group cursor-pointer shrink-0"
                title="Flip for food cravings"
              >
                <span>Food Mood</span>
                <RotateCw className="h-3.5 w-3.5 group-hover:rotate-180 transition-transform duration-500 text-[#f5efe4] dark:text-[#FBBF24] group-hover:dark:text-white" />
              </button>
            </div>
          </div>

          {/* =========================================================================
              BACK FACE: 3D FLIPPED FOOD MOOD / ZOMATO QUOTE CARD
              ========================================================================= */}
          <div
            role="button"
            tabIndex={0}
            onClick={handleNextQuote}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleNextQuote();
              }
            }}
            className="flip-card-back rounded-2xl border border-[#ded5c4] dark:border-[#222533] bg-[#eae2d2] dark:bg-[#121319] p-5 flex flex-col justify-between select-none text-left cursor-pointer hover:border-[#181513]/30 dark:hover:border-[#EF4444]/50 transition-colors duration-200 min-h-[185px] relative"
            title="Click to see another quote, or click Back to return"
          >
            {/* Dynamic 3D Glare Lighting Sheen (Back Face) */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-20 rounded-2xl overflow-hidden transition-opacity duration-300 dark:hidden"
              style={{
                opacity: "var(--glare-opacity, 0)",
                background:
                  "radial-gradient(circle 380px at var(--glare-x, 50%) var(--glare-y, 50%), rgba(255, 255, 255, 0.22) 0%, rgba(255, 255, 255, 0.05) 45%, transparent 80%)",
              }}
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-20 rounded-2xl overflow-hidden transition-opacity duration-300 hidden dark:block"
              style={{
                opacity: "var(--glare-opacity, 0)",
                background:
                  "radial-gradient(circle 380px at var(--glare-x, 50%) var(--glare-y, 50%), rgba(239, 68, 68, 0.16) 0%, rgba(255, 255, 255, 0.04) 45%, transparent 80%)",
              }}
            />

            {/* Top Row: Category tag, headline & flip back button */}
            <div className="flex items-center justify-between gap-2 relative z-10">
              <div className="flex items-center gap-2 min-w-0">
                <span className="shrink-0 px-2.5 py-0.5 rounded-full bg-[#1b1917] dark:bg-[#1C1F2B] text-[#e5891e] dark:text-[#FBBF24] text-[10px] font-bold tracking-wider uppercase border border-[#36322e] dark:border-[#2D3142] font-headline">
                  {currentQuote.category}
                </span>
                <span className="text-xs font-bold text-[#181513] dark:text-white flex items-center gap-1.5 truncate">
                  <span className="text-sm select-none">{currentQuote.emoji}</span>
                  <span className="truncate">{currentQuote.headline}</span>
                </span>
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleFlipBack();
                }}
                className="min-h-[32px] px-2.5 rounded-lg text-[11px] font-semibold text-[#635e58] dark:text-slate-300 hover:text-[#181513] dark:hover:text-white hover:bg-black/5 dark:hover:bg-[#1C1F2B] transition-colors flex items-center gap-1 cursor-pointer shrink-0 border border-[#ded5c4] dark:border-[#222533]"
                title="Flip back to greeting"
              >
                <RotateCw className="h-3 w-3" />
                <span>Back</span>
              </button>
            </div>

            {/* Middle Row: Quote Text */}
            <div className="py-2.5 my-auto relative z-10">
              <p className="text-sm sm:text-base font-medium text-[#181513] dark:text-[#f8fafc] leading-snug italic">
                &ldquo;{currentQuote.quote}&rdquo;
              </p>
            </div>

            {/* Bottom Row: Tap hint and Next Quote button */}
            <div className="pt-2 border-t border-[#ded5c4] dark:border-[#1E202B] flex items-center justify-between gap-2 text-xs relative z-10">
              <span className="text-[11px] text-[#635e58] dark:text-slate-400 font-medium truncate">
                Tap card for next quote 💬
              </span>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleNextQuote();
                }}
                className="min-h-[36px] h-9 px-3 rounded-xl bg-[#1b1917] dark:bg-[#1C1F2B] hover:bg-[#DC2626] dark:hover:bg-[#EF4444] text-[#f5efe4] dark:text-[#FBBF24] hover:dark:text-white border border-[#36322e] dark:border-[#2D3142] font-bold text-xs inline-flex items-center gap-1.5 shadow-sm active:scale-95 transition-all cursor-pointer shrink-0 font-headline uppercase tracking-wider"
              >
                <span>Next Quote</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
