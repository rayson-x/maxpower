/** Public, deterministic WorkoutSession capability gate. */
export function workoutSetRealtimeGate(input: {
  nativeRuntimeAvailable: boolean;
  recognition: { canRunRustRecognition: boolean; profileIdentity: string | null };
  runtime: {
    localRecording: "available" | "unavailable";
    repCounting: "available" | "unavailable";
    profileIdentity?: string;
  };
}): boolean {
  return input.nativeRuntimeAvailable
    && input.recognition.canRunRustRecognition
    && input.recognition.profileIdentity !== null
    && input.recognition.profileIdentity === input.runtime.profileIdentity
    && input.runtime.localRecording === "available"
    && input.runtime.repCounting === "available";
}
