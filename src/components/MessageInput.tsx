import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Icon, Text } from 'react-native-paper';

import { MAX_MESSAGE_LENGTH } from '../services/mesh/MeshService';
import { size, type, useAppTheme } from '../theme';
import { IconButton } from './ui/IconButton';

interface Props {
  onSend: (text: string) => Promise<boolean>;
  disabled?: boolean;
}

/**
 * Chat composer bar (DESIGN.md → Message input): a filled pill field that grows with the text and
 * a round send button. Near the length limit a counter appears; past it sending is blocked.
 */
export function MessageInput({ onSend, disabled }: Props) {
  const { colors } = useAppTheme();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const remaining = MAX_MESSAGE_LENGTH - text.length;
  const canSend = text.trim().length > 0 && remaining >= 0 && !busy && !disabled;

  const send = async () => {
    if (!canSend) return;
    setBusy(true);
    try {
      if (await onSend(text)) setText('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.wrap, { backgroundColor: colors.surface, borderTopColor: colors.outlineVariant }]}>
      <View style={[styles.field, { backgroundColor: colors.surfaceVariant }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Wiadomość"
          placeholderTextColor={colors.onSurfaceVariant}
          style={[styles.input, { color: colors.onSurface }]}
          multiline
          maxLength={MAX_MESSAGE_LENGTH + 50}
          accessibilityLabel="Treść wiadomości"
        />
        {remaining < 60 && (
          <View style={styles.counter}>
            {remaining < 0 && <Icon source="alert-circle-outline" size={16} color={colors.errorText} />}
            <Text
              variant="labelMedium"
              style={[styles.count, { color: remaining < 0 ? colors.onSurface : colors.onSurfaceVariant }]}
            >
              {remaining}
            </Text>
          </View>
        )}
      </View>
      <IconButton variant="filled" icon="send-outline" disabled={!canSend} onPress={send} accessibilityLabel="Wyślij" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    borderTopWidth: 1,
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: size.control / 2,
    paddingHorizontal: 16,
    minHeight: size.control,
  },
  input: { flex: 1, ...type.bodyLg, maxHeight: 120, paddingVertical: 8 },
  counter: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  count: { fontVariant: ['tabular-nums'] },
});
