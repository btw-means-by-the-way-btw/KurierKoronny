import type { ComponentProps } from 'react';

import { AppButton } from './ui/AppButton';

/** Full-width 48px pill – the one main action of a screen (DESIGN.md → button-primary). */
export function PrimaryButton(props: Omit<ComponentProps<typeof AppButton>, 'variant' | 'fullWidth'>) {
  return <AppButton {...props} />;
}
