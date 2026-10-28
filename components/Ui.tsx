import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { spacing, radius, typography, shadows } from '@/src/design-tokens';

export function AppScreen({
  title,
  eyebrow,
  subtitle,
  children,
  action,
  scroll = true,
}: {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  scroll?: boolean;
}) {
  const colors = useColors();
  const content = (
    <View style={styles.page}>
      <View style={styles.header}>
        <View style={styles.headingCopy}>
          {eyebrow ? (
            <Text style={[styles.eyebrow, { color: colors.primary }]}>
              {eyebrow}
            </Text>
          ) : null}
          <Text style={[styles.title, { color: colors.foreground }]}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {action}
      </View>
      {children}
    </View>
  );

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safe, { backgroundColor: colors.background }]}
    >
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}

export function Surface({
  children,
  style,
  elevated = false,
  glass = false,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  elevated?: boolean;
  glass?: boolean;
}) {
  const colors = useColors();

  let backgroundColor = colors.card;
  let borderColor = colors.border;
  let boxShadow: ViewStyle = shadows.md;

  if (elevated) {
    backgroundColor = colors.surfaceElevated;
    borderColor = colors.borderHighlighted;
    boxShadow = shadows.lg;
  }

  if (glass) {
    backgroundColor = colors.surfaceGlass;
    borderColor = colors.borderSubtle;
    boxShadow = shadows.glow;
  }

  return (
    <View
      style={[
        styles.surface,
        {
          backgroundColor,
          borderColor,
          ...boxShadow,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function SectionTitle({
  title,
  trailing,
}: {
  title: string;
  trailing?: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
        {title}
      </Text>
      {trailing}
    </View>
  );
}

export function ActionButton({
  label,
  onPress,
  icon,
  variant = 'primary',
  disabled = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  icon?: React.ComponentProps<typeof Feather>['name'];
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  disabled?: boolean;
  testID?: string;
}) {
  const colors = useColors();
  const background =
    variant === 'primary'
      ? colors.primary
      : variant === 'danger'
        ? colors.destructive
        : variant === 'secondary'
          ? colors.secondary
          : 'transparent';
  const foreground =
    variant === 'primary'
      ? colors.primaryForeground
      : variant === 'danger'
        ? colors.destructiveForeground
        : variant === 'secondary'
          ? colors.secondaryForeground
          : colors.mutedForeground;

  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
      ]}
    >
      {icon ? <Feather name={icon} size={16} color={foreground} /> : null}
      <Text style={[styles.buttonText, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  label,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  onPress: () => void;
  label: string;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.55 : 1 }]}
    >
      <Feather name={icon} size={20} color={colors.foreground} />
    </Pressable>
  );
}

export function StatusPill({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent';
}) {
  const colors = useColors();
  const foreground =
    tone === 'success'
      ? colors.success
      : tone === 'warning'
        ? colors.warning
        : tone === 'danger'
          ? colors.destructive
          : tone === 'accent'
            ? colors.accentForeground
            : colors.mutedForeground;
  const background =
    tone === 'success'
      ? `${colors.success}18`
      : tone === 'warning'
        ? `${colors.warning}18`
        : tone === 'danger'
          ? `${colors.destructive}18`
          : tone === 'accent'
            ? colors.accent
            : colors.muted;

  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: background,
        },
      ]}
    >
      <Text style={[styles.pillText, { color: foreground }]}>{label}</Text>
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  title: string;
  message: string;
  action?: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <Surface style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.accent }]}>
        <Feather name={icon} size={22} color={colors.accentForeground} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
        {title}
      </Text>
      <Text style={[styles.emptyMessage, { color: colors.mutedForeground }]}>
        {message}
      </Text>
      {action}
    </Surface>
  );
}

export function FormField({
  label,
  hint,
  multiline,
  ...props
}: TextInputProps & { label: string; hint?: string }) {
  const colors = useColors();
  return (
    <View style={styles.fieldWrap}>
      <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
        {label}
      </Text>
      <TextInput
        {...props}
        placeholderTextColor={colors.mutedForeground}
        multiline={multiline}
        style={[
          styles.input,
          {
            color: colors.foreground,
            backgroundColor: colors.background,
            borderColor: colors.input,
            minHeight: multiline ? 92 : 50,
            textAlignVertical: multiline ? 'top' : 'center',
          },
        ]}
      />
      {hint ? (
        <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function ChoiceRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label?: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.fieldWrap}>
      {label ? (
        <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
          {label}
        </Text>
      ) : null}
      <View style={styles.choiceWrap}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onChange(option.value)}
              style={[
                styles.choice,
                {
                  backgroundColor: selected ? colors.accent : colors.card,
                  borderColor: selected ? colors.primary : colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.choiceText,
                  {
                    color: selected
                      ? colors.accentForeground
                      : colors.mutedForeground,
                  },
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function LoadingState() {
  const colors = useColors();
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.primary} />
      <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>
        Loading saved workspace…
      </Text>
    </View>
  );
}

export function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const colors = useColors();
  return (
    <Surface style={[styles.errorBanner, { borderColor: colors.destructive }]}>
      <View style={styles.errorCopy}>
        <Feather name="alert-triangle" size={17} color={colors.destructive} />
        <Text style={[styles.errorText, { color: colors.foreground }]}>
          {message}
        </Text>
      </View>
      <ActionButton label="Retry" icon="refresh-cw" onPress={onRetry} variant="secondary" />
    </Surface>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingBottom: spacing.xxl },
  page: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.xl },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headingCopy: { flex: 1, gap: spacing.xs },
  eyebrow: { fontSize: typography.xs, fontWeight: typography.weightBold, letterSpacing: 1.5 },
  title: { fontSize: typography.xxl, lineHeight: 35, fontWeight: typography.weightBold, letterSpacing: -0.7 },
  subtitle: { fontSize: typography.sm, lineHeight: 20, maxWidth: 340 },
  surface: {
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.md,
    borderRadius: radius.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  sectionTitle: { fontSize: typography.lg, fontWeight: typography.weightBold, letterSpacing: -0.2 },
  button: {
    minHeight: 46,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  buttonText: { fontSize: typography.md, fontWeight: typography.weightBold },
  iconButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  pill: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    alignSelf: 'flex-start',
  },
  pillText: { fontSize: typography.xs, fontWeight: typography.weightBold, letterSpacing: 0.15 },
  empty: { alignItems: 'flex-start', paddingVertical: spacing.xl },
  emptyIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  emptyTitle: { fontSize: typography.lg, fontWeight: typography.weightBold },
  emptyMessage: { fontSize: typography.sm, lineHeight: 19 },
  fieldWrap: { gap: spacing.sm },
  fieldLabel: { fontSize: typography.sm, fontWeight: typography.weightBold },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: typography.md,
  },
  fieldHint: { fontSize: typography.xs, lineHeight: 17 },
  choiceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: {
    minHeight: 38,
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceText: { fontSize: typography.xs, fontWeight: typography.weightBold },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  errorBanner: { gap: spacing.md },
  errorCopy: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  errorText: { flex: 1, fontSize: typography.sm, lineHeight: 19 },
});