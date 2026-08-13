import { StatusBar } from "expo-status-bar";
import { StatusBar as NativeStatusBar } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { MaxPowerApp } from "./src/mobile/ui/MaxPowerApp";

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NativeStatusBar barStyle="dark-content" />
      <MaxPowerApp />
      <StatusBar style="dark" />
    </GestureHandlerRootView>
  );
}
