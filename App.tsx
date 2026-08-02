import { StatusBar } from "expo-status-bar";
import { Platform, StyleSheet, Text, View } from "react-native";

import { CameraPoseView } from "./src/components/CameraPoseView";

export default function App() {
  if (Platform.OS === "web" || Platform.OS === "android") {
    return (
      <>
        <CameraPoseView />
        <StatusBar style="light" />
      </>
    );
  }
  return (
    <View style={styles.container}>
      <Text>iOS 端尚未实现,请使用 Web 或 Android。</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
  },
});
