import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useWorkspace, type Finding, type FindingSeverity } from '@/src/workspace';
import { alertCompat } from '@/src/web-alert';
import {
  ActionButton,
  AppScreen,
  ChoiceRow,
  EmptyState,
  ErrorBanner,
  LoadingState,
  StatusPill,
  Surface,
} from '@/components/Ui';
import { FindingSheet } from '@/components/Sheets';

function severityTone(
  severity: FindingSeverity,
): 'danger' | 'warning' | 'accent' | 'neutral' {
  if (severity === 'critical' || severity === 'high') return 'danger';
  if (severity === 'medium') return 'warning';
  if (severity === 'low') return 'accent';
  return 'neutral';
}

function FindingCard({
  finding,
  assessmentTitle,
  onStatus,
  onDelete,
}: {
  finding: Finding;
  assessmentTitle: string;
  onStatus: (status: 'reviewing' | 'resolved') => void;
  onDelete: () => void;
}) {
  const colors = useColors();
  const nextStatus = finding.status === 'open' ? 'reviewing' : 'resolved';
  return (
    <Surface>
      <View style={styles.cardHeader}>
        <StatusPill
          label={finding.severity}
          tone={severityTone(finding.severity)}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete finding: ${finding.title}`}
          onPress={onDelete}
          style={styles.deleteButton}
        >
          <Feather name="trash-2" size={16} color={colors.mutedForeground} />
        </Pressable>
      </View>
      <Text style={[styles.findingTitle, { color: colors.foreground }]}>
        {finding.title}
      </Text>
      <Text style={[styles.assessmentName, { color: colors.primary }]}>
        {assessmentTitle}
      </Text>
      {finding.location ? (
        <View style={styles.location}>
          <Feather name="map-pin" size={12} color={colors.mutedForeground} />
          <Text style={[styles.locationText, { color: colors.mutedForeground }]}>
            {finding.location}
          </Text>
        </View>
      ) : null}
      <Text style={[styles.details, { color: colors.mutedForeground }]}>
        {finding.details}
      </Text>
      <View style={styles.cardFooter}>
        <StatusPill
          label={
            finding.status === 'reviewing'
              ? 'Reviewing'
              : finding.status === 'resolved'
                ? 'Resolved'
                : 'Open'
          }
          tone={finding.status === 'resolved' ? 'success' : 'neutral'}
        />
        {finding.status !== 'resolved' ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => onStatus(nextStatus)}
            style={({ pressed }) => [styles.advance, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={[styles.advanceText, { color: colors.primary }]}>
              {finding.status === 'open' ? 'Start review' : 'Mark resolved'}
            </Text>
            <Feather name="arrow-right" size={14} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>
    </Surface>
  );
}

export default function FindingsScreen() {
  const colors = useColors();
  const {
    assessments,
    findings,
    updateFindingStatus,
    deleteFinding,
    loading,
    storageError,
    retryLoad,
  } = useWorkspace();
  const [showSheet, setShowSheet] = useState(false);
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const visibleFindings = useMemo(
    () =>
      findings.filter((finding) => {
        if (filter === 'open') return finding.status !== 'resolved';
        if (filter === 'resolved') return finding.status === 'resolved';
        return true;
      }),
    [findings, filter],
  );

  const confirmDelete = (finding: Finding) => {
    alertCompat(
      'Delete finding?',
      `“${finding.title}” will be removed from this device.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteFinding(finding.id).catch((error: unknown) =>
              alertCompat('Could not delete finding', String(error)),
            );
          },
        },
      ],
    );
  };

  return (
    <>
      <AppScreen
        title="Findings"
        eyebrow="OUTCOMES"
        subtitle="Document observations from an authorized review and track their status."
      >
        {storageError ? (
          <ErrorBanner message={storageError} onRetry={() => void retryLoad()} />
        ) : null}
        {loading ? (
          <LoadingState />
        ) : (
          <>
            {findings.length ? (
              <ChoiceRow<'all' | 'open' | 'resolved'>
                options={[
                  { value: 'all', label: `All ${findings.length}` },
                  {
                    value: 'open',
                    label: `Open ${findings.filter((item) => item.status !== 'resolved').length}`,
                  },
                  {
                    value: 'resolved',
                    label: `Resolved ${findings.filter((item) => item.status === 'resolved').length}`,
                  },
                ]}
                value={filter}
                onChange={setFilter}
              />
            ) : null}
            {visibleFindings.length ? (
              <View style={styles.list}>
                {visibleFindings.map((finding) => (
                  <FindingCard
                    key={finding.id}
                    finding={finding}
                    assessmentTitle={
                      assessments.find(
                        (assessment) => assessment.id === finding.assessmentId,
                      )?.title ?? 'Assessment unavailable'
                    }
                    onStatus={(status) =>
                      void updateFindingStatus(finding.id, status).catch(
                        (error: unknown) =>
                          alertCompat('Could not update finding', String(error)),
                      )
                    }
                    onDelete={() => confirmDelete(finding)}
                  />
                ))}
              </View>
            ) : findings.length ? (
              <EmptyState
                icon="filter"
                title="No findings in this view"
                message="Change the filter to see findings with a different status."
              />
            ) : assessments.length ? (
              <EmptyState
                icon="file-text"
                title="No findings yet"
                message="Record an observation linked to one of your assessments."
                action={
                  <ActionButton
                    label="Add a finding"
                    icon="plus"
                    onPress={() => setShowSheet(true)}
                  />
                }
              />
            ) : (
              <EmptyState
                icon="shield"
                title="Create an assessment first"
                message="Findings are always linked to a documented assessment."
              />
            )}
            {assessments.length ? (
              <ActionButton
                label="Document finding"
                icon="plus"
                variant="secondary"
                onPress={() => setShowSheet(true)}
              />
            ) : null}
          </>
        )}
      </AppScreen>
      <FindingSheet
        visible={showSheet}
        assessments={assessments}
        onClose={() => setShowSheet(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  list: { gap: 11 },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  deleteButton: { padding: 7, margin: -4 },
  findingTitle: { fontSize: 16, fontWeight: '700', lineHeight: 21 },
  assessmentName: { fontSize: 12, fontWeight: '700' },
  location: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  locationText: { fontSize: 12 },
  details: { fontSize: 13, lineHeight: 19 },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: 'rgba(128, 128, 128, 0.18)',
    paddingTop: 11,
  },
  advance: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  advanceText: { fontSize: 12, fontWeight: '700' },
});
