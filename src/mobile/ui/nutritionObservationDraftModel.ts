import { getT, NUTRITION_COPY } from "../../i18n";
import type { NutritionObservationDraft } from "../../nutrition";

/**
 * Redacted, client-ready disclosure for a pending NutritionObservationDraft.
 * It intentionally reports only input categories/counts. Local media refs,
 * paths, filenames, source bytes and provider credentials never cross into
 * the view model.
 */
export interface NutritionDraftDisclosure {
  remoteProcessing: boolean;
  providerLabel?: string;
  sentInputs: readonly string[];
  purpose: "meal_estimate";
  mediaPolicy: string;
  privacyNotice?: string;
}

export function nutritionDraftDisclosure(draft: NutritionObservationDraft, locale?: string): NutritionDraftDisclosure {
  const t = getT(NUTRITION_COPY, locale);
  const photoCount = draft.inputMediaRefs?.length ?? 0;
  const remoteProcessing = Boolean(draft.provider);
  if (!remoteProcessing) {
    return {
      remoteProcessing: false,
      sentInputs: [],
      purpose: "meal_estimate",
      mediaPolicy: t(photoCount ? "draft.mediaPolicy.localPhotos" : "draft.mediaPolicy.localOnly"),
    };
  }
  return {
    remoteProcessing: true,
    providerLabel: `${draft.provider!.id} · ${draft.provider!.modelVersion}`,
    sentInputs: [
      ...(draft.observation.description?.trim() ? [t("draft.sentInput.mealText")] : []),
      ...(photoCount ? [t("draft.sentInput.photos", { count: photoCount })] : []),
    ],
    purpose: "meal_estimate",
    mediaPolicy: t(photoCount ? "draft.mediaPolicy.remotePhotos" : "draft.mediaPolicy.remoteTextOnly"),
    privacyNotice: photoCount ? t("draft.privacyNotice.photos") : undefined,
  };
}

/** A low-confidence/local-only Draft needs a concrete user edit before confirmation. */
export function nutritionDraftRequiresUserEdit(draft: NutritionObservationDraft): boolean {
  return Boolean(draft.clarificationRequired);
}
