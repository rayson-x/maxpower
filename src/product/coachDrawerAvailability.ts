/**
 * A small shared navigation capability map. Main product destinations share
 * the same Coach drawer; focused setup and media workspaces stay distraction-free.
 */
export type CoachDrawerRoute =
  | "today"
  | "calendar"
  | "plan"
  | "progress"
  | "profile"
  | "onboarding"
  | "workout"
  | "video_library"
  | "replay";

export function coachDrawerAvailableForRoute(route: CoachDrawerRoute): boolean {
  return route !== "onboarding" && route !== "video_library" && route !== "replay";
}
