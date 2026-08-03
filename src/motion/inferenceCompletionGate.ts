export type InferenceCompletionDropReason =
  | "superseded-request"
  | "sequence-reset"
  | "model-epoch-changed";

export interface InferenceRequestToken {
  readonly requestId: number;
  readonly sequenceEpoch: number;
  readonly modelEpoch: number;
}

export interface InferenceCompletionDecision {
  readonly accepted: boolean;
  readonly reason: InferenceCompletionDropReason | null;
}

/**
 * Owns the ordering contract around an inference adapter. The current Web
 * MediaPipe adapter completes synchronously, but keeping this gate at the
 * adapter seam prevents a later async/worker implementation from publishing
 * results from an older frame, a reset sequence, or a replaced model.
 */
export class InferenceCompletionGate {
  private nextRequestId = 1;
  private latestAcceptedRequestId = 0;
  private sequenceEpoch = 0;
  private modelEpoch = 0;

  begin(): InferenceRequestToken {
    return Object.freeze({
      requestId: this.nextRequestId++,
      sequenceEpoch: this.sequenceEpoch,
      modelEpoch: this.modelEpoch,
    });
  }

  accept(token: InferenceRequestToken): InferenceCompletionDecision {
    if (token.modelEpoch !== this.modelEpoch) {
      return Object.freeze({ accepted: false, reason: "model-epoch-changed" });
    }
    if (token.sequenceEpoch !== this.sequenceEpoch) {
      return Object.freeze({ accepted: false, reason: "sequence-reset" });
    }
    if (token.requestId <= this.latestAcceptedRequestId) {
      return Object.freeze({ accepted: false, reason: "superseded-request" });
    }
    this.latestAcceptedRequestId = token.requestId;
    return Object.freeze({ accepted: true, reason: null });
  }

  resetSequence(): void {
    this.sequenceEpoch += 1;
    this.latestAcceptedRequestId = 0;
  }

  replaceModel(): void {
    this.modelEpoch += 1;
    this.resetSequence();
  }
}
