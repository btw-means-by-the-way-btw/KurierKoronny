import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { alertKey, useActiveAlerts, useAlertStore } from '../store/alertStore';
import { useAppTheme } from '../theme';
import { formatTime } from '../utils/time';
import { IconButton } from './ui/IconButton';
import { Tappable } from './ui/Tappable';

/**
 * Pinned strip for active alerts from certified authority accounts (DESIGN.md → Alert banner).
 * It cannot be dismissed while an alert is active – only folded to one line, and a newer alert
 * unfolds it again. Mounted as the first child of every main screen, like NetworkStatusBar.
 */
export function AlertBanner() {
  const theme = useAppTheme();
  const active = useActiveAlerts();
  const collapsedFor = useAlertStore((s) => s.collapsedFor);
  const setCollapsedFor = useAlertStore((s) => s.setCollapsedFor);
  const newest = active[0];
  if (!newest) return null;

  const collapsed = collapsedFor === alertKey(newest);
  const color = theme.colors.onError;
  const more = active.length > 1 ? ` · +${active.length - 1}` : '';

  return (
    <Tappable
      onPress={() => router.push('/alerts')}
      accessibilityRole="alert"
      accessibilityLabel={`Pilny komunikat urzędowy. ${newest.authority}. ${newest.headline}`}
      style={[styles.bar, { backgroundColor: theme.colors.error }]}
      pressedStyle={styles.pressed}
    >
      <Icon source="alert-octagon-outline" size={24} color={color} />
      <View style={styles.body}>
        <Text variant="labelMedium" numberOfLines={1} style={{ color }}>
          PILNE · {newest.authority}
          {more}
        </Text>
        <Text variant={collapsed ? 'labelMedium' : 'titleMedium'} numberOfLines={collapsed ? 1 : 2} style={{ color }}>
          {newest.headline}
        </Text>
        {!collapsed && (
          <>
            {!!newest.text && (
              <Text variant="bodyMedium" numberOfLines={3} style={{ color }}>
                {newest.text}
              </Text>
            )}
            <Text variant="labelMedium" style={{ color }}>
              Nadano {formatTime(newest.timestamp)} · dotknij, aby zobaczyć całość
            </Text>
          </>
        )}
      </View>
      {/* The 48px target overlaps the band's padding, so its glyph lines up with the octagon. */}
      <View style={styles.toggle}>
        <IconButton
          icon={collapsed ? 'chevron-down' : 'chevron-up'}
          color={color}
          accessibilityLabel={collapsed ? 'Rozwiń komunikat' : 'Zwiń komunikat'}
          onPress={() => setCollapsedFor(collapsed ? null : alertKey(newest))}
        />
      </View>
    </Tappable>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingLeft: 16, paddingVertical: 12 },
  body: { flex: 1, gap: 2 },
  toggle: { marginVertical: -12 },
  pressed: { opacity: 0.9 },
});
