import type { ToastIntent } from '@fluentui/react-components';

export interface NotifyOptions {
  title: string;
  body?: string;
  intent?: ToastIntent;
  undo?: () => void;
  timeout?: number;
}
