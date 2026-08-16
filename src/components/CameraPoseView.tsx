import { Platform } from "react-native";

/**
 * Keep the platform implementations isolated at runtime. The web view touches
 * browser-only APIs at module initialization, so it must never be imported by
 * an Android or iOS bundle.
 */
export function CameraPoseView() {
  if (Platform.OS === "web") {
    const { CameraPoseView: WebCameraPoseView } = require("./CameraPoseView.web") as typeof import("./CameraPoseView.web");
    return <WebCameraPoseView />;
  }
  // Native product capture is owned by ProductShell's WorkoutMonitorWorkspace.
  // The retired Android demo router must not become a second app entry.
  return null;
}
