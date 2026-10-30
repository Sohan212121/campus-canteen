"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";

interface StudentGreetingHeaderProps {
  fullName?: string | null;
  initialHour?: number;
}

interface TimeGreetingConfig {
  greeting: string;
  emoji: string;
  subtext: string;
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

function getTimeGreetingConfig(hour: number): TimeGreetingConfig {
  if (hour >= 5 && hour < 12) {
    return {
      greeting: "Good morning",
      emoji: "🍳",
      subtext: "Crispy dosas & hot filter coffee ready before your first lecture.",
    };
  }
  if (hour >= 12 && hour < 17) {
    return {
      greeting: "Good afternoon",
      emoji: "🍱",
      subtext: "Skip the lunch rush — fresh meal combos & biryani ready for quick pickup.",
    };
  }
  if (hour >= 17 && hour < 21) {
    return {
      greeting: "Good evening",
      emoji: "🥪",
      subtext: "Recharge between classes with samosas, rolls & piping hot chai.",
    };
  }
  return {
    greeting: "Night study fuel",
    emoji: "🌙",
    subtext: "Late cravings? Grab a fresh bite & recharge your study session.",
  };
}

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

export function StudentGreetingHeader({ fullName, initialHour }: StudentGreetingHeaderProps) {
  // Compute contextual greeting directly without useEffect
  const effectiveHour = initialHour ?? (typeof window !== "undefined" ? new Date().getHours() : 12);
  const greetingConfig = getTimeGreetingConfig(effectiveHour);

  // Extract clean first name
  const firstName = fullName?.trim() ? fullName.trim().split(" ")[0] : "Student";

  // Non-repeating randomized quote deck: guarantees a different message on every single click
  const deckRef = useRef<number[]>([]);
  const deckPointerRef = useRef<number>(0);
  const lastPickedIndexRef = useRef<number>(-1);
  const triggerRef = useRef<() => void>(() => {});

  // Initial quote (clean state initialization without touching refs in render)
  const [currentQuote, setCurrentQuote] = useState<ZomatoQuote>(ZOMATO_FOOD_QUOTES[0]);
  const [isAnimating, setIsAnimating] = useState(false);

  // Function to pull the next unique random quote from the shuffle deck
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

  // Click handler: fires every time the user taps or clicks the greeting section
  const handleSectionClick = useCallback(() => {
    const nextQuote = getNextQuote();
    setCurrentQuote(nextQuote);
    setIsAnimating(true);

    // Pop up notification with Zomato-style humor / cheesy / motivating lines
    toast(nextQuote.headline, {
      description: nextQuote.quote,
      icon: nextQuote.emoji,
      duration: 4500,
      id: "food-craving-popup",
      action: {
        label: "Another 🎲",
        onClick: (e) => {
          e?.stopPropagation();
          triggerRef.current();
        },
      },
    });

    const timer = setTimeout(() => setIsAnimating(false), 350);
    return () => clearTimeout(timer);
  }, [getNextQuote]);

  useEffect(() => {
    triggerRef.current = handleSectionClick;
  }, [handleSectionClick]);

  return (
    <header
      role="button"
      tabIndex={0}
      onClick={handleSectionClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleSectionClick();
        }
      }}
      className={`group relative overflow-hidden rounded-2xl border border-border/80 bg-card p-4 sm:p-5 shadow-xs transition-all duration-200 hover:border-foreground/25 hover:shadow-sm active:scale-[0.985] cursor-pointer select-none text-left ${
        isAnimating ? "ring-2 ring-primary/30" : ""
      }`}
      aria-label="Campus greeting section - click for a fresh food mood quote"
    >
      {/* Top accent border bar */}
      <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-amber-500 via-primary to-emerald-500 opacity-80" />

      {/* Top Row: Live Kitchen Status & Interactive Hint */}
      <div className="flex items-center justify-between gap-2 pb-2.5">
        <div className="flex items-center gap-2">
          {/* Live indicator dot */}
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="text-xs font-semibold text-foreground">Kitchen Active</span>
          <span className="text-muted-foreground/40 font-medium">·</span>
          <span className="text-xs text-muted-foreground font-medium">Avg ~4m pickup</span>
        </div>

        {/* Sleek interactive prompt badge */}
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground group-hover:text-foreground transition-colors bg-muted/60 group-hover:bg-muted px-2.5 py-0.5 rounded-full border border-border/40">
          <span>Tap for food mood</span>
          <span className="text-xs select-none">💬</span>
        </div>
      </div>

      {/* Main Greeting Typography */}
      <div className="space-y-1">
        <p className="text-[10px] sm:text-xs font-bold tracking-widest uppercase text-muted-foreground">
          Campus Canteen
        </p>

        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground flex items-center gap-2 flex-wrap">
          <span>{greetingConfig.greeting}, {firstName}!</span>
          <span className="text-2xl select-none">{greetingConfig.emoji}</span>
        </h1>

        <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
          {greetingConfig.subtext}
        </p>
      </div>

      {/* Interactive Food Mood Quotation Pill (Refreshes on each click) */}
      <div className="mt-3.5 pt-3 border-t border-border/60 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 px-2 py-0.5 rounded-md bg-muted text-[10px] font-bold tracking-wider uppercase text-muted-foreground border border-border/50">
            {currentQuote.category}
          </span>
          <p
            key={currentQuote.quote}
            className="font-medium text-foreground truncate italic animate-in fade-in-50 duration-300"
          >
            &ldquo;{currentQuote.quote}&rdquo;
          </p>
        </div>

        <span className="shrink-0 text-[11px] font-semibold text-primary group-hover:underline">
          Tap card 🎲
        </span>
      </div>
    </header>
  );
}
