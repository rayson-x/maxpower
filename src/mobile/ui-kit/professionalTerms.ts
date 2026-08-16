import { mobileT } from "../../i18n";

export const PROFESSIONAL_TERM_CATALOG_VERSION = "professional-terms/v1" as const;

export type ProfessionalTermId = "rir" | "rpe" | "one_rm" | "estimated_one_rm" | "bmr" | "tdee" | "tef" | "hiit" | "deload";

export interface ProfessionalTermDefinition {
  readonly id: ProfessionalTermId;
  readonly label: string;
  readonly fullName: string;
  readonly plainMeaning: string;
  readonly scaleDirection: string;
  readonly example: string;
  readonly boundary: string;
  readonly catalogVersion: typeof PROFESSIONAL_TERM_CATALOG_VERSION;
}

export type ProfessionalTermTextPart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "term"; readonly text: string; readonly termId: ProfessionalTermId };

const PROFESSIONAL_TERMS: Readonly<Record<ProfessionalTermId, ProfessionalTermDefinition>> = {
  rir: {
    id: "rir",
    label: "RIR",
    fullName: mobileT("mobile.ui.kit.professionalterms.a8d7dc0d5b"),
    plainMeaning: mobileT("mobile.ui.kit.professionalterms.86e7add0a5"),
    scaleDirection: mobileT("mobile.ui.kit.professionalterms.d7a947465d"),
    example: mobileT("mobile.ui.kit.professionalterms.f7e90c7967"),
    boundary: mobileT("mobile.ui.kit.professionalterms.8dfdbd1f03"),
    catalogVersion: PROFESSIONAL_TERM_CATALOG_VERSION,
  },
  rpe: {
    id: "rpe",
    label: "RPE",
    fullName: mobileT("mobile.ui.kit.professionalterms.f39c4296b8"),
    plainMeaning: mobileT("mobile.ui.kit.professionalterms.aee108fe61"),
    scaleDirection: mobileT("mobile.ui.kit.professionalterms.0d2216da57"),
    example: mobileT("mobile.ui.kit.professionalterms.c410fafc05"),
    boundary: mobileT("mobile.ui.kit.professionalterms.b483df0854"),
    catalogVersion: PROFESSIONAL_TERM_CATALOG_VERSION,
  },
  one_rm: {
    id: "one_rm", label: "1RM", fullName: mobileT("mobile.ui.kit.professionalterms.16cf2f7b1d"),
    plainMeaning: mobileT("mobile.ui.kit.professionalterms.a3e47469e6"),
    scaleDirection: mobileT("mobile.ui.kit.professionalterms.4e98e7ca99"),
    example: mobileT("mobile.ui.kit.professionalterms.e9a4f64284"),
    boundary: mobileT("mobile.ui.kit.professionalterms.1383d8eb46"),
    catalogVersion: PROFESSIONAL_TERM_CATALOG_VERSION,
  },
  estimated_one_rm: {
    id: "estimated_one_rm", label: "e1RM", fullName: mobileT("mobile.ui.kit.professionalterms.c0d9208fd4"),
    plainMeaning: mobileT("mobile.ui.kit.professionalterms.50686a909f"),
    scaleDirection: mobileT("mobile.ui.kit.professionalterms.dbd7ab340c"),
    example: mobileT("mobile.ui.kit.professionalterms.352df13e6d"),
    boundary: mobileT("mobile.ui.kit.professionalterms.e3a783dc08"),
    catalogVersion: PROFESSIONAL_TERM_CATALOG_VERSION,
  },
  bmr: {
    id: "bmr", label: "BMR", fullName: mobileT("mobile.ui.kit.professionalterms.97475728d4"),
    plainMeaning: mobileT("mobile.ui.kit.professionalterms.0a27cb93c0"),
    scaleDirection: mobileT("mobile.ui.kit.professionalterms.883a3e417a"),
    example: mobileT("mobile.ui.kit.professionalterms.844537597c"),
    boundary: mobileT("mobile.ui.kit.professionalterms.dadfecf3a9"),
    catalogVersion: PROFESSIONAL_TERM_CATALOG_VERSION,
  },
  tdee: {
    id: "tdee", label: "TDEE", fullName: mobileT("mobile.ui.kit.professionalterms.e4421cbc6d"),
    plainMeaning: mobileT("mobile.ui.kit.professionalterms.a268b901e0"),
    scaleDirection: mobileT("mobile.ui.kit.professionalterms.00707bd41d"),
    example: mobileT("mobile.ui.kit.professionalterms.97075280e5"),
    boundary: mobileT("mobile.ui.kit.professionalterms.4cb9114e33"),
    catalogVersion: PROFESSIONAL_TERM_CATALOG_VERSION,
  },
  tef: {
    id: "tef", label: "TEF", fullName: mobileT("mobile.ui.kit.professionalterms.463fa59145"),
    plainMeaning: mobileT("mobile.ui.kit.professionalterms.dc038cd50a"),
    scaleDirection: mobileT("mobile.ui.kit.professionalterms.4256f3a2e6"),
    example: mobileT("mobile.ui.kit.professionalterms.87a5dc947d"),
    boundary: mobileT("mobile.ui.kit.professionalterms.5ae05c514b"),
    catalogVersion: PROFESSIONAL_TERM_CATALOG_VERSION,
  },
  hiit: {
    id: "hiit", label: "HIIT", fullName: mobileT("mobile.ui.kit.professionalterms.1848d6e221"),
    plainMeaning: mobileT("mobile.ui.kit.professionalterms.d8c9ccef5b"),
    scaleDirection: mobileT("mobile.ui.kit.professionalterms.113fa81d36"),
    example: mobileT("mobile.ui.kit.professionalterms.ae7a903cfd"),
    boundary: mobileT("mobile.ui.kit.professionalterms.694f7dc6ad"),
    catalogVersion: PROFESSIONAL_TERM_CATALOG_VERSION,
  },
  deload: {
    id: "deload", label: "Deload", fullName: mobileT("mobile.ui.kit.professionalterms.2c2f49beec"),
    plainMeaning: mobileT("mobile.ui.kit.professionalterms.b130ba1b9a"),
    scaleDirection: mobileT("mobile.ui.kit.professionalterms.f71336935d"),
    example: mobileT("mobile.ui.kit.professionalterms.5bf24a31bf"),
    boundary: mobileT("mobile.ui.kit.professionalterms.437d507a82"),
    catalogVersion: PROFESSIONAL_TERM_CATALOG_VERSION,
  },
};

