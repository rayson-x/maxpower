import type { MuscleGroup } from "./exerciseRegistry";

export interface LocalCaptureSummary {
  id: string;
  createdAt: string;
  videoName: string;
  keypointsName: string;
  poseCount: number;
  durationSec: number;
  analysisStatus: "available" | "unavailable";
  cameraView: "front" | "side" | "oblique45";
  capturePosition: string;
  exerciseId: string | null;
  muscleGroup: MuscleGroup | null;
}

export interface LocalCaptureWrite extends LocalCaptureSummary {
  videoBlob: Blob;
  keypointsJson: string;
  labelTemplateJson: string | null;
  analysisJson: string | null;
  /** Exists for every new recording, including catalog-only exercises. */
  metadataJson?: string | null;
}

export interface LocalCapture extends LocalCaptureWrite {}

const DATABASE_NAME = "maxpower-local-captures";
const DATABASE_VERSION = 1;
const CAPTURES_STORE = "captures";

/** Durable, device-local capture storage. No recording leaves the browser. */
export async function saveLocalCapture(capture: LocalCaptureWrite): Promise<LocalCaptureSummary> {
  const database = await openCaptureDatabase();
  await transactionDone(database.transaction(CAPTURES_STORE, "readwrite"), (store) => store.put(capture));
  database.close();
  return toSummary(capture);
}

export async function listLocalCaptures(): Promise<LocalCaptureSummary[]> {
  const database = await openCaptureDatabase();
  const transaction = database.transaction(CAPTURES_STORE, "readonly");
  const stored = await requestResult<LocalCapture[]>(transaction.objectStore(CAPTURES_STORE).getAll());
  await completeTransaction(transaction);
  database.close();
  return stored.map(toSummary).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function loadLocalCapture(id: string): Promise<LocalCapture | null> {
  const database = await openCaptureDatabase();
  const transaction = database.transaction(CAPTURES_STORE, "readonly");
  const result = await requestResult<LocalCapture | undefined>(transaction.objectStore(CAPTURES_STORE).get(id));
  await completeTransaction(transaction);
  database.close();
  return result ?? null;
}

function openCaptureDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(CAPTURES_STORE)) {
        request.result.createObjectStore(CAPTURES_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开本地采集库"));
  });
}

function transactionDone(
  transaction: IDBTransaction,
  write: (store: IDBObjectStore) => IDBRequest,
): Promise<void> {
  write(transaction.objectStore(CAPTURES_STORE));
  return completeTransaction(transaction);
}

function completeTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("本地采集库写入被中止"));
    transaction.onerror = () => reject(transaction.error ?? new Error("本地采集库操作失败"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("本地采集库读取失败"));
  });
}

function toSummary(capture: LocalCaptureSummary): LocalCaptureSummary {
  const { id, createdAt, videoName, keypointsName, poseCount, durationSec, analysisStatus, cameraView, capturePosition, exerciseId } = capture;
  // Records written before muscleGroup existed remain readable in IndexedDB.
  return { id, createdAt, videoName, keypointsName, poseCount, durationSec, analysisStatus, cameraView, capturePosition, exerciseId, muscleGroup: capture.muscleGroup ?? null };
}
