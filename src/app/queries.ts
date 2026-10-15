import { QueryClient, useQuery } from '@tanstack/react-query';
import { api } from '../shared/api/client';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false },
  },
});

export const useOverview = () => useQuery({ queryKey: ['overview'], queryFn: () => api.overview() });
export const useColumns = () => useQuery({ queryKey: ['columns'], queryFn: () => api.columns() });
export const useReview = () => useQuery({ queryKey: ['review'], queryFn: () => api.reviewQueue() });
export const usePolicy = () => useQuery({ queryKey: ['policy'], queryFn: () => api.policy() });
export const useAudit = () => useQuery({ queryKey: ['audit'], queryFn: () => api.audit() });
export const usePerformance = () => useQuery({ queryKey: ['performance'], queryFn: () => api.performance() });
export const useAnomalies = () => useQuery({ queryKey: ['anomalies'], queryFn: () => api.anomalies() });
export const useVerification = () =>
  useQuery({ queryKey: ['verification'], queryFn: () => api.verification() });
export const useBackends = () => useQuery({ queryKey: ['backends'], queryFn: () => api.backends() });
export const usePrincipals = () => useQuery({ queryKey: ['principals'], queryFn: () => api.principals() });
