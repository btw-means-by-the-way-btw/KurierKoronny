import { Children, type ReactNode } from 'react';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { radius, useAppTheme } from '../../theme';
import type { IconName } from './index';
import { StatusDisc } from './StatusDisc';
import { Tappable } from './Tappable';

interface NoticeProps {
  tone: 'neutral' | 'success' | 'error';
  icon: IconName;
  children: ReactNode; // a string is wrapped in bodyMd; nodes render as given
  strong?: boolean; // error only: 32dp solid error disc with a white glyph
  footer?: ReactNode; // under the text (TrustBadge, MonoGrid)
  onPress?: () => void;
  live?: boolean; // accessibilityLiveRegion="polite"
  style?: StyleProp<ViewStyle>;
}

/**
 * Flat block with an icon and a message that is never cut: neutral information, a confirmation or
 * an error. On the error tone the text stays in the text colour – only the icon carries red.
 */
export function Notice({ tone, icon, children, strong, footer, onPress, live, style }: NoticeProps) {
  const { colors } = useAppTheme();
  const { fill, text, glyph } =
    tone === 'neutral'
      ? { fill: colors.surface, text: colors.onSurface, glyph: colors.onSurfaceVariant }
      : tone === 'success'
        ? { fill: colors.primaryContainer, text: colors.onPrimaryContainer, glyph: colors.onPrimaryContainer }
        : { fill: colors.errorContainer, text: colors.onErrorContainer, glyph: colors.errorText };

  // Bare text – a string, or a sentence with `{values}` in it, which arrives as several parts –
  // has to be wrapped in a Text; elements are laid out as given.
  const bareText = Children.toArray(children).some((part) => typeof part === 'string' || typeof part === 'number');

  const content = (
    <>
      {tone === 'error' && strong ? (
        <StatusDisc status="error" icon={icon} size={32} />
      ) : (
        <Icon source={icon} size={24} color={glyph} />
      )}
      <View style={styles.body}>
        {bareText ? (
          <Text variant="bodyMedium" style={{ color: text }}>
            {children}
          </Text>
        ) : (
          children
        )}
        {footer}
      </View>
    </>
  );
  const noticeStyle = [styles.notice, { backgroundColor: fill }, style];
  const liveRegion = live ? 'polite' : undefined;

  if (onPress) {
    return (
      <Tappable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLiveRegion={liveRegion}
        scale
        style={noticeStyle}
        pressedStyle={tone === 'neutral' ? { backgroundColor: colors.surfaceVariant } : styles.pressed}
      >
        {content}
      </Tappable>
    );
  }
  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
      accessibilityLiveRegion={liveRegion}
      style={noticeStyle}
    >
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, borderRadius: radius.lg },
  body: { flex: 1, gap: 8 },
  pressed: { opacity: 0.88 },
});
