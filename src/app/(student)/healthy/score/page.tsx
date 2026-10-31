import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Dumbbell, Wheat, Leaf, Heart, Scale, Info, CheckCircle2 } from "lucide-react";
import { requireRole } from "@/server/auth";
import { HEALTHY_SCORE_CRITERIA } from "@/lib/healthy-constants";

export const metadata: Metadata = {
  title: "How the Healthy Score Works | Campus Canteen",
  description: "Transparent breakdown of the 5 criteria and weights used to calculate the Campus Canteen Healthy Score.",
};

const CRITERION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  protein_density: Dumbbell,
  fibre: Wheat,
  carb_quality: Leaf,
  fat_quality: Heart,
  calorie_balance: Scale,
};

export default async function HealthyScoreExplainerPage() {
  await requireRole(["student"]);

  return (
    <div className="space-y-6 pb-16">
      {/* Top Breadcrumb */}
      <div>
        <Link
          href="/healthy"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors min-h-[44px] py-1"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Healthy Mode</span>
        </Link>
      </div>

      {/* Hero Header */}
      <header className="rounded-3xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-card to-card p-6 shadow-xs space-y-3">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-bold text-emerald-800 dark:text-emerald-300">
          <Heart className="h-3 w-3 fill-emerald-600 text-emerald-600 dark:fill-emerald-400 dark:text-emerald-400" />
          <span>Transparent Nutrition Science</span>
        </div>

        <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground">
          How the Healthy Score Works
        </h1>

        <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
          The Campus Canteen Healthy Score (0 to 100) estimates overall nutrient density for students. Rather than relying on simple calorie counts, it balances macronutrient quality, dietary fibre, and portion alignment.
        </p>

        {/* Score Bands Legend */}
        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/40 text-center">
          <div className="p-2.5 rounded-xl bg-card border border-emerald-500/40">
            <span className="text-sm font-black text-emerald-600 dark:text-emerald-400">
              70 - 100
            </span>
            <p className="text-[10px] font-bold uppercase text-foreground mt-0.5">High Score</p>
          </div>
          <div className="p-2.5 rounded-xl bg-card border border-amber-500/40">
            <span className="text-sm font-black text-amber-600 dark:text-amber-400">
              40 - 69
            </span>
            <p className="text-[10px] font-bold uppercase text-foreground mt-0.5">Medium Score</p>
          </div>
          <div className="p-2.5 rounded-xl bg-card border border-muted-foreground/30">
            <span className="text-sm font-black text-muted-foreground">
              Under 40
            </span>
            <p className="text-[10px] font-bold uppercase text-foreground mt-0.5">Low Score</p>
          </div>
        </div>
      </header>

      {/* 5 Criteria Breakdown Cards */}
      <section className="space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Evaluation Criteria & Exact Weights
        </h2>

        <div className="space-y-3">
          {HEALTHY_SCORE_CRITERIA.map((criterion) => {
            const Icon = CRITERION_ICONS[criterion.id] || Leaf;

            return (
              <div
                key={criterion.id}
                className="rounded-2xl border border-border/80 bg-card p-4 shadow-2xs space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                      <Icon className="h-4 w-4" />
                    </div>
                    <h3 className="text-sm font-extrabold text-foreground">
                      {criterion.name}
                    </h3>
                  </div>

                  <span className="px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-xs font-black text-emerald-800 dark:text-emerald-300 font-mono">
                    {criterion.weightPercent}% Weight
                  </span>
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed pl-10">
                  {criterion.description}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Calculation Invariant Note */}
      <section className="rounded-2xl border border-border/80 bg-muted/20 p-4 space-y-2 text-xs">
        <div className="flex items-center gap-2 font-bold text-foreground">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <span>Completeness Requirement</span>
        </div>
        <p className="text-muted-foreground leading-relaxed">
          The Healthy Score is only computed when the canteen has entered calories, protein, total fat, and carbohydrates. If any core macro is missing, the dish displays &ldquo;Score not available&rdquo; rather than guessing or misrepresenting nutrition.
        </p>
      </section>

      {/* Please Note / Disclaimer */}
      <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2 text-xs">
        <div className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-300">
          <Info className="h-4 w-4 text-amber-600" />
          <span>Please Note</span>
        </div>
        <p className="text-muted-foreground leading-relaxed">
          This score is an estimate based on the canteen&apos;s entered values and is for general information only. It is not medical advice. Calories alone do not decide the score.
        </p>
      </section>

      {/* Back CTA Button */}
      <div className="pt-2">
        <Link
          href="/healthy"
          className="w-full min-h-[44px] rounded-xl font-bold text-xs bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs inline-flex items-center justify-center gap-2 transition-all active:scale-95"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Return to Healthy Mode</span>
        </Link>
      </div>
    </div>
  );
}
