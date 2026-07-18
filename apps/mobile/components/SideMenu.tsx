// 우측 사이드 메뉴 — 앱바의 아바타(초록 원)를 탭하면 열린다
import { useEffect, useRef } from "react";
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { C } from "../theme";

export type MenuTarget = "home" | "sources" | "settings" | "logout";

const PANEL_W = 264;

export function SideMenu({
  visible,
  email,
  onClose,
  onNavigate,
}: {
  visible: boolean;
  email: string;
  onClose: () => void;
  onNavigate: (target: MenuTarget) => void;
}) {
  const slide = useRef(new Animated.Value(PANEL_W)).current;

  useEffect(() => {
    Animated.spring(slide, {
      toValue: visible ? 0 : PANEL_W,
      useNativeDriver: true,
      damping: 18,
      stiffness: 180,
    }).start();
  }, [visible, slide]);

  const items: { key: MenuTarget; icon: string; label: string }[] = [
    { key: "home", icon: "🌾", label: "취재수첩" },
    { key: "sources", icon: "👥", label: "취재원 정보" },
    { key: "settings", icon: "⚙️", label: "설정" },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Animated.View
          style={[s.panel, { transform: [{ translateX: slide }] }]}
          onStartShouldSetResponder={() => true}
        >
          <View style={s.profile}>
            <View style={s.avatar}>
              <Text style={{ fontSize: 20 }}>👤</Text>
            </View>
            <Text style={s.email} numberOfLines={1}>{email}</Text>
          </View>
          {items.map((it) => (
            <Pressable
              key={it.key}
              style={({ pressed }) => [s.item, pressed && s.itemPressed]}
              onPress={() => { onClose(); onNavigate(it.key); }}
            >
              <Text style={s.itemIcon}>{it.icon}</Text>
              <Text style={s.itemLabel}>{it.label}</Text>
            </Pressable>
          ))}
          <View style={s.divider} />
          <Pressable
            style={({ pressed }) => [s.item, pressed && s.itemPressed]}
            onPress={() => { onClose(); onNavigate("logout"); }}
          >
            <Text style={s.itemIcon}>↩︎</Text>
            <Text style={[s.itemLabel, { color: C.clayDeep }]}>로그아웃</Text>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: "rgba(43,47,40,0.35)", alignItems: "flex-end",
  },
  panel: {
    width: PANEL_W, height: "100%", backgroundColor: C.surface,
    paddingTop: 64, paddingHorizontal: 14,
    borderTopLeftRadius: 24, borderBottomLeftRadius: 24,
  },
  profile: { alignItems: "center", gap: 8, marginBottom: 22 },
  avatar: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: C.sageSoft,
    alignItems: "center", justifyContent: "center",
  },
  email: { fontSize: 13, color: C.inkSoft, fontWeight: "600" },
  item: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 13, paddingHorizontal: 12, borderRadius: 14,
  },
  itemPressed: { backgroundColor: C.surface2 },
  itemIcon: { fontSize: 17, width: 24, textAlign: "center" },
  itemLabel: { fontSize: 15, fontWeight: "700", color: C.ink },
  divider: { height: 1, backgroundColor: C.line, marginVertical: 10 },
});
