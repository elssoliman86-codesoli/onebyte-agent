import React from 'react';
import { Platform, ScrollView, type ScrollViewProps } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

/**
 * Keyboard-following scroll container used by the workspace sheets.
 * Falls back to a plain ScrollView where react-native-keyboard-controller
 * has no native implementation (web).
 */
export function KeyboardAwareScrollViewCompat({
  children,
  ...props
}: ScrollViewProps) {
  if (Platform.OS === 'web') {
    return (
      <ScrollView keyboardShouldPersistTaps="handled" {...props}>
        {children}
      </ScrollView>
    );
  }
  return (
    <KeyboardAwareScrollView
      bottomOffset={12}
      keyboardShouldPersistTaps="handled"
      {...props}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}
