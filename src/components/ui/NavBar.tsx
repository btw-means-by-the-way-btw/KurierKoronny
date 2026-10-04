import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { size, useAppTheme } from '../../theme';
import { IconButton } from './IconButton';

interface NavBarProps {
  title?: string;
  onBack?: () => void;
  center?: ReactNode; // replaces the title; the row is then 64 high
  right?: ReactNode;
}

/**
 * Header of a pushed screen: a round back button and a left-aligned title on the background, no
 * shadow. The root stack renders it as its `header`, so screens never build one by hand; the chat
 * injects `center` and `right` through its screen options.
 */
export function NavBar({ title, onBack, center, right }: NavBarProps) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const custom = center !== undefined;
  return (
    <View style={{ paddingTop: insets.top, backgroundColor: colors.background }}>
      {/* The row does not depend on its content, so the screen below does not jump. A custom centre
          may outgrow it at a raised system font size; it then grows instead of spilling over. */}
      <View style={[styles.row, custom ? { minHeight: size.chatHeader } : { height: size.header }]}>
        {onBack ? (
          <IconButton icon="arrow-left" accessibilityLabel="Wróć" onPress={onBack} />
        ) : (
          <View style={styles.spacer} />
        )}
        {custom ? (
          <View style={styles.fill}>{center}</View>
        ) : (
          <Text
            variant="titleLarge"
            numberOfLines={1}
            accessibilityRole="header"
            style={[styles.title, { color: colors.onSurface }]}
          >
            {title}
          </Text>
        )}
        {right}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 },
  spacer: { width: 12 },
  fill: { flex: 1 },
  title: { flex: 1, marginLeft: 4, textAlign: 'left' },
});
