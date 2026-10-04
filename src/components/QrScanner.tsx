import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { openAppSettings } from '../services/permissions/permissions';
import { radius, useAppTheme } from '../theme';
import { AppButton } from './ui/AppButton';
import { Card } from './ui/Card';
import { IconTile } from './ui/ListRow';

interface Props {
  /** Called once with the text of the first QR code seen; remount (change `key`) to scan again. */
  onScan: (text: string) => void;
}

// Fixed white: the brackets lie on the camera image, not on a themed surface.
const BRACKET = '#FFFFFF';

/**
 * QR scanner used for key verification and certificate installation. The camera permission is
 * asked for here, on demand – it is not one of the permissions the mesh needs to run.
 */
export function QrScanner({ onScan }: Props) {
  const { colors } = useAppTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const done = useRef(false);

  if (!permission) return <View style={[styles.loading, { backgroundColor: colors.surfaceVariant }]} />;

  if (!permission.granted) {
    return (
      <Card padding={24} style={styles.prompt}>
        <IconTile size={56} shape="circle" icon="camera-outline" />
        <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant, textAlign: 'center' }}>
          Do zeskanowania kodu QR potrzebny jest dostęp do aparatu. Obraz nie jest zapisywany ani wysyłany.
        </Text>
        {permission.canAskAgain ? (
          <AppButton variant="tonal" fullWidth={false} onPress={requestPermission}>
            Zezwól na aparat
          </AppButton>
        ) : (
          <AppButton variant="tonal" fullWidth={false} onPress={openAppSettings}>
            Otwórz ustawienia
          </AppButton>
        )}
      </Card>
    );
  }

  return (
    <View style={styles.frame}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          // The callback keeps firing while the code is in view – act on the first hit only.
          if (done.current) return;
          done.current = true;
          onScan(data);
        }}
      />
      {/* Aiming brackets over the preview; the image itself is not dimmed. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={[styles.bracket, styles.topLeft, { borderColor: BRACKET }]} />
        <View style={[styles.bracket, styles.topRight, { borderColor: BRACKET }]} />
        <View style={[styles.bracket, styles.bottomLeft, { borderColor: BRACKET }]} />
        <View style={[styles.bracket, styles.bottomRight, { borderColor: BRACKET }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { minHeight: 220, borderRadius: radius.lg },
  prompt: { alignItems: 'center', gap: 16, minHeight: 220, justifyContent: 'center' },
  frame: { aspectRatio: 1, borderRadius: radius.lg, overflow: 'hidden' },
  bracket: { position: 'absolute', width: 28, height: 28 },
  topLeft: { top: '15%', left: '15%', borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: radius.sm },
  topRight: { top: '15%', right: '15%', borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: radius.sm },
  bottomLeft: {
    bottom: '15%',
    left: '15%',
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: radius.sm,
  },
  bottomRight: {
    bottom: '15%',
    right: '15%',
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: radius.sm,
  },
});
