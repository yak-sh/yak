// Query-backed inspector views are loaded by the host that adapts them.
// A portable printer loads this facet without importing any inspector page.
import type { View } from './host.ts'

export let inspectViews = (): Promise<View[]> =>
  import('./registry.ts').then((m) => m.all)
