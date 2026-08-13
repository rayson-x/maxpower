import React, { useState, type ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";

import {
  annotateProfessionalTerms,
  readProfessionalTerm,
  type ProfessionalTermId,
} from "./professionalTerms";
import { uiColors, uiRadius, uiType } from "./tokens";

export function ProfessionalTermText({ text, style, prefix, numberOfLines }: {
  text: string;
  style?: StyleProp<TextStyle>;
  prefix?: ReactNode;
  numberOfLines?: number;
}) {
  const [openTermId, setOpenTermId] = useState<ProfessionalTermId>();
  const openTerm = openTermId ? readProfessionalTerm(openTermId) : undefined;
  return <>
    <Text style={style} numberOfLines={numberOfLines}>
      {prefix}
      {annotateProfessionalTerms(text).map((part, index) => part.kind === "text"
        ? <React.Fragment key={`text:${index}`}>{part.text}</React.Fragment>
        : <Text
            key={`term:${index}:${part.termId}`}
            accessibilityRole="button"
            accessibilityLabel={`解释专业名词 ${readProfessionalTerm(part.termId).label}`}
            accessibilityHint="双击查看通俗解释"
            onPress={() => setOpenTermId(part.termId)}
            style={styles.term}
          >{part.text}</Text>)}
    </Text>
    {openTerm ? <Modal animationType="fade" transparent visible onRequestClose={() => setOpenTermId(undefined)}>
      <View style={styles.scrim}>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭专业名词解释" onPress={() => setOpenTermId(undefined)} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={styles.sheet}>
          <Text style={styles.eyebrow}>专业名词</Text>
          <Text style={styles.title}>{openTerm.label}</Text>
          <Text style={styles.fullName}>{openTerm.fullName}</Text>
          <Text style={styles.meaning}>{openTerm.plainMeaning}</Text>
          <View style={styles.example}><Text style={styles.exampleText}>{openTerm.example}</Text></View>
          <Text style={styles.detail}>{openTerm.scaleDirection}</Text>
          <Text style={styles.boundary}>{openTerm.boundary}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="知道了，关闭解释" onPress={() => setOpenTermId(undefined)} style={styles.close}><Text style={styles.closeText}>知道了</Text></Pressable>
        </View>
      </View>
    </Modal> : null}
  </>;
}

const styles = StyleSheet.create({
  term: { color: uiColors.limeDeep, fontWeight: "900", textDecorationLine: "underline", textDecorationStyle: "dotted" },
  scrim: { flex: 1, justifyContent: "flex-end", padding: 16, backgroundColor: uiColors.scrim },
  sheet: { padding: 20, gap: 10, borderRadius: uiRadius.drawer, backgroundColor: uiColors.paper },
  eyebrow: { color: uiColors.limeDeep, fontSize: 11, fontWeight: "900", letterSpacing: 0.7 },
  title: { color: uiColors.ink, fontFamily: uiType.display, fontSize: 31, fontWeight: "900" },
  fullName: { color: uiColors.inkMuted, fontSize: 13, fontWeight: "800" },
  meaning: { marginTop: 4, color: uiColors.ink, fontSize: 16, fontWeight: "800", lineHeight: 24 },
  example: { marginTop: 2, padding: 13, borderRadius: uiRadius.medium, backgroundColor: uiColors.limeSoft },
  exampleText: { color: uiColors.ink, fontSize: 14, fontWeight: "800", lineHeight: 21 },
  detail: { color: uiColors.inkMuted, fontSize: 13, lineHeight: 20 },
  boundary: { color: uiColors.inkFaint, fontSize: 12, lineHeight: 18 },
  close: { minHeight: 48, marginTop: 4, alignItems: "center", justifyContent: "center", borderRadius: uiRadius.pill, backgroundColor: uiColors.ink },
  closeText: { color: uiColors.white, fontSize: 14, fontWeight: "900" },
});
