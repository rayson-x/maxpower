import { mobileT } from "../../i18n";

export function coachingModeLabel(value?: string): string {
  if (value === "manual") return mobileT("mobile.ui.productcopy.7162226fc6");
  if (value === "managed") return mobileT("mobile.ui.productcopy.d31e2b86bf");
  if (value === "collaborative") return mobileT("mobile.ui.productcopy.8d25a7fc00");
  return mobileT("mobile.ui.productcopy.bbab69cd70");
}
