import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '../../theme';

interface BottomActionsProps {
  children: ReactNode;
  safeArea?: boolean; // default true; false on screens already inside a SafeAreaView
}

/** The strip at the bottom of a screen that holds its main action(s), within thumb reach. */
export function BottomActions({ children, safeArea = true }: BottomActionsProps) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[styles.wrap, { backgroundColor: colors.background, paddingBottom: safeArea ? insets.bottom + 12 : 16 }]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 12, gap: 8 },
});
