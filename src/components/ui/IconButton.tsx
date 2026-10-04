import { StyleSheet } from 'react-native';
import { Icon } from 'react-native-paper';

import { radius, size, useAppTheme } from '../../theme';
import type { IconName } from './index';
import { Tappable } from './Tappable';

interface IconButtonProps {
  icon: IconName;
  onPress: () => void;
  accessibilityLabel: string;
  variant?: 'plain' | 'filled'; // default 'plain'
  color?: string; // plain only; default onSurface
  disabled?: boolean;
}

/**
 * Round 48px icon button. `plain` is a bare glyph for chrome (back, banner toggle, header action);
 * `filled` is the primary disc of the send button.
 */
export function IconButton({ icon, onPress, accessibilityLabel, variant = 'plain', color, disabled }: IconButtonProps) {
  const { colors } = useAppTheme();
  const filled = variant === 'filled';
  const glyph = disabled ? colors.outline : filled ? colors.onPrimary : (color ?? colors.onSurface);
  return (
    <Tappable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      scale={0.96}
      style={[styles.button, filled && { backgroundColor: disabled ? colors.surfaceVariant : colors.primary }]}
      // A glyph in a colour of its own sits on a fill the grey disc may not suit (white on the red
      // alert banner would vanish), so it dims like a filled button.
      pressedStyle={filled || color ? styles.pressedDim : { backgroundColor: colors.surfaceVariant }}
    >
      <Icon source={icon} size={filled ? 22 : 24} color={glyph} />
    </Tappable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: size.control,
    height: size.control,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressedDim: { opacity: 0.88 },
});
