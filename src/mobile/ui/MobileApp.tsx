import React, { useCallback, useEffect, useState } from "react";
import { BackHandler, Platform, StatusBar, Text, View } from "react-native";

import { DebugErrorBoundary } from "./DebugErrorBoundary";
import { LibraryScreen } from "./LibraryScreen";
import { LiveScreen } from "./LiveScreen";
import { ProgressScreen, type ReplaySelection } from "./ProgressScreen";
import { ProfileScreen } from "./ProfileScreen";
import { ReplayScreen } from "./ReplayScreen";
import { SetupScreen, type SessionConfig } from "./SetupScreen";

type Route =
  | { name: "library" }
  | { name: "progress" }
  | { name: "profile" }
  | { name: "setup"; exerciseId: string }
  | { name: "live"; config: SessionConfig }
  | { name: "replay"; selection: ReplaySelection };

const TOP_INSET = Platform.OS === "android" ? (StatusBar.currentHeight ?? 24) : 0;

/** 简单的底部返回栏（进展/我的页用，完整 tab 导航后续再统一）。 */
function TabBackBar(props: { onBack: () => void }) {
  return (
    <View style={{ padding: 16, backgroundColor: "#FFFFFF" }}>
      <Text style={{ textAlign: "center", color: "#5A5E66", fontWeight: "700" }} onPress={props.onBack}>
        ← 返回动作库
      </Text>
    </View>
  );
}

/**
 * Android 主循环：动作库 → 机位引导 → 实时识别（+组后报告抽屉）。
 * 报告以 LiveScreen 内抽屉形式呈现，不单独占路由。
 */
export function MobileApp() {
  const [route, setRoute] = useState<Route>({ name: "library" });

  const goLibrary = useCallback(() => setRoute({ name: "library" }), []);
  const goProgress = useCallback(() => setRoute({ name: "progress" }), []);

  // Android 返回键：setup/live 返回动作库，replay 返回进展页，而不是退出 App
  useEffect(() => {
    if (Platform.OS !== "android" || route.name === "library") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (route.name === "replay") goProgress();
      else goLibrary();
      return true;
    });
    return () => sub.remove();
  }, [route.name, goLibrary, goProgress]);

  return (
    <View style={{ flex: 1, paddingTop: route.name === "live" || route.name === "replay" ? 0 : TOP_INSET }}>
      <DebugErrorBoundary onReset={goLibrary}>
        {route.name === "library" && (
          <LibraryScreen
            onSelect={(exerciseId) => setRoute({ name: "setup", exerciseId })}
            onOpenProgress={() => setRoute({ name: "progress" })}
            onOpenProfile={() => setRoute({ name: "profile" })}
          />
        )}
        {route.name === "progress" && (
          <View style={{ flex: 1 }}>
            <ProgressScreen
              onOpenReplay={(selection) => setRoute({ name: "replay", selection })}
            />
            <TabBackBar onBack={goLibrary} />
          </View>
        )}
        {route.name === "profile" && (
          <View style={{ flex: 1 }}>
            <ProfileScreen />
            <TabBackBar onBack={goLibrary} />
          </View>
        )}
        {route.name === "setup" && (
          <SetupScreen
            exerciseId={route.exerciseId}
            onBack={goLibrary}
            onStart={(config) => setRoute({ name: "live", config })}
          />
        )}
        {route.name === "live" && <LiveScreen config={route.config} onExit={goLibrary} />}
        {route.name === "replay" && (
          <ReplayScreen
            exerciseId={route.selection.exerciseId}
            capturePosition={route.selection.capturePosition}
            videoPath={route.selection.videoPath}
            onExit={goProgress}
          />
        )}
      </DebugErrorBoundary>
    </View>
  );
}
