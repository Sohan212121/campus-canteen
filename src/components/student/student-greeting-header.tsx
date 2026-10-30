"use client";

import { useState, useRef, useCallback } from "react";
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

  return (
    <div className="flip-card-container w-full" aria-label="Interactive campus greeting and food cravings card">
      <div
        className={`flip-card-inner ${isFlipped ? "flip-card-flipped" : ""} ${
          isSpinningNext ? "animate-flip-quote-spin" : ""
        }`}
      >
        {/* =========================================================================
            FRONT FACE: CLEAN, PROFESSIONAL GREETING
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
          className="flip-card-face rounded-2xl border border-border/80 bg-card p-5 shadow-xs flex flex-col justify-between cursor-pointer hover:border-foreground/30 hover:shadow-sm transition-all duration-200 select-none text-left"
          title="Click to flip for food cravings!"
        >
          <div className="space-y-1.5">
            <p className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
              Campus Canteen
            </p>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Welcome, {firstName}!
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
              Pre-order fresh meals before your break and pick up without waiting.
            </p>
          </div>

          <div className="pt-3.5 flex items-center justify-between text-xs text-muted-foreground border-t border-border/40 mt-3">
            <span className="flex items-center gap-1.5 font-medium text-[11px]">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span>Smart Pickup Active</span>
            </span>

            <span className="inline-flex items-center gap-1 font-semibold text-primary text-[11px] group-hover:underline">
              <span>Food Mood</span>
              <RotateCw className="h-3 w-3" />
            </span>
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
          className="flip-card-back rounded-2xl border border-border/90 bg-card p-5 shadow-xs flex flex-col justify-between select-none text-left cursor-pointer hover:border-foreground/30 transition-all duration-200"
          title="Click to see another quote, or click Back to return"
        >
          {/* Top Row: Category tag, headline & flip back button */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="shrink-0 px-2 py-0.5 rounded-md bg-muted text-[10px] font-bold tracking-wider uppercase text-muted-foreground border border-border/50">
                {currentQuote.category}
              </span>
              <span className="text-xs font-bold text-foreground flex items-center gap-1.5 truncate">
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
              className="min-h-[32px] px-2.5 rounded-lg text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1 cursor-pointer shrink-0 border border-border/40"
              title="Flip back to greeting"
            >
              <RotateCw className="h-3 w-3" />
              <span>Back</span>
            </button>
          </div>

          {/* Middle Row: Quote Text */}
          <div className="py-2.5 my-auto">
            <p className="text-sm sm:text-base font-medium text-foreground leading-snug italic">
              &ldquo;{currentQuote.quote}&rdquo;
            </p>
          </div>

          {/* Bottom Row: Tap hint and Next Quote button */}
          <div className="pt-2 border-t border-border/50 flex items-center justify-between gap-2 text-xs">
            <span className="text-[11px] text-muted-foreground font-medium truncate">
              Tap card for next quote 💬
            </span>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleNextQuote();
              }}
              className="min-h-[36px] h-9 px-3 rounded-xl bg-primary text-primary-foreground font-bold text-xs inline-flex items-center gap-1.5 shadow-2xs hover:bg-primary/90 active:scale-95 transition-all cursor-pointer shrink-0"
            >
              <span>Next Quote</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
