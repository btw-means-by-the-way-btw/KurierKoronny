import type { ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { size, useAppTheme } from '../../theme';
import { AlertBanner } from '../AlertBanner';

interface TabRootProps {
  title: string;
  titleRight?: ReactNode;
  children: ReactNode;
}

/**
 * Frame of a tab's root screen: the alert banner under the status bar, then a large left-aligned
 * title with an optional action beside it, then the screen. The title is pinned – it never scrolls
 * with the content. The tabs have no navigator header; this is their header.
 */
export function TabRoot({ title, titleRight, children }: TabRootProps) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  // Short windows get the smaller title so the list keeps its room.
  const compact = useWindowDimensions().height < 700;
  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <AlertBanner />
      <View style={[styles.titleRow, compact && styles.titleRowCompact]}>
        <Text
          variant={compact ? 'titleLarge' : 'headlineLarge'}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
          accessibilityRole="header"
          style={[styles.title, { color: colors.onSurface }]}
        >
          {title}
        </Text>
        {titleRight}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, height: size.header },
  titleRowCompact: { height: 48 },
  title: { flex: 1 },
});
