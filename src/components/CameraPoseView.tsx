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
  if (Platform.OS === "android") {
    const { CameraPoseView: AndroidCameraPoseView } = require("./CameraPoseView.android") as typeof import("./CameraPoseView.android");
    return <AndroidCameraPoseView />;
  }
  return null;
}
