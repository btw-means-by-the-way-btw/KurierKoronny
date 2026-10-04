import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';

import { elevation, radius, useAppTheme } from '../../theme';
import { Tappable } from './Tappable';

interface CardProps {
  children: ReactNode;
  padding?: 0 | 12 | 16 | 24; // default 16
  radius?: 'md' | 'lg'; // 12 | 16, default 'lg'
  alert?: boolean; // 1px errorText border: active alert cards only
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * White surface with the one soft shadow (DESIGN.md → Elevation, level 1); in dark mode a lighter
 * surface and no shadow. With `onPress` / `onLongPress` the whole card is one button.
 */
export function Card({
  children,
  padding = 16,
  radius: corner = 'lg',
  alert,
  onPress,
  onLongPress,
  accessibilityLabel,
  style,
}: CardProps) {
  const { colors, dark } = useAppTheme();
  const cardStyle = [
    styles.card,
    { padding, borderRadius: radius[corner], backgroundColor: colors.surface },
    elevation(dark, 'card'),
    alert && { borderWidth: 1, borderColor: colors.errorText },
    style,
  ];
  if (onPress || onLongPress) {
    return (
      <Tappable
        onPress={onPress}
        onLongPress={onLongPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        scale
        style={cardStyle}
        pressedStyle={{ backgroundColor: colors.surfaceVariant }}
      >
        {children}
      </Tappable>
    );
  }
  return (
    <View accessibilityLabel={accessibilityLabel} style={cardStyle}>
      {children}
    </View>
  );
}

interface GroupCardProps {
  children: ReactNode;
  inset?: number; // hairline left inset, default 68 = 16 padding + 40 tile + 12 gap
}

/** Children as a flat list: nulls dropped and fragments opened, so `{cond && <>…</>}` works. */
function rows(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap((child) =>
    isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment ? rows(child.props.children) : [child],
  );
}

/**
 * One card holding the rows of a section (settings, permissions), separated by a hairline that
 * starts at the text edge. The only place hairlines between rows exist.
 */
export function GroupCard({ children, inset = 68 }: GroupCardProps) {
  const { colors, dark } = useAppTheme();
  return (
    // Two views: the shadow would be cut off by the clipping that keeps row tints inside the corners.
    <View style={[styles.group, { backgroundColor: colors.surface }, elevation(dark, 'card')]}>
      <View style={[styles.group, styles.clip]}>
        {rows(children).map((child, i) => (
          <Fragment key={i}>
            {i > 0 && <View style={[styles.hairline, { backgroundColor: colors.outlineVariant, marginLeft: inset }]} />}
            {child}
          </Fragment>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8 },
  group: { borderRadius: radius.lg },
  clip: { overflow: 'hidden' },
  hairline: { height: 1 },
});
