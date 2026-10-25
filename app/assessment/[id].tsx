import React from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useWorkspace } from '@/src/workspace';
import {
  ActionButton,
  ErrorBanner,
  LoadingState,
  StatusPill,
  Surface,
} from '@/components/Ui';

function DetailRow({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={styles.detailRow}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.value, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

export default function AssessmentDetailScreen() {
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    assessments,
    approvals,
    findings,
    loading,
    storageError,
    retryLoad,
    updateAssessmentStatus,
    deleteAssessment,
  } = useWorkspace();
  const assessment = assessments.find((item) => item.id === id);

  const remove = () => {
    if (!assessment) return;
    Alert.alert(
      'Delete this assessment?',
      'This also removes its approval and finding records from this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete assessment',
          style: 'destructive',
          onPress: () => {
            void deleteAssessment(assessment.id)
              .then(() => router.back())
              .catch((error: unknown) =>
                Alert.alert('Could not delete assessment', String(error)),
              );
          },
        },
      ],
    );
  };

  const advanceStatus = () => {
    if (!assessment) return;
    const next = assessment.status === 'planned' ? 'active' : 'completed';
    const label = next === 'active' ? 'Mark as in progress?' : 'Complete assessment?';
    Alert.alert(
      label,
      next === 'completed'
        ? 'This closes the assessment record. It does not perform any security test.'
        : 'This updates the local record only. Confirm the assessment is authorized before starting work.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: next === 'active' ? 'Start tracking' : 'Complete',
          onPress: () => {
            void updateAssessmentStatus(assessment.id, next).catch(
              (error: unknown) =>
                Alert.alert('Could not update assessment', String(error)),
            );
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safe, { backgroundColor: colors.background }]}
    >
      <View style={styles.topbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.topbarTitle, { color: colors.foreground }]}>
          Assessment details
        </Text>
        {assessment ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete assessment"
            onPress={remove}
            style={styles.backButton}
          >
            <Feather name="trash-2" size={17} color={colors.destructive} />
          </Pressable>
        ) : (
          <View style={styles.backButton} />
        )}
      </View>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {storageError ? (
          <ErrorBanner message={storageError} onRetry={() => void retryLoad()} />
        ) : null}
        {loading ? (
          <LoadingState />
        ) : !assessment ? (
          <Surface>
            <Text style={[styles.title, { color: colors.foreground }]}>
              Assessment not found
            </Text>
            <Text style={[styles.value, { color: colors.mutedForeground }]}>
              It may have been removed from this device.
            </Text>
            <ActionButton
              label="Back to assessments"
              icon="arrow-left"
              variant="secondary"
              onPress={() => router.back()}
            />
          </Surface>
        ) : (
          <>
            <View style={styles.hero}>
              <View style={[styles.heroIcon, { backgroundColor: colors.accent }]}>
                <Feather name="shield" size={23} color={colors.accentForeground} />
              </View>
              <StatusPill
                label={
                  assessment.status === 'planned'
                    ? 'Planned'
                    : assessment.status === 'active'
                      ? 'In progress'
                      : 'Complete'
                }
                tone={assessment.status === 'active' ? 'success' : 'neutral'}
              />
              <Text style={[styles.title, { color: colors.foreground }]}>
                {assessment.title}
              </Text>
              <Text style={[styles.target, { color: colors.mutedForeground }]}>
                {assessment.target}
              </Text>
            </View>

            <Surface>
              <DetailRow label="Authorized scope" value={assessment.scope} />
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <DetailRow
                label="Authorization reference"
                value={assessment.authorization}
              />
              {assessment.notes ? (
                <>
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  <DetailRow label="Notes" value={assessment.notes} />
                </>
              ) : null}
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <DetailRow
                label="Created"
                value={new Date(assessment.createdAt).toLocaleString()}
              />
            </Surface>

            <View style={styles.metrics}>
              <Metric
                label="Approval records"
                value={
                  approvals.filter((item) => item.assessmentId === assessment.id)
                    .length
                }
              />
              <Metric
                label="Findings"
                value={
                  findings.filter((item) => item.assessmentId === assessment.id)
                    .length
                }
              />
            </View>

            {assessment.status !== 'completed' ? (
              <ActionButton
                label={
                  assessment.status === 'planned'
                    ? 'Start tracking'
                    : 'Complete assessment'
                }
                icon={assessment.status === 'planned' ? 'play' : 'check'}
                onPress={advanceStatus}
              />
            ) : (
              <View
                style={[
                  styles.completedNote,
                  { backgroundColor: colors.accent },
                ]}
              >
                <Feather name="check-circle" size={17} color={colors.success} />
                <Text style={[styles.completedText, { color: colors.foreground }]}>
                  This record is complete and cannot be reopened.
                </Text>
              </View>
            )}
            <View
              style={[
                styles.guardrail,
                { backgroundColor: colors.muted, borderColor: colors.border },
              ]}
            >
              <Feather name="info" size={15} color={colors.primary} />
              <Text style={[styles.guardrailText, { color: colors.mutedForeground }]}>
                Status changes are recordkeeping only. No test or command runs from
                this screen.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  const colors = useColors();
  return (
    <Surface style={styles.metric}>
      <Text style={[styles.metricValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
    </Surface>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  topbar: {
    minHeight: 54,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topbarTitle: { flex: 1, textAlign: 'center', fontSize: 14, fontWeight: '700' },
  content: { padding: 20, paddingBottom: 38, gap: 15 },
  hero: { alignItems: 'flex-start', gap: 9, paddingVertical: 8 },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  target: { fontSize: 14 },
  detailRow: { gap: 5 },
  label: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  value: { fontSize: 14, lineHeight: 21 },
  divider: { height: 1, marginVertical: 2 },
  metrics: { flexDirection: 'row', gap: 10 },
  metric: { flex: 1 },
  metricValue: { fontSize: 21, fontWeight: '700' },
  metricLabel: { fontSize: 11, marginTop: 4 },
  completedNote: {
    borderRadius: 14,
    padding: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  completedText: { flex: 1, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  guardrail: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  guardrailText: { flex: 1, fontSize: 12, lineHeight: 18 },
});
