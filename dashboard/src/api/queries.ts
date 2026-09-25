import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type {
  Alert,
  Channel,
  Dispatch,
  DispatchStatus,
  FleetNode,
  Notification,
  Reading,
  Recommendations,
  RegionMode,
  SimulatorState,
  SystemInfo,
  Team,
} from './types'

// Live data polls fast enough that a storm simulation reads as real time.
const LIVE = 2000

export const keys = {
  fleet: ['fleet'] as const,
  openAlerts: ['alerts', 'open'] as const,
  alertLog: ['alerts', 'log'] as const,
  teams: ['teams'] as const,
  dispatches: ['dispatches'] as const,
  notifications: ['notifications'] as const,
  regions: ['regions'] as const,
  system: ['system'] as const,
  simulator: ['simulator'] as const,
  history: (id: string) => ['history', id] as const,
  recommendations: (id: string) => ['recommendations', id] as const,
}

export const useFleet = () =>
  useQuery({ queryKey: keys.fleet, queryFn: () => api.get<FleetNode[]>('/fleet'), refetchInterval: LIVE })

export const useOpenAlerts = () =>
  useQuery({
    queryKey: keys.openAlerts,
    queryFn: () => api.get<Alert[]>('/alerts?unacknowledged_only=true'),
    refetchInterval: LIVE,
  })

export const useAlertLog = () =>
  useQuery({ queryKey: keys.alertLog, queryFn: () => api.get<Alert[]>('/alerts?limit=500'), refetchInterval: 5000 })

export const useTeams = () =>
  useQuery({ queryKey: keys.teams, queryFn: () => api.get<Team[]>('/teams'), refetchInterval: LIVE })

export const useDispatches = () =>
  useQuery({ queryKey: keys.dispatches, queryFn: () => api.get<Dispatch[]>('/dispatches'), refetchInterval: LIVE })

export const useNotifications = () =>
  useQuery({
    queryKey: keys.notifications,
    queryFn: () => api.get<Notification[]>('/notifications?limit=80'),
    refetchInterval: 3000,
  })

export const useRegions = () =>
  useQuery({ queryKey: keys.regions, queryFn: () => api.get<RegionMode[]>('/regions'), refetchInterval: 15000 })

export const useSystem = () =>
  useQuery({ queryKey: keys.system, queryFn: () => api.get<SystemInfo>('/system'), staleTime: Infinity, retry: 1 })

export const useSimulator = () =>
  useQuery({ queryKey: keys.simulator, queryFn: () => api.get<SimulatorState>('/simulator'), refetchInterval: LIVE })

export const useNodeHistory = (nodeId: string | null) =>
  useQuery({
    queryKey: keys.history(nodeId ?? ''),
    queryFn: () => api.get<Reading[]>(`/nodes/${encodeURIComponent(nodeId!)}/history?limit=60`),
    enabled: !!nodeId,
    refetchInterval: LIVE,
    placeholderData: keepPreviousData,
  })

export const useRecommendations = (nodeId: string | null) =>
  useQuery({
    queryKey: keys.recommendations(nodeId ?? ''),
    queryFn: () => api.get<Recommendations>(`/nodes/${encodeURIComponent(nodeId!)}/recommendations`),
    enabled: !!nodeId,
    refetchInterval: 5000,
  })

// ---------------------------------------------------------------- mutations

function useInvalidate() {
  const qc = useQueryClient()
  return (...groups: (readonly string[])[]) =>
    Promise.all(groups.map((queryKey) => qc.invalidateQueries({ queryKey })))
}

export function useCreateDispatch() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (body: { team_id: string; node_id: string; channel: Channel; note?: string }) =>
      api.post<Dispatch>('/dispatches', body),
    onSettled: () => invalidate(keys.dispatches, keys.teams, keys.notifications, ['recommendations']),
  })
}

export function useUpdateDispatch() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: Exclude<DispatchStatus, 'en_route'> }) =>
      api.patch<Dispatch>(`/dispatches/${id}`, { status }),
    onSettled: () => invalidate(keys.dispatches, keys.teams, ['alerts'], keys.fleet, ['recommendations']),
  })
}

export function useAckNode() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (nodeId: string) =>
      api.post<{ acknowledged: number; node_id: string }>('/alerts/ack-node', { node_id: nodeId }),
    onSettled: () => invalidate(['alerts']),
  })
}

export function useNotifyCrews() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (body: { message: string; channel: Channel; team_ids?: string[]; municipality?: string }) =>
      api.post<Notification[]>('/notifications', body),
    onSettled: () => invalidate(keys.notifications),
  })
}

export function useSetCrewDuty() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'available' | 'off_duty' }) =>
      api.patch<Team>(`/teams/${encodeURIComponent(id)}`, { status }),
    onSettled: () => invalidate(keys.teams, ['recommendations']),
  })
}

export function useRunSimulation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (body: { scenario: 'dry' | 'storm'; tick_seconds: number; ticks: number }) =>
      api.post<SimulatorState>('/simulator/run', body),
    onSettled: () => invalidate(keys.simulator),
  })
}

export function useResetDemo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<{ reset: boolean }>('/demo/reset'),
    onSettled: () => qc.invalidateQueries(),
  })
}

export function useSyncWeather() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: () => api.post<unknown>('/weather/sync'),
    onSettled: () => invalidate(keys.regions),
  })
}
