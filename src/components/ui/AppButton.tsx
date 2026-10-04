import { type StyleProp, StyleSheet, type ViewStyle } from 'react-native';
import { ActivityIndicator, Icon, Text } from 'react-native-paper';

import { radius, size, useAppTheme } from '../../theme';
import type { IconName } from './index';
import { Tappable } from './Tappable';

interface AppButtonProps {
  children: string;
  onPress?: () => void;
  variant?: 'primary' | 'tonal' | 'destructive' | 'text'; // default 'primary'
  danger?: boolean; // 'text' only: label in errorText
  icon?: IconName;
  iconPosition?: 'start' | 'end'; // default 'start'
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean; // default true (alignSelf 'stretch'); false hugs content
  onRaised?: boolean; // set by Sheet only: disabled fill is `background`
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The app's button: a 48px pill in four variants (DESIGN.md → Button primary / tonal / text /
 * destructive). A long label wraps to two lines and the button grows; it is never cut or shrunk.
 */
export function AppButton({
  children,
  onPress,
  variant = 'primary',
  danger,
  icon,
  iconPosition = 'start',
  loading,
  disabled,
  fullWidth = true,
  onRaised,
  accessibilityLabel,
  style,
}: AppButtonProps) {
  const { colors } = useAppTheme();
  const { fill, content } = disabled
    ? { fill: onRaised ? colors.background : colors.surfaceVariant, content: colors.outline }
    : variant === 'primary'
      ? { fill: colors.primary, content: colors.onPrimary }
      : variant === 'tonal'
        ? { fill: colors.primaryContainer, content: colors.tonalText }
        : variant === 'destructive'
          ? { fill: colors.error, content: colors.onError }
          : { fill: 'transparent', content: danger ? colors.errorText : colors.primary };

  const mark = loading ? (
    <ActivityIndicator size={18} color={content} />
  ) : icon ? (
    <Icon source={icon} size={20} color={content} />
  ) : null;

  return (
    <Tappable
      onPress={loading ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, busy: loading }}
      scale
      style={[
        styles.button,
        variant === 'text' && styles.text,
        fullWidth ? styles.stretch : styles.hug,
        { backgroundColor: fill },
        style,
      ]}
      pressedStyle={variant === 'text' ? { backgroundColor: colors.primaryContainer } : styles.pressed}
    >
      {iconPosition === 'start' && mark}
      <Text variant="titleMedium" numberOfLines={2} style={[styles.label, { color: content }]}>
        {children}
      </Text>
      {iconPosition === 'end' && mark}
    </Tappable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: size.control,
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: radius.full,
  },
  text: { paddingHorizontal: 12 },
  stretch: { alignSelf: 'stretch' },
  // Centred on the cross axis, so it hugs in a column and lines up with its neighbours in a row.
  hug: { alignSelf: 'center' },
  label: { textAlign: 'center', flexShrink: 1 },
  pressed: { opacity: 0.88 },
});
