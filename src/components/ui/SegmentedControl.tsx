import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { elevation, motion, radius, size, useAppTheme } from '../../theme';
import type { IconName } from './index';
import { reduceMotionEnabled, Tappable } from './Tappable';

interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: string; icon?: IconName }[];
  accessibilityLabel?: string;
}

const INSET = 4;

/**
 * One-of-N choice (DESIGN.md → Segmented control): a white pill track with a tinted thumb that
 * slides under the chosen segment. The choice is told three ways – thumb, colour and glyph (the
 * option's own icon, or a check mark when it has none).
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  accessibilityLabel,
}: SegmentedControlProps<T>) {
  const { colors, dark } = useAppTheme();
  const index = options.findIndex((o) => o.value === value);
  const [trackWidth, setTrackWidth] = useState(0);
  // Position in segments, not pixels: a new track width moves the thumb without an animation.
  const [pos] = useState(() => new Animated.Value(Math.max(index, 0)));
  const thumbWidth = (trackWidth - 2 * INSET) / options.length;

  useEffect(() => {
    if (index < 0) return;
    Animated.timing(pos, {
      toValue: index,
      duration: reduceMotionEnabled() ? 0 : motion.segment,
      useNativeDriver: true,
    }).start();
  }, [index, pos]);

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      style={[styles.track, { backgroundColor: colors.surface }, elevation(dark, 'card')]}
    >
      {trackWidth > 0 && index >= 0 && (
        <Animated.View
          style={[
            styles.thumb,
            {
              width: thumbWidth,
              backgroundColor: colors.primaryContainer,
              transform: [{ translateX: pos.interpolate({ inputRange: [0, 1], outputRange: [0, thumbWidth] }) }],
            },
          ]}
        />
      )}
      {options.map((option, i) => {
        const selected = i === index;
        const color = selected ? colors.tonalText : colors.onSurfaceVariant;
        const glyph = option.icon ?? (selected ? 'check' : undefined);
        return (
          <Tappable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={styles.segment}
            pressedStyle={styles.pressed}
          >
            {glyph && <Icon source={glyph} size={16} color={color} />}
            <Text variant="labelMedium" numberOfLines={1} style={[styles.label, { color }]}>
              {option.label}
            </Text>
          </Tappable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // The horizontal inset makes each segment exactly as wide as the thumb, so labels sit centred on it.
  track: { flexDirection: 'row', height: size.control, paddingHorizontal: INSET, borderRadius: radius.full },
  thumb: {
    position: 'absolute',
    top: INSET,
    left: INSET,
    height: size.control - 2 * INSET,
    borderRadius: radius.full,
  },
  segment: {
    flex: 1,
    height: size.control,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  label: { flexShrink: 1 },
  pressed: { opacity: 0.88 },
});
