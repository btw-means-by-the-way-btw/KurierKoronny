import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { type ColorValue, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useChatStore } from "../../store/chatStore";
import { useMeshStore } from "../../store/meshStore";
import { radius, size, type, useAppTheme } from "../../theme";

type IconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

interface TabIconProps {
  name: IconName;
  activeName?: IconName; // filled twin shown while focused; without one the glyph stays
  color: ColorValue;
  focused: boolean;
}

/** Active tab: filled primary icon on a primary-container pill. */
function TabIcon({ name, activeName = name, color, focused }: TabIconProps) {
  const theme = useAppTheme();
  return (
    <View
      style={[
        styles.pill,
        focused && { backgroundColor: theme.colors.primaryContainer },
      ]}>
      <MaterialCommunityIcons
        name={focused ? activeName : name}
        color={color}
        size={24}
      />
    </View>
  );
}

export default function TabsLayout() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const unread = useChatStore((s) =>
    s.conversations.reduce((n, c) => n + c.unread, 0),
  );
  const nodeCount = useMeshStore((s) => s.nodes.length);

  return (
    <Tabs
      screenOptions={{
        // Each tab root draws its own title (TabRoot).
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.outlineVariant,
          borderTopWidth: 1,
          elevation: 0,
          height: 64 + insets.bottom,
          paddingTop: 6,
        },
        tabBarLabelStyle: type.labelMd,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
        tabBarBadgeStyle: {
          backgroundColor: theme.colors.primary,
          color: theme.colors.onPrimary,
          ...type.labelSm,
          // The badge is taller than the label's line: keep the number in the middle.
          textAlignVertical: "center",
          // Beside the glyph rather than on it, with a ring that parts it from a filled icon of
          // the same colour. The ring is drawn inside the box, hence the larger box.
          end: -14,
          top: -7,
          height: 22,
          minWidth: 22,
          borderRadius: 11,
          borderWidth: 2,
          borderColor: theme.colors.surface,
        },
        // A plain Pressable instead of the stock button, which draws a ripple.
        tabBarButton: ({
          children,
          style,
          onPress,
          onLongPress,
          testID,
          role,
          "aria-label": label,
          "aria-selected": selected,
        }) => (
          <Pressable
            onPress={onPress}
            onLongPress={onLongPress}
            testID={testID}
            role={role}
            aria-label={label}
            aria-selected={selected}
            style={[style, styles.button]}>
            {children}
          </Pressable>
        ),
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: "Mesh Chat",
          tabBarLabel: "Czaty",
          tabBarBadge: unread > 0 ? unread : undefined,
          tabBarIcon: (p) => (
            <TabIcon name="chat-outline" activeName="chat" {...p} />
          ),
        }}
      />
      <Tabs.Screen
        name="network"
        options={{
          title: "Sieć mesh",
          tabBarLabel: "Sieć",
          tabBarBadge: nodeCount > 0 ? nodeCount : undefined,
          tabBarIcon: (p) => <TabIcon name="access-point-network" {...p} />,
        }}
      />
      <Tabs.Screen
        name="rag"
        options={{
          title: "Informacje",
          tabBarIcon: (p) => <TabIcon name="information-outline" {...p} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Ustawienia",
          tabBarIcon: (p) => (
            <TabIcon name="cog-outline" activeName="cog" {...p} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  pill: {
    width: 64,
    height: 32,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  button: { minHeight: size.control },
});
