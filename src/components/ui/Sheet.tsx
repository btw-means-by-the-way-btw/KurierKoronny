import { Children, type ReactNode, useEffect, useRef, useState } from 'react';
import { Animated, Keyboard, StyleSheet, View } from 'react-native';
import { Modal, Portal, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { elevation, motion, radius, useAppTheme } from '../../theme';
import { AppButton } from './AppButton';
import { reduceMotionEnabled } from './Tappable';

interface SheetProps {
  visible: boolean;
  onDismiss: () => void;
  title: string;
  children?: ReactNode; // a string is wrapped in bodyLg/onSurface
  primary: { label: string; onPress: () => void; destructive?: boolean; disabled?: boolean };
  cancelLabel?: string; // default 'Anuluj'
  keyboard?: boolean; // nick editor only
}

const SLIDE = 24;

/**
 * Bottom sheet for a question or a short form (DESIGN.md → Bottom sheet): title, body and two
 * full-width stacked buttons, the confirming one on top and the cancelling one at the bottom.
 * Tapping outside and the hardware back button dismiss it. With `keyboard` the panel stays above
 * the on-screen keyboard.
 */
export function Sheet({ visible, onDismiss, title, children, primary, cancelLabel = 'Anuluj', keyboard }: SheetProps) {
  const { colors, dark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [slide] = useState(() => new Animated.Value(0));
  const [lift, setLift] = useState(0);
  const panelRef = useRef<View>(null);

  useEffect(() => {
    if (!visible || reduceMotionEnabled()) return;
    slide.setValue(SLIDE);
    Animated.timing(slide, { toValue: 0, duration: motion.sheet, useNativeDriver: true }).start();
  }, [visible, slide]);

  // No KeyboardAvoidingView: it computes zero for a bottom-anchored panel inside Paper's Modal.
  // The lift is 0 when the window already resized and the keyboard overlap when it did not. An
  // overlap no larger than the bottom inset (a floating keyboard) only covers the panel's own
  // padding, so the panel stays on the bottom edge.
  useEffect(() => {
    if (!keyboard) return;
    const show = Keyboard.addListener('keyboardDidShow', (e) =>
      panelRef.current?.measureInWindow((_x, y, _w, h) =>
        setLift((prev) => {
          const next = prev + y + h - e.endCoordinates.screenY;
          return next > insets.bottom ? next : 0;
        }),
      ),
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => setLift(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [keyboard, insets.bottom]);

  // Bare text – a string, or a sentence with `{values}` in it, which arrives as several parts –
  // has to be wrapped in a Text; elements are laid out as given.
  const parts = Children.toArray(children);
  const bareText = parts.some((part) => typeof part === 'string' || typeof part === 'number');

  return (
    <Portal>
      {/* No contentContainerStyle: Paper's inner Surface would add an Android `elevation` to it. */}
      <Modal visible={visible} onDismiss={onDismiss} style={styles.host}>
        {/* The measured view carries the lift but not the slide: measureInWindow counts transforms. */}
        <View ref={panelRef} collapsable={false} style={{ marginBottom: lift }}>
          <Animated.View
            style={[
              styles.panel,
              {
                backgroundColor: dark ? colors.surfaceVariant : colors.surface,
                paddingBottom: insets.bottom + 16,
                transform: [{ translateY: slide }],
              },
              elevation(dark, 'sheet'),
            ]}
          >
            <Text variant="titleLarge" accessibilityRole="header" style={{ color: colors.onSurface }}>
              {title}
            </Text>
            {parts.length > 0 && (
              <View style={styles.body}>
                {bareText ? (
                  <Text variant="bodyLarge" style={{ color: colors.onSurface }}>
                    {children}
                  </Text>
                ) : (
                  children
                )}
              </View>
            )}
            <View style={styles.actions}>
              <AppButton
                variant={primary.destructive ? 'destructive' : 'primary'}
                onPress={primary.onPress}
                disabled={primary.disabled}
                onRaised
              >
                {primary.label}
              </AppButton>
              <AppButton variant="tonal" onPress={onDismiss}>
                {cancelLabel}
              </AppButton>
            </View>
          </Animated.View>
        </View>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  // Overrides Paper's centring and its safe-area margins: the panel reaches the bottom edge and
  // pads the inset itself.
  host: { justifyContent: 'flex-end', marginTop: 0, marginBottom: 0 },
  panel: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: 24,
    paddingHorizontal: 16,
  },
  body: { marginTop: 8, gap: 12 },
  actions: { marginTop: 24, gap: 8 },
});
