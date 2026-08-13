import React from "react";

import type { CoachDrawerRoute } from "../../../product";
import type { CoachStreamSnapshot } from "../../../coach/ui";
import {
  AppDock,
  type CoachComposerAnchor,
} from "../../ui-kit";

/**
 * The app dock owns the stable primary navigation vocabulary.  Screens only
 * declare the active destination and callbacks; they never reproduce tab
 * labels, glyphs, or the Coach/record entry layout.
 */
export function ProductDock({
  route,
  coachStatus,
  coachExpanded,
  onChange,
  onRecord,
  onOpenCoach,
  onOpenCoachVoice,
  onCoachAnchorChange,
  onRecordAnchorChange,
}: {
  route: CoachDrawerRoute;
  coachStatus: CoachStreamSnapshot["status"];
  coachExpanded: boolean;
  onChange(route: CoachDrawerRoute): void;
  onRecord(): void;
  onOpenCoach(): void;
  onOpenCoachVoice(): void;
  onCoachAnchorChange(anchor: CoachComposerAnchor): void;
  onRecordAnchorChange(anchor: CoachComposerAnchor): void;
}) {
  const destinations: readonly { id: CoachDrawerRoute; label: string; glyph: string }[] = [
    { id: "today", label: "今天", glyph: "⌂" },
    { id: "calendar", label: "日历", glyph: "▦" },
    { id: "plan", label: "计划", glyph: "↗" },
    { id: "profile", label: "我的", glyph: "○" },
  ];

  return (
    <AppDock
      current={route === "progress" ? "plan" : route}
      destinations={destinations}
      onNavigate={onChange}
      onRecord={onRecord}
      onCoach={onOpenCoach}
      onCoachVoice={onOpenCoachVoice}
      onCoachAnchorChange={onCoachAnchorChange}
      onRecordAnchorChange={onRecordAnchorChange}
      coachExpanded={coachExpanded}
      coachBusy={coachStatus === "streaming"}
    />
  );
}
