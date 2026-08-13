/**
 * 食物热效应（TEF）是摄入后消化、吸收与代谢本身消耗的能量，不应和 BMR、
 * 日常活动或训练消耗混为一项。优先用已记录的宏量营养素；缺失部分才保守回退。
 * 百分比是用于能量账本的产品近似，不是个人代谢测量。
 */
export interface ThermicEffectInput {
  energyKcal?: number;
  proteinGrams?: number;
  carbohydrateGrams?: number;
  fatGrams?: number;
}

export interface ThermicEffectEstimate {
  kcal: number;
  source: "macro_estimate" | "energy_fallback" | "unknown";
  macroEnergyKcal: number;
  unknownEnergyKcal: number;
}

const PROTEIN_TEF = 0.25;
const CARBOHYDRATE_TEF = 0.075;
const FAT_TEF = 0.02;
const FALLBACK_TEF = 0.1;

export function estimateThermicEffect(input: ThermicEffectInput): ThermicEffectEstimate {
  const protein = Math.max(0, input.proteinGrams ?? 0) * 4;
  const carbohydrate = Math.max(0, input.carbohydrateGrams ?? 0) * 4;
  const fat = Math.max(0, input.fatGrams ?? 0) * 9;
  const macroEnergyKcal = Math.round(protein + carbohydrate + fat);
  const recordedEnergy = input.energyKcal === undefined ? undefined : Math.max(0, input.energyKcal);
  const knownMacroEnergy = recordedEnergy === undefined ? macroEnergyKcal : Math.min(macroEnergyKcal, recordedEnergy);
  const unknownEnergyKcal = recordedEnergy === undefined ? 0 : Math.max(0, recordedEnergy - knownMacroEnergy);
  const macroTef = protein * PROTEIN_TEF + carbohydrate * CARBOHYDRATE_TEF + fat * FAT_TEF;
  if (macroEnergyKcal > 0) {
    return {
      kcal: Math.round(macroTef + unknownEnergyKcal * FALLBACK_TEF),
      source: "macro_estimate",
      macroEnergyKcal,
      unknownEnergyKcal: Math.round(unknownEnergyKcal),
    };
  }
  if (recordedEnergy !== undefined) {
    return {
      kcal: Math.round(recordedEnergy * FALLBACK_TEF),
      source: "energy_fallback",
      macroEnergyKcal: 0,
      unknownEnergyKcal: Math.round(recordedEnergy),
    };
  }
  return { kcal: 0, source: "unknown", macroEnergyKcal: 0, unknownEnergyKcal: 0 };
}
