import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';

import { isAlertActive, type StoredAlert } from '../services/mesh/alertPolicy';

interface AlertState {
  /** Every stored record, including cancellations and expired alerts still worth relaying. */
  alerts: StoredAlert[];
  /** Alert the banner was folded for (see `alertKey`); a newer alert unfolds it again. */
  collapsedFor: string | null;
  set: (alerts: StoredAlert[]) => void;
  setCollapsedFor: (key: string | null) => void;
}

export const useAlertStore = create<AlertState>((set) => ({
  alerts: [],
  collapsedFor: null,
  set: (alerts) => set({ alerts }),
  setCollapsedFor: (collapsedFor) => set({ collapsedFor }),
}));

export const alertKey = (a: Pick<StoredAlert, 'origin' | 'id'>) => `${a.origin}/${a.id}`;

/** Alerts to display right now, newest first. Re-evaluated periodically so expiry needs no event. */
export function useActiveAlerts(): StoredAlert[] {
  const alerts = useAlertStore((s) => s.alerts);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return useMemo(
    () => alerts.filter((a) => isAlertActive(a, now)).sort((a, b) => b.timestamp - a.timestamp),
    [alerts, now]
  );
}
