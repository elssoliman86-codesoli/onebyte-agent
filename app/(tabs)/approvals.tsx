import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { useWorkspace } from '@/src/workspace';
import {
  ActionButton,
  AppScreen,
  EmptyState,
  ErrorBanner,
  LoadingState,
  SectionTitle,
  StatusPill,
  Surface,
} from '@/components/Ui';
import { ApprovalSheet } from '@/components/Sheets';

export default function ApprovalsScreen() {
  const colors = useColors();
  const {
    approvals,
    assessments,
    decideApproval,
    loading,
    storageError,
    retryLoad,
  } = useWorkspace();
  const [showSheet, setShowSheet] = useState(false);
  const activeAssessments = assessments.filter(
    (assessment) => assessment.status !== 'completed',
  );
  const pending = approvals.filter((approval) => approval.status === 'pending');
  const history = approvals.filter((approval) => approval.status !== 'pending');

  const decide = (id: string, status: 'approved' | 'rejected') => {
    Alert.alert(
      `${status === 'approved' ? 'Approve' : 'Reject'} this record?`,
      `This records your decision for the exact action shown. It does not execute the action or grant ongoing permission.`,
      [
        { text: 'Keep pending', style: 'cancel' },
        {
          text: status === 'approved' ? 'Approve' : 'Reject',
          style: status === 'rejected' ? 'destructive' : 'default',
          onPress: () => {
            void decideApproval(id, status).catch((error: unknown) => {
              Alert.alert('Could not save decision', String(error));
            });
          },
        },
      ],
    );
  };

  return (
    <>
      <AppScreen
        title="Approvals"
        eyebrow="EXPLICIT DECISIONS"
        subtitle="Review one proposed action at a time. Decisions stay attached to their scope."
      >
        {storageError ? (
          <ErrorBanner message={storageError} onRetry={() => void retryLoad()} />
        ) : null}
        {loading ? (
          <LoadingState />
        ) : (
          <>
            <SectionTitle
              title="Waiting for review"
              trailing={
                <Text style={[styles.count, { color: colors.mutedForeground }]}>
                  {pending.length}
                </Text>
              }
            />
            {pending.length ? (
              <View style={styles.list}>
                {pending.map((approval) => {
                  const assessment = assessments.find(
                    (item) => item.id === approval.assessmentId,
                  );
                  return (
                    <Surface key={approval.id}>
                      <View style={styles.approvalHeader}>
                        <View
                          style={[
                            styles.iconBox,
                            { backgroundColor: `${colors.warning}18` },
                          ]}
                        >
                          <Feather
                            name="check-square"
                            size={16}
                            color={colors.warning}
                          />
                        </View>
                        <StatusPill label="Pending" tone="warning" />
                      </View>
                      <Text style={[styles.action, { color: colors.foreground }]}>
                        {approval.action}
                      </Text>
                      <Text style={[styles.assessmentName, { color: colors.primary }]}>
                        {assessment?.title ?? 'Assessment unavailable'}
                      </Text>
                      <View style={[styles.detail, { borderTopColor: colors.border }]}>
                        <Text style={[styles.label, { color: colors.mutedForeground }]}>
                          Exact scope
                        </Text>
                        <Text style={[styles.detailText, { color: colors.foreground }]}>
                          {approval.scope}
                        </Text>
                        <Text style={[styles.label, { color: colors.mutedForeground }]}>
                          Reason
                        </Text>
                        <Text style={[styles.detailText, { color: colors.foreground }]}>
                          {approval.reason}
                        </Text>
                      </View>
                      <View style={styles.actions}>
                        <View style={styles.actionFlex}>
                          <ActionButton
                            label="Reject"
                            icon="x"
                            variant="secondary"
                            onPress={() => decide(approval.id, 'rejected')}
                          />
                        </View>
                        <View style={styles.actionFlex}>
                          <ActionButton
                            label="Approve record"
                            icon="check"
                            onPress={() => decide(approval.id, 'approved')}
                          />
                        </View>
                      </View>
                    </Surface>
                  );
                })}
              </View>
            ) : activeAssessments.length ? (
              <EmptyState
                icon="check-square"
                title="No pending approvals"
                message="Requests you add for active assessments will appear here for review."
                action={
                  <ActionButton
                    label="Add a request"
                    icon="plus"
                    variant="secondary"
                    onPress={() => setShowSheet(true)}
                  />
                }
              />
            ) : (
              <EmptyState
                icon="shield"
                title="Add an assessment first"
                message="Approval records must be linked to a planned or active assessment."
              />
            )}

            {history.length ? (
              <View style={styles.historySection}>
                <SectionTitle title="Decision history" />
                <View style={styles.list}>
                  {history.map((approval) => (
                    <Surface key={approval.id} style={styles.historyCard}>
                      <View style={styles.historyCopy}>
                        <Text
                          numberOfLines={2}
                          style={[styles.historyTitle, { color: colors.foreground }]}
                        >
                          {approval.action}
                        </Text>
                        <Text
                          style={[
                            styles.historySubtitle,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          {assessments.find(
                            (item) => item.id === approval.assessmentId,
                          )?.title ?? 'Assessment unavailable'}
                        </Text>
                      </View>
                      <StatusPill
                        label={approval.status === 'approved' ? 'Approved' : 'Rejected'}
                        tone={approval.status === 'approved' ? 'success' : 'danger'}
                      />
                    </Surface>
                  ))}
                </View>
              </View>
            ) : null}

            {activeAssessments.length ? (
              <ActionButton
                label="New approval request"
                icon="plus"
                variant="secondary"
                onPress={() => setShowSheet(true)}
              />
            ) : null}
          </>
        )}
      </AppScreen>
      <ApprovalSheet
        visible={showSheet}
        assessments={activeAssessments}
        onClose={() => setShowSheet(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  list: { gap: 11 },
  count: { fontSize: 13, fontWeight: '700' },
  approvalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  action: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  assessmentName: { fontSize: 12, fontWeight: '700' },
  detail: { borderTopWidth: 1, paddingTop: 11, gap: 6 },
  label: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  detailText: { fontSize: 13, lineHeight: 19, marginBottom: 5 },
  actions: { flexDirection: 'row', gap: 9 },
  actionFlex: { flex: 1 },
  historySection: { gap: 12, marginTop: 3 },
  historyCard: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  historyCopy: { flex: 1, gap: 4 },
  historyTitle: { fontSize: 13, fontWeight: '700' },
  historySubtitle: { fontSize: 11 },
});
