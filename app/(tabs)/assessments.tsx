import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useWorkspace, type Assessment } from '@/src/workspace';
import {
  ActionButton,
  AppScreen,
  EmptyState,
  ErrorBanner,
  IconButton,
  LoadingState,
  StatusPill,
  Surface,
} from '@/components/Ui';
import { AssessmentSheet } from '@/components/Sheets';

function AssessmentRow({ item }: { item: Assessment }) {
  const colors = useColors();
  const label = {
    planned: 'Planned',
    active: 'In progress',
    completed: 'Complete',
  }[item.status];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        router.push({
          pathname: '/assessment/[id]',
          params: { id: item.id },
        })
      }
      style={({ pressed }) => [pressed ? { opacity: 0.78 } : undefined]}
    >
      <Surface>
        <View style={styles.rowTop}>
          <View style={[styles.iconBox, { backgroundColor: colors.accent }]}>
            <Feather name="shield" size={16} color={colors.accentForeground} />
          </View>
          <StatusPill
            label={label}
            tone={item.status === 'active' ? 'success' : 'neutral'}
          />
          <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
        </View>
        <Text style={[styles.name, { color: colors.foreground }]}>{item.title}</Text>
        <Text style={[styles.target, { color: colors.mutedForeground }]}>
          {item.target}
        </Text>
        <View style={[styles.scope, { borderTopColor: colors.border }]}>
          <Feather name="lock" size={12} color={colors.primary} />
          <Text
            numberOfLines={2}
            style={[styles.scopeText, { color: colors.mutedForeground }]}
          >
            {item.scope}
          </Text>
        </View>
      </Surface>
    </Pressable>
  );
}

export default function AssessmentsScreen() {
  const colors = useColors();
  const { assessments, loading, storageError, retryLoad } = useWorkspace();
  const [showSheet, setShowSheet] = useState(false);
  return (
    <>
      <AppScreen
        title="Assessments"
        eyebrow="SCOPE FIRST"
        subtitle="Keep each engagement tied to written authorization and a defined boundary."
        action={
          <IconButton
            icon="plus"
            label="Create assessment"
            onPress={() => setShowSheet(true)}
          />
        }
      >
        {storageError ? (
          <ErrorBanner message={storageError} onRetry={() => void retryLoad()} />
        ) : null}
        {loading ? (
          <LoadingState />
        ) : assessments.length ? (
          <View style={styles.list}>
            {assessments.map((item) => (
              <AssessmentRow key={item.id} item={item} />
            ))}
          </View>
        ) : (
          <EmptyState
            icon="shield"
            title="Nothing in the workspace"
            message="Add an assessment with its written authorization and exact scope before documenting any work."
            action={
              <ActionButton
                label="Create assessment"
                icon="plus"
                onPress={() => setShowSheet(true)}
              />
            }
          />
        )}
        <View
          style={[
            styles.scopeReminder,
            { backgroundColor: colors.accent, borderColor: colors.border },
          ]}
        >
          <Feather name="info" size={16} color={colors.accentForeground} />
          <Text style={[styles.reminderText, { color: colors.accentForeground }]}>
            Scope records are for humans to review. This app does not validate
            authorization or contact targets.
          </Text>
        </View>
      </AppScreen>
      <AssessmentSheet
        visible={showSheet}
        onClose={() => setShowSheet(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 'auto',
  },
  name: { fontSize: 16, fontWeight: '700' },
  target: { fontSize: 13 },
  scope: {
    borderTopWidth: 1,
    marginTop: 4,
    paddingTop: 11,
    flexDirection: 'row',
    gap: 7,
    alignItems: 'flex-start',
  },
  scopeText: { flex: 1, fontSize: 12, lineHeight: 17 },
  scopeReminder: {
    borderWidth: 1,
    borderRadius: 15,
    padding: 13,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  reminderText: { flex: 1, fontSize: 12, lineHeight: 18, fontWeight: '600' },
});
