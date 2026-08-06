export type ReviewKeyboardAction = "undo" | "delete-selected";

export interface ReviewKeyboardInput {
  readonly key: string;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
  readonly targetTagName?: string;
  readonly targetContentEditable?: boolean;
}

/** Maps only shortcuts owned by the review timeline, never native text editing. */
export function reviewKeyboardShortcut(input: ReviewKeyboardInput): ReviewKeyboardAction | null {
  if (
    input.targetContentEditable
    || input.targetTagName === "INPUT"
    || input.targetTagName === "TEXTAREA"
    || input.targetTagName === "SELECT"
  ) {
    return null;
  }
  if (
    input.metaKey
    && !input.ctrlKey
    && !input.altKey
    && !input.shiftKey
    && input.key.toLowerCase() === "z"
  ) {
    return "undo";
  }
  if (
    !input.metaKey
    && !input.ctrlKey
    && !input.altKey
    && !input.shiftKey
    && (input.key === "Backspace" || input.key === "Delete")
  ) {
    return "delete-selected";
  }
  return null;
}
