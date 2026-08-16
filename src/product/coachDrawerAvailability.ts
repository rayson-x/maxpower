/**
 * A small shared navigation capability map. Main product destinations share
 * the same Coach drawer; focused setup and media workspaces stay distraction-free.
 */
export type CoachDrawerRoute =
  | "today"
  | "calendar"
  | "plan"
  | "profile"
  | "workout";

export function coachDrawerAvailableForRoute(_route: CoachDrawerRoute): boolean { return true; }
