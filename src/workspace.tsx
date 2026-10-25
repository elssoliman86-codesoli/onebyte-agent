import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export type AssessmentStatus = 'planned' | 'active' | 'completed';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';
export type FindingStatus = 'open' | 'reviewing' | 'resolved';

export interface Assessment {
  id: string;
  title: string;
  target: string;
  scope: string;
  authorization: string;
  notes: string;
  status: AssessmentStatus;
  createdAt: string;
}

export interface Approval {
  id: string;
  assessmentId: string;
  action: string;
  scope: string;
  reason: string;
  status: ApprovalStatus;
  createdAt: string;
  decidedAt?: string;
}

export interface Finding {
  id: string;
  assessmentId: string;
  title: string;
  severity: FindingSeverity;
  location: string;
  details: string;
  status: FindingStatus;
  createdAt: string;
}

interface WorkspaceData {
  assessments: Assessment[];
  approvals: Approval[];
  findings: Finding[];
}

interface AssessmentInput {
  title: string;
  target: string;
  scope: string;
  authorization: string;
  notes: string;
}

interface ApprovalInput {
  assessmentId: string;
  action: string;
  scope: string;
  reason: string;
}

interface FindingInput {
  assessmentId: string;
  title: string;
  severity: FindingSeverity;
  location: string;
  details: string;
}

interface WorkspaceContextValue extends WorkspaceData {
  loading: boolean;
  storageError: string | null;
  retryLoad: () => Promise<void>;
  createAssessment: (input: AssessmentInput) => Promise<void>;
  updateAssessmentStatus: (
    id: string,
    status: AssessmentStatus,
  ) => Promise<void>;
  deleteAssessment: (id: string) => Promise<void>;
  createApproval: (input: ApprovalInput) => Promise<void>;
  decideApproval: (
    id: string,
    status: Exclude<ApprovalStatus, 'pending'>,
  ) => Promise<void>;
  createFinding: (input: FindingInput) => Promise<void>;
  updateFindingStatus: (id: string, status: FindingStatus) => Promise<void>;
  deleteFinding: (id: string) => Promise<void>;
  clearWorkspace: () => Promise<void>;
}

const STORAGE_KEY = '@onebyte-agent/workspace-v1';
const EMPTY_DATA: WorkspaceData = {
  assessments: [],
  approvals: [],
  findings: [],
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readWorkspaceData(value: unknown): WorkspaceData {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('assessments' in value) ||
    !('approvals' in value) ||
    !('findings' in value) ||
    !Array.isArray(value.assessments) ||
    !Array.isArray(value.approvals) ||
    !Array.isArray(value.findings)
  ) {
    throw new Error('Saved workspace data is not in a recognized format.');
  }

  return value as WorkspaceData;
}

