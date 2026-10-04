import { type ReactNode, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  type GestureResponderEvent,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { motion } from '../../theme';

interface TappableProps extends Omit<PressableProps, 'style' | 'children' | 'android_ripple'> {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  pressedStyle?: StyleProp<ViewStyle>; // merged while pressed
  scale?: boolean | number; // false (default) = tint only; true = 0.98; number = custom
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// One flag for the whole app: asked once, then kept current by the system event.
let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled().then(
  (enabled) => {
    reduceMotion = enabled;
  },
  () => {},
);
AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
  reduceMotion = enabled;
});
/** Whether the system asks for reduced motion. The other animated primitives read it too. */
export const reduceMotionEnabled = () => reduceMotion;

/**
 * The only touchable in the app (DESIGN.md → Motion): no ripple; a press tints the element with
 * `pressedStyle` and, with `scale`, shrinks it slightly. With reduced motion only the tint is left.
 * It sets no role – callers pass `accessibilityRole` and `accessibilityState`.
 */
export function Tappable({
  children,
  style,
  pressedStyle,
  scale = false,
  onPressIn,
  onPressOut,
  ...rest
}: TappableProps) {
  const [pressed, setPressed] = useState(false);
  const [anim] = useState(() => new Animated.Value(1));
  const shrunk = useRef(false);
  const target = scale === true ? 0.98 : scale === false ? 1 : scale;

  const pressIn = (e: GestureResponderEvent) => {
    setPressed(true);
    if (target !== 1 && !reduceMotion) {
      shrunk.current = true;
      Animated.timing(anim, { toValue: target, duration: motion.pressIn, useNativeDriver: true }).start();
    }
    onPressIn?.(e);
  };
  const pressOut = (e: GestureResponderEvent) => {
    setPressed(false);
    // Keyed on what press-in did, not on the current props, so a prop change mid-press cannot
    // leave the element shrunk.
    if (shrunk.current) {
      shrunk.current = false;
      Animated.timing(anim, { toValue: 1, duration: motion.pressOut, useNativeDriver: true }).start();
    }
    onPressOut?.(e);
  };

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={pressIn}
      onPressOut={pressOut}
      style={[style, pressed && pressedStyle, target !== 1 && { transform: [{ scale: anim }] }]}
    >
      {children}
    </AnimatedPressable>
  );
}
