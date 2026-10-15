import {
  Alert24Regular,
  ClipboardTaskListLtr24Regular,
  Code24Regular,
  DataPie24Regular,
  DocumentEdit24Regular,
  Gauge24Regular,
  History24Regular,
  ScanDash24Regular,
  ShieldCheckmark24Regular,
} from '@fluentui/react-icons';
import type { ReactNode } from 'react';
import type { ViewId } from './router';

export const NAV: { id: ViewId; label: string; icon: ReactNode }[] = [
  { id: 'overview', label: 'Overview', icon: <DataPie24Regular /> },
  { id: 'discovery', label: 'Discovery', icon: <ScanDash24Regular /> },
  { id: 'review', label: 'Review Queue', icon: <ClipboardTaskListLtr24Regular /> },
  { id: 'policy', label: 'Policy Studio', icon: <DocumentEdit24Regular /> },
  { id: 'workbench', label: 'Query Workbench', icon: <Code24Regular /> },
  { id: 'verification', label: 'Verification', icon: <ShieldCheckmark24Regular /> },
  { id: 'audit', label: 'Audit Trail', icon: <History24Regular /> },
  { id: 'performance', label: 'Performance', icon: <Gauge24Regular /> },
  { id: 'anomalies', label: 'Anomalies', icon: <Alert24Regular /> },
];