const TERM_ALIASES: readonly { readonly alias: string; readonly termId: ProfessionalTermId }[] = [
  { alias: "e1RM", termId: "estimated_one_rm" }, { alias: "1RM", termId: "one_rm" },
  { alias: "RIR", termId: "rir" }, { alias: "RPE", termId: "rpe" },
  { alias: "TDEE", termId: "tdee" }, { alias: "BMR", termId: "bmr" }, { alias: "TEF", termId: "tef" },
  { alias: "HIIT", termId: "hiit" }, { alias: "Deload", termId: "deload" },
];
const TERM_ALIAS_BY_LOWERCASE = new Map(TERM_ALIASES.map((item) => [item.alias.toLowerCase(), item.termId]));
const TERM_PATTERN = new RegExp(`\\b(${TERM_ALIASES.map((item) => item.alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "giu");

export function readProfessionalTerm(termId: ProfessionalTermId): ProfessionalTermDefinition {
  return PROFESSIONAL_TERMS[termId];
}

export function annotateProfessionalTerms(text: string): readonly ProfessionalTermTextPart[] {
  const result: ProfessionalTermTextPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(TERM_PATTERN)) {
    const index = match.index;
    if (index > cursor) result.push({ kind: "text", text: text.slice(cursor, index) });
    const matchedText = match[0];
    const termId = TERM_ALIAS_BY_LOWERCASE.get(matchedText.toLowerCase());
    if (!termId) continue;
    result.push({ kind: "term", text: matchedText, termId });
    cursor = index + matchedText.length;
  }
  if (cursor < text.length || result.length === 0) result.push({ kind: "text", text: text.slice(cursor) });
  return result;
}
