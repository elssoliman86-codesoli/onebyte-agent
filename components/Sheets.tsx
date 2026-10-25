import React, { useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import {
  type Assessment,
  type FindingSeverity,
  useWorkspace,
} from '@/src/workspace';
import { ActionButton, ChoiceRow, FormField } from './Ui';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';

function SheetFrame({
  visible,
  title,
  description,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  description: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheetPosition}>
          <View
            style={[
              styles.sheet,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.handleWrap}>
              <View style={[styles.handle, { backgroundColor: colors.border }]} />
            </View>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetTitleCopy}>
                <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
                  {title}
                </Text>
                <Text
                  style={[
                    styles.sheetDescription,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {description}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close form"
                onPress={onClose}
                style={styles.close}
              >
                <Text style={[styles.closeText, { color: colors.mutedForeground }]}>
                  ×
                </Text>
              </Pressable>
            </View>
            {children}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function FormError({ message }: { message: string }) {
  const colors = useColors();
  if (!message) return null;
  return (
    <Text style={[styles.formError, { color: colors.destructive }]}>{message}</Text>
  );
}

export function AssessmentSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const colors = useColors();
  const { createAssessment } = useWorkspace();
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('');
  const [scope, setScope] = useState('');
  const [authorization, setAuthorization] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const close = () => {
    setTitle('');
    setTarget('');
    setScope('');
    setAuthorization('');
    setNotes('');
    setError('');
    onClose();
  };

  const submit = async () => {
    if (!title.trim() || !target.trim() || !scope.trim() || !authorization.trim()) {
      setError('Add a name, target, explicit scope, and authorization reference.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await createAssessment({
        title: title.trim(),
        target: target.trim(),
        scope: scope.trim(),
        authorization: authorization.trim(),
        notes: notes.trim(),
      });
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save assessment.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SheetFrame
      visible={visible}
      onClose={close}
      title="New assessment"
      description="Record a test only after written authorization is confirmed."
    >
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={styles.form}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <FormField
          label="Assessment name"
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Q4 web application review"
          testID="assessment-name"
        />
        <FormField
          label="Primary target"
          value={target}
          onChangeText={setTarget}
          placeholder="example.com"
          autoCapitalize="none"
          autoCorrect={false}
          testID="assessment-target"
        />
        <FormField
          label="Authorized scope"
          value={scope}
          onChangeText={setScope}
          placeholder="Exact domains, apps, and exclusions"
          hint="Keep this specific. This app records scope; it does not contact the target."
          multiline
          testID="assessment-scope"
        />
        <FormField
          label="Authorization reference"
          value={authorization}
          onChangeText={setAuthorization}
          placeholder="Ticket, contract, or approval reference"
          testID="assessment-authorization"
        />
        <FormField
          label="Notes"
          value={notes}
          onChangeText={setNotes}
          placeholder="Optional context"
          multiline
        />
        <FormError message={error} />
        <ActionButton
          label={saving ? 'Saving…' : 'Create assessment'}
          icon="shield"
          onPress={() => void submit()}
          disabled={saving}
          testID="save-assessment"
        />
        <Text style={[styles.footerNote, { color: colors.mutedForeground }]}>
          Your record stays on this device in this build.
        </Text>
      </KeyboardAwareScrollViewCompat>
    </SheetFrame>
  );
}

export function ApprovalSheet({
  visible,
  assessments,
  onClose,
}: {
  visible: boolean;
  assessments: Assessment[];
  onClose: () => void;
}) {
  const colors = useColors();
  const { createApproval } = useWorkspace();
  const [assessmentId, setAssessmentId] = useState(assessments[0]?.id ?? '');
  const [action, setAction] = useState('');
  const [scope, setScope] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const close = () => {
    setAction('');
    setScope('');
    setReason('');
    setError('');
    onClose();
  };

  const submit = async () => {
    if (!assessmentId || !action.trim() || !scope.trim() || !reason.trim()) {
      setError('Choose an assessment and describe the exact action, scope, and reason.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await createApproval({
        assessmentId,
        action: action.trim(),
        scope: scope.trim(),
        reason: reason.trim(),
      });
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save approval.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SheetFrame
      visible={visible}
      onClose={close}
      title="Request approval"
      description="Document one specific action. Approval is not authorization to run it."
    >
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={styles.form}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ChoiceRow
          label="Assessment"
          options={assessments.map((assessment) => ({
            value: assessment.id,
            label: assessment.title,
          }))}
          value={assessmentId}
          onChange={setAssessmentId}
        />
        <FormField
          label="Exact action"
          value={action}
          onChangeText={setAction}
          placeholder="Describe the proposed action"
        />
        <FormField
          label="Action scope"
          value={scope}
          onChangeText={setScope}
          placeholder="Target and boundaries for this action"
          multiline
        />
        <FormField
          label="Reason"
          value={reason}
          onChangeText={setReason}
          placeholder="Why is this action needed?"
          multiline
        />
        <FormError message={error} />
        <ActionButton
          label={saving ? 'Saving…' : 'Add approval request'}
          icon="check-square"
          onPress={() => void submit()}
          disabled={saving}
          testID="save-approval"
        />
        <Text style={[styles.footerNote, { color: colors.mutedForeground }]}>
          This creates a record only. No tool or target is contacted.
        </Text>
      </KeyboardAwareScrollViewCompat>
    </SheetFrame>
  );
}

export function FindingSheet({
  visible,
  assessments,
  onClose,
}: {
  visible: boolean;
  assessments: Assessment[];
  onClose: () => void;
}) {
  const { createFinding } = useWorkspace();
  const [assessmentId, setAssessmentId] = useState(assessments[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<FindingSeverity>('medium');
  const [location, setLocation] = useState('');
  const [details, setDetails] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const close = () => {
    setTitle('');
    setLocation('');
    setDetails('');
    setError('');
    onClose();
  };

  const submit = async () => {
    if (!assessmentId || !title.trim() || !details.trim()) {
      setError('Choose an assessment, add a title, and describe the finding.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await createFinding({
        assessmentId,
        title: title.trim(),
        severity,
        location: location.trim(),
        details: details.trim(),
      });
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save finding.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SheetFrame
      visible={visible}
      onClose={close}
      title="Document a finding"
      description="Save a note from an authorized review. Do not include secrets."
    >
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={styles.form}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ChoiceRow
          label="Assessment"
          options={assessments.map((assessment) => ({
            value: assessment.id,
            label: assessment.title,
          }))}
          value={assessmentId}
          onChange={setAssessmentId}
        />
        <FormField
          label="Finding title"
          value={title}
          onChangeText={setTitle}
          placeholder="Short, clear summary"
        />
        <ChoiceRow<FindingSeverity>
          label="Severity"
          options={[
            { value: 'critical', label: 'Critical' },
            { value: 'high', label: 'High' },
            { value: 'medium', label: 'Medium' },
            { value: 'low', label: 'Low' },
          ]}
          value={severity}
          onChange={setSeverity}
        />
        <FormField
          label="Affected area"
          value={location}
          onChangeText={setLocation}
          placeholder="Page, feature, or component"
        />
        <FormField
          label="Details"
          value={details}
          onChangeText={setDetails}
          placeholder="Observation and recommended next step"
          multiline
        />
        <FormError message={error} />
        <ActionButton
          label={saving ? 'Saving…' : 'Save finding'}
          icon="file-plus"
          onPress={() => void submit()}
          disabled={saving}
          testID="save-finding"
        />
      </KeyboardAwareScrollViewCompat>
    </SheetFrame>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.56)',
  },
  sheetPosition: { width: '100%' },
  sheet: {
    maxHeight: '92%',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    paddingBottom: Platform.OS === 'web' ? 34 : 20,
  },
  handleWrap: { alignItems: 'center', paddingTop: 11, paddingBottom: 14 },
  handle: { width: 42, height: 4, borderRadius: 5 },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingBottom: 17,
    gap: 12,
  },
  sheetTitleCopy: { flex: 1, gap: 5 },
  sheetTitle: { fontSize: 23, lineHeight: 29, fontWeight: '700' },
  sheetDescription: { fontSize: 13, lineHeight: 18 },
  close: { padding: 2, width: 32, height: 32, alignItems: 'center' },
  closeText: { fontSize: 28, lineHeight: 28 },
  form: { paddingHorizontal: 20, paddingBottom: 15, gap: 15 },
  formError: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  footerNote: { fontSize: 12, lineHeight: 17, textAlign: 'center' },
});
