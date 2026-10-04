import { StyleSheet, Text, View } from 'react-native';
import { Icon } from 'react-native-paper';

import { radius, type } from '../theme';

// Primary blue plus muted shades of the same cool family (DESIGN.md → Avatar).
const PALETTE = ['#0052A5', '#1B66B5', '#2E5E8C', '#34708F', '#4A5FA8', '#27648F', '#55689A', '#16508A'];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Deterministic colored initials avatar (color derived from the node / conversation id). */
export function Avatar({ id, label, size = 40, icon }: { id: string; label: string; size?: number; icon?: string }) {
  const disc = [styles.disc, { width: size, height: size, backgroundColor: PALETTE[hash(id) % PALETTE.length] }];
  if (icon) {
    return (
      <View style={disc}>
        <Icon source={icon} size={size / 2} color="#FFFFFF" />
      </View>
    );
  }
  const initials =
    label
      .replace(/^#/, '')
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?';
  return (
    <View style={disc}>
      <Text numberOfLines={1} style={[size >= 48 ? type.titleMd : type.labelMd, { color: '#FFFFFF' }]}>
        {initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  disc: { borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
});
