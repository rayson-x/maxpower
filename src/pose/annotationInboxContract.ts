export const ANNOTATION_INBOX_MANIFEST_VERSION = "form-coach-annotation-inbox/v1" as const;
export const ANNOTATION_INBOX_VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm"]);

export interface AnnotationInboxItem {
  readonly id: string;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly videoUrl: string;
}

export function isSafeAnnotationVideoFilename(filename: string): boolean {
  if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes("..")) return false;
  const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return ANNOTATION_INBOX_VIDEO_EXTENSIONS.has(extension);
}

export function annotationVideoContentType(filename: string): string | null {
  return {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
  }[filename.slice(filename.lastIndexOf(".")).toLowerCase()] ?? null;
}