export function WorkspaceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [data, setData] = useState<WorkspaceData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [storageError, setStorageError] = useState<string | null>(null);
  const dataRef = useRef<WorkspaceData>(EMPTY_DATA);
  const dataReadyRef = useRef(false);

  const retryLoad = useCallback(async () => {
    setLoading(true);
    try {
      const serialized = await AsyncStorage.getItem(STORAGE_KEY);
      const loaded = serialized
        ? readWorkspaceData(JSON.parse(serialized) as unknown)
        : EMPTY_DATA;
      dataRef.current = loaded;
      dataReadyRef.current = true;
      setData(loaded);
      setStorageError(null);
    } catch {
      dataReadyRef.current = false;
      setStorageError(
        'Saved data could not be read. Retry before changing this workspace.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void retryLoad();
  }, [retryLoad]);

  const persist = useCallback(async (next: WorkspaceData) => {
    if (!dataReadyRef.current) {
      throw new Error('Wait for saved workspace data to load before making changes.');
    }
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      dataRef.current = next;
      setData(next);
      setStorageError(null);
    } catch {
      const message = 'This change was not saved. Check device storage and try again.';
      setStorageError(message);
      throw new Error(message);
    }
  }, []);

  const createAssessment = useCallback(
    async (input: AssessmentInput) => {
      const assessment: Assessment = {
        ...input,
        id: makeId('assessment'),
        status: 'planned',
        createdAt: new Date().toISOString(),
      };
      const current = dataRef.current;
      await persist({
        ...current,
        assessments: [assessment, ...current.assessments],
      });
    },
    [persist],
  );

  const updateAssessmentStatus = useCallback(
    async (id: string, status: AssessmentStatus) => {
      const current = dataRef.current;
      const assessment = current.assessments.find((item) => item.id === id);
      if (!assessment) throw new Error('Assessment no longer exists.');
      const validTransition =
        assessment.status === 'planned'
          ? status === 'planned' || status === 'active'
          : assessment.status === 'active'
            ? status === 'active' || status === 'completed'
            : status === 'completed';
      if (!validTransition) {
        throw new Error('Assessment status cannot move backwards.');
      }
      await persist({
        ...current,
        assessments: current.assessments.map((item) =>
          item.id === id ? { ...item, status } : item,
        ),
      });
    },
    [persist],
  );

  const deleteAssessment = useCallback(
    async (id: string) => {
      const current = dataRef.current;
      await persist({
        assessments: current.assessments.filter((item) => item.id !== id),
        approvals: current.approvals.filter(
          (item) => item.assessmentId !== id,
        ),
        findings: current.findings.filter((item) => item.assessmentId !== id),
      });
    },
    [persist],
  );

  const createApproval = useCallback(
    async (input: ApprovalInput) => {
      const current = dataRef.current;
      const assessment = current.assessments.find(
        (item) => item.id === input.assessmentId,
      );
      if (!assessment || assessment.status === 'completed') {
        throw new Error('Choose an active or planned assessment.');
      }
      const approval: Approval = {
        ...input,
        id: makeId('approval'),
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      await persist({
        ...current,
        approvals: [approval, ...current.approvals],
      });
    },
    [persist],
  );

  const decideApproval = useCallback(
    async (id: string, status: Exclude<ApprovalStatus, 'pending'>) => {
      const current = dataRef.current;
      const approval = current.approvals.find((item) => item.id === id);
      if (!approval) throw new Error('Approval request no longer exists.');
      if (approval.status !== 'pending') {
        throw new Error('This approval has already been decided.');
      }
      await persist({
        ...current,
        approvals: current.approvals.map((item) =>
          item.id === id
            ? { ...item, status, decidedAt: new Date().toISOString() }
            : item,
        ),
      });
    },
    [persist],
  );

  const createFinding = useCallback(
    async (input: FindingInput) => {
      const current = dataRef.current;
      const assessment = current.assessments.find(
        (item) => item.id === input.assessmentId,
      );
      if (!assessment) throw new Error('Choose an existing assessment.');
      const finding: Finding = {
        ...input,
        id: makeId('finding'),
        status: 'open',
        createdAt: new Date().toISOString(),
      };
      await persist({
        ...current,
        findings: [finding, ...current.findings],
      });
    },
    [persist],
  );

  const updateFindingStatus = useCallback(
    async (id: string, status: FindingStatus) => {
      const current = dataRef.current;
      await persist({
        ...current,
        findings: current.findings.map((item) =>
          item.id === id ? { ...item, status } : item,
        ),
      });
    },
    [persist],
  );

  const deleteFinding = useCallback(
    async (id: string) => {
      const current = dataRef.current;
      await persist({
        ...current,
        findings: current.findings.filter((item) => item.id !== id),
      });
    },
    [persist],
  );

  const clearWorkspace = useCallback(async () => {
    await persist(EMPTY_DATA);
  }, [persist]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      ...data,
      loading,
      storageError,
      retryLoad,
      createAssessment,
      updateAssessmentStatus,
      deleteAssessment,
      createApproval,
      decideApproval,
      createFinding,
      updateFindingStatus,
      deleteFinding,
      clearWorkspace,
    }),
    [
      data,
      loading,
      storageError,
      retryLoad,
      createAssessment,
      updateAssessmentStatus,
      deleteAssessment,
      createApproval,
      decideApproval,
      createFinding,
      updateFindingStatus,
      deleteFinding,
      clearWorkspace,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used inside WorkspaceProvider.');
  }
  return context;
}
