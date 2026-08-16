import React from "react";

import type { CoachDrawerRoute } from "../../../product";
import {
  AppDock,
  type CoachComposerAnchor,
} from "../../ui-kit";
import { mobileT } from "../../../i18n";


/**
 * The app dock owns the stable primary navigation vocabulary.  Screens only
 * declare the active destination and callbacks; they never reproduce tab
 * labels, glyphs, or the Coach/record entry layout.
 */
export function ProductDock({
  route,
  coachBusy,
  coachExpanded,
  onChange,
  onRecord,
  onOpenCoach,
  onCoachAnchorChange,
}: {
  route: CoachDrawerRoute;
  coachBusy: boolean;
  coachExpanded: boolean;
  onChange(route: CoachDrawerRoute): void;
  onRecord(): void;
  onOpenCoach(): void;
  onCoachAnchorChange(anchor: CoachComposerAnchor): void;
}) {
  const destinations: readonly { id: CoachDrawerRoute; label: string; glyph: string }[] = [
    { id: "today", label: mobileT("mobile.ui.components.productdock.17e83cc25e"), glyph: "⌂" },
    { id: "calendar", label: mobileT("mobile.ui.components.productdock.2ecbc11608"), glyph: "▦" },
    { id: "plan", label: mobileT("mobile.ui.components.productdock.c17bb5de3f"), glyph: "↗" },
    { id: "profile", label: mobileT("mobile.ui.components.productdock.a82c993d73"), glyph: "○" },
  ];

  return (
    <AppDock
      current={route}
      destinations={destinations}
      onNavigate={onChange}
      onRecord={onRecord}
      onCoach={onOpenCoach}
      onCoachAnchorChange={onCoachAnchorChange}
      coachExpanded={coachExpanded}
      coachBusy={coachBusy}
    />
  );
}
