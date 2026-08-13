const HORIZONTAL_DOMINANCE = 1.4;

export function workoutHorizontalIntent(
  dx: number,
  dy: number,
  threshold: number,
): "left" | "right" | "none" {
  if (Math.abs(dx) < threshold || Math.abs(dx) <= Math.abs(dy) * HORIZONTAL_DOMINANCE) return "none";
  return dx < 0 ? "left" : "right";
}

export function workoutReorderIntent(
  dx: number,
  dy: number,
  armed: boolean,
  threshold = 32,
): "up" | "down" | "none" {
  if (!armed || Math.abs(dy) < threshold || Math.abs(dy) <= Math.abs(dx) * 1.2) return "none";
  return dy < 0 ? "up" : "down";
}
