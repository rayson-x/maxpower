import type { FoodEntryData } from "./NutritionDayLedger";
import type { NutritionDayLedger, NutritionDayPlan } from "./NutritionDayLedger";

export interface NextMealCandidate {
  id: string;
  title: string;
  foods: readonly FoodEntryData[];
  estimated: {
    energyKcal?: number;
    proteinGrams?: number;
    carbohydrateGrams?: number;
    fatGrams?: number;
  };
  assumptions: readonly string[];
}

export interface NextMealRecommendation {
  id: string;
  date: string;
  timezoneOffsetMinutes: number;
  ledgerFingerprint: string;
  mealSlot: "breakfast" | "lunch" | "dinner" | "snack";
  candidates: readonly NextMealCandidate[];
  reasonCodes: readonly string[];
  missing: readonly string[];
  stale: boolean;
  reviewAt: string;
}

/**
 * Local, editable meal candidates. It intentionally names food categories
 * rather than merchants, prices, or inventory; those require a registered
 * external tool and are outside the offline product seam.
 */
export function deriveNextMealRecommendation(input: {
  plan: NutritionDayPlan;
  ledger: NutritionDayLedger;
  mealSlot: NextMealRecommendation["mealSlot"];
  now: string;
  conditions?: { cooking?: "home" | "takeaway" | "convenience"; dietaryNotes?: readonly string[] };
}): NextMealRecommendation {
  const remaining = (nutrient: keyof NextMealCandidate["estimated"]): number | undefined => {
    const key = nutrient === "energyKcal" ? "energy" : nutrient.replace("Grams", "") as "protein" | "carbohydrate" | "fat";
    return input.ledger.nutrients[key].remainingAgainstLogged;
  };
  const protein = remaining("proteinGrams");
  const energy = remaining("energyKcal");
  const cooking = input.conditions?.cooking ?? "home";
  const suffix = cooking === "takeaway" ? "外食优先" : cooking === "convenience" ? "便利食品优先" : "家中可做";
  const candidates: NextMealCandidate[] = [
    {
      id: `${input.plan.date}:${input.mealSlot}:balanced`,
      title: "蛋白质主菜 + 主食 + 蔬菜",
      foods: [
        { id: "candidate-protein", name: "高蛋白主菜", portion: "按饥饿与剩余额度调整", source: "manual" },
        { id: "candidate-carb", name: "米饭/土豆等主食", portion: "按训练日碳水余量调整", source: "manual" },
        { id: "candidate-vegetable", name: "蔬菜", portion: "一份", source: "manual" },
      ],
      estimated: {},
      assumptions: [suffix, "具体营养值需按实际食物或标签确认"],
    },
    {
      id: `${input.plan.date}:${input.mealSlot}:quick`,
      title: "快速组合",
      foods: [
        { id: "candidate-yogurt", name: "酸奶或其他蛋白质食物", portion: "一份", source: "manual" },
        { id: "candidate-fruit", name: "水果", portion: "一份", source: "manual" },
        { id: "candidate-grain", name: "方便主食", portion: "按剩余额度调整", source: "manual" },
      ],
      estimated: {},
      assumptions: ["候选只提供类别，不虚构品牌、价格或库存", ...((input.conditions?.dietaryNotes ?? []).map((note) => `遵守：${note}`))],
    },
  ];
  return {
    id: `next-meal:${input.plan.date}:${input.mealSlot}:${input.ledger.loggedMealCount}:${input.ledger.coverage}`,
    date: input.plan.date,
    timezoneOffsetMinutes: input.plan.timezoneOffsetMinutes,
    ledgerFingerprint: JSON.stringify({ date: input.ledger.date, meals: input.ledger.meals.map((meal) => meal.eventId), nutrients: input.ledger.nutrients }),
    mealSlot: input.mealSlot,
    candidates,
    reasonCodes: [
      "uses_latest_confirmed_ledger",
      ...(energy === undefined ? ["energy_remaining_unknown"] : []),
      ...(protein === undefined ? ["protein_remaining_unknown"] : []),
    ],
    missing: [
      ...(input.plan.missing),
      ...(input.ledger.coverage === "no_log" ? ["no_confirmed_meal"] : []),
    ],
    stale: false,
    reviewAt: input.now,
  };
}
