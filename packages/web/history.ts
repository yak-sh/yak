// Browser history owns address changes and the state restored by back,
// forward and reload. Apps receive a port, never a browser History object.
import type { HistoryPort } from '@yaks/ui/history'
export let browserHistory = (
  window: Pick<
    Window,
    'history' | 'location' | 'addEventListener' | 'removeEventListener'
  > = globalThis.window,
): HistoryPort => ({
  read: () => ({
    path: window.location.pathname + window.location.search +
      window.location.hash,
    state: window.history.state,
  }),
  write: ({ path, state }, replace = false) => {
    window.history[replace ? 'replaceState' : 'pushState'](state, '', path)
  },
  listen: (fn) => {
    let pop = () =>
      fn({
        path: window.location.pathname + window.location.search +
          window.location.hash,
        state: window.history.state,
      })
    window.addEventListener('popstate', pop)
    return () => window.removeEventListener('popstate', pop)
  },
  back: () => window.history.back(),
  forward: () => window.history.forward(),
})
