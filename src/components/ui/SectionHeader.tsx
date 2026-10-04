import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { useAppTheme } from '../../theme';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  first?: boolean; // first section of a screen: smaller top margin
}

/** Title of a section of a screen, with an optional explanatory line under it. */
export function SectionHeader({ title, subtitle, first }: SectionHeaderProps) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.wrap, first && styles.first]}>
      <Text variant="titleLarge" accessibilityRole="header" style={{ color: colors.onSurface }}>
        {title}
      </Text>
      {subtitle !== undefined && (
        <Text variant="bodyMedium" style={[styles.subtitle, { color: colors.onSurfaceVariant }]}>
          {subtitle}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 24, marginBottom: 12 },
  first: { marginTop: 8 },
  subtitle: { marginTop: 2 },
});
