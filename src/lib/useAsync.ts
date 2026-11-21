import { useCallback, useEffect, useState } from 'react'

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'ready'; data: T }

/** Runs `load` on mount and whenever `deps` change. `reload` runs it again. */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' })
  const [tick, setTick] = useState(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps)

  useEffect(() => {
    let alive = true
    setState((s) => (s.status === 'ready' ? s : { status: 'loading' }))
    run().then(
      (data) => alive && setState({ status: 'ready', data }),
      (error: unknown) =>
        alive && setState({ status: 'error', error: error instanceof Error ? error : new Error(String(error)) }),
    )
    return () => {
      alive = false
    }
  }, [run, tick])

  return [state, () => setTick((t) => t + 1)] as const
}
