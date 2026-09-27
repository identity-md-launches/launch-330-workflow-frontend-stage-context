import { useEffect, useState } from 'react';
import { createAppContext, type AppContext } from '../chain';
import { loadDeployment } from '../deployment';
import { describeError } from '../format';

export type DeploymentState =
  | { status: 'loading' }
  | { status: 'ready'; ctx: AppContext }
  | { status: 'error'; message: string };

/** Loads imd-deployment.json and the ABIs it references once per page load. */
export function useDeployment(): DeploymentState {
  const [state, setState] = useState<DeploymentState>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    loadDeployment()
      .then((deployment) => {
        if (!cancelled) setState({ status: 'ready', ctx: createAppContext(deployment) });
      })
      .catch((error) => {
        if (!cancelled) setState({ status: 'error', message: describeError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
