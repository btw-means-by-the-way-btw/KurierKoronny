import { useShallow } from 'zustand/react/shallow';

import { selectNetworkStatus, useMeshStore } from '../store/meshStore';

export function useNetworkStatus() {
  return useMeshStore(
    useShallow((s) => ({
      status: selectNetworkStatus(s),
      linkCount: s.links.length,
      nodeCount: s.nodes.length,
      radio: s.radio,
    }))
  );
}
