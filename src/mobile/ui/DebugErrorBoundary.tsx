import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { colors } from "./theme";

interface Props {
  children: React.ReactNode;
  onReset: () => void;
}
interface State {
  error: Error | null;
}

/**
 * 开发期调试边界：任何屏渲染崩溃都把错误全文显示出来，
 * 而不是静默黑屏/无响应。
 */
export class DebugErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.page}>
        <Text style={styles.title}>页面渲染出错</Text>
        <ScrollView style={styles.scroll}>
          <Text style={styles.body}>
            {this.state.error.message}
            {"\n\n"}
            {this.state.error.stack}
          </Text>
        </ScrollView>
        <TouchableOpacity
          style={styles.btn}
          onPress={() => {
            this.setState({ error: null });
            this.props.onReset();
          }}
        >
          <Text style={styles.btnText}>返回动作库</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.paper, padding: 24, paddingTop: 80 },
  title: { fontSize: 20, fontWeight: "900", color: colors.terra, marginBottom: 16 },
  scroll: { flex: 1 },
  body: { fontSize: 12, color: colors.ink, fontFamily: "monospace" },
  btn: {
    height: 52, borderRadius: 16, backgroundColor: colors.ink,
    alignItems: "center", justifyContent: "center", marginTop: 16,
  },
  btnText: { color: colors.white, fontWeight: "900" },
});
