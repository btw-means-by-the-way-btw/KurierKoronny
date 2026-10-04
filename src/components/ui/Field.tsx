import { type Ref, useState } from 'react';
import { StyleSheet, TextInput, type TextInputProps, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { elevation, radius, size, type, useAppTheme } from '../../theme';

interface FieldProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  helper?: string;
  error?: string | null;
  counter?: string; // e.g. "3/24"
  inset?: boolean; // inside a card or sheet: fill is `background`
  mono?: boolean;
  ref?: Ref<TextInput>;
}

const BORDER = 2;

/**
 * Filled text field (DESIGN.md → Text field): label above, a borderless box that gets a 2px border
 * on focus or error, and a line below for the error or hint and a counter. Fully controlled – every
 * other prop and the ref go straight to the `TextInput`.
 */
export function Field({
  label,
  helper,
  error,
  counter,
  inset,
  mono,
  ref,
  multiline,
  onFocus,
  onBlur,
  ...rest
}: FieldProps) {
  const { colors, dark } = useAppTheme();
  const [focused, setFocused] = useState(false);

  return (
    <View>
      {label !== undefined && (
        <Text variant="labelMedium" style={[styles.label, { color: colors.onSurfaceVariant }]}>
          {label}
        </Text>
      )}
      <View
        style={[
          styles.box,
          {
            backgroundColor: inset ? colors.background : colors.surface,
            borderColor: error ? colors.errorText : focused ? colors.primary : 'transparent',
          },
          !inset && elevation(dark, 'card'),
        ]}
      >
        <TextInput
          accessibilityLabel={label ?? rest.placeholder}
          placeholderTextColor={colors.onSurfaceVariant}
          cursorColor={colors.primary}
          selectionColor={colors.primary}
          {...rest}
          ref={ref}
          multiline={multiline}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, multiline && styles.multiline, mono && styles.mono, { color: colors.onSurface }]}
        />
      </View>
      {error || helper || counter ? (
        <View style={styles.below}>
          <View style={styles.message}>
            {error ? (
              <>
                <View style={styles.errorIcon}>
                  <Icon source="alert-circle-outline" size={16} color={colors.errorText} />
                </View>
                <Text variant="bodyMedium" style={[styles.messageText, { color: colors.errorText }]}>
                  {error}
                </Text>
              </>
            ) : helper ? (
              <Text variant="bodyMedium" style={[styles.messageText, { color: colors.onSurfaceVariant }]}>
                {helper}
              </Text>
            ) : null}
          </View>
          {counter ? (
            <Text variant="labelMedium" style={[styles.counter, { color: colors.onSurfaceVariant }]}>
              {counter}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { marginBottom: 6 },
  // The border is always there (transparent at rest), so focus and error do not move the text.
  box: { borderRadius: radius.md, borderWidth: BORDER },
  // The padding is on the input, not on the box, so a tap anywhere in the box focuses it. Heights
  // are the box heights (48 / 120) less the border.
  input: {
    ...type.bodyLg,
    minHeight: size.control - 2 * BORDER,
    paddingHorizontal: 16,
    paddingVertical: 0,
  },
  multiline: { minHeight: 120 - 2 * BORDER, paddingVertical: 12, textAlignVertical: 'top' },
  mono: { fontFamily: 'monospace' },
  below: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 6 },
  message: { flex: 1, flexDirection: 'row', gap: 4 },
  // Centres the 16px glyph on the first 20px line of the message.
  errorIcon: { marginTop: 2 },
  messageText: { flex: 1 },
  counter: { fontVariant: ['tabular-nums'] },
});
