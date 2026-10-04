import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { useAppTheme } from '../../theme';
import type { IconName } from './index';
import { IconTile } from './ListRow';

interface EmptyStateProps {
  icon: IconName;
  text: string;
  tone?: 'primary' | 'neutral'; // default 'primary'
}

/** What a list or screen shows when it has nothing to show: a glyph in a circle and one sentence. */
export function EmptyState({ icon, text, tone = 'primary' }: EmptyStateProps) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.wrap}>
      <IconTile icon={icon} size={64} shape="circle" tone={tone} />
      <Text variant="bodyLarge" style={[styles.text, { color: colors.onSurfaceVariant }]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  text: { textAlign: 'center', maxWidth: 300 },
});
