// Heal contributes its domain control to the Sessions page's shared registry.
import type { View } from '@yaks/inspect'

export let inspectViews = (): Promise<View[]> =>
  import('./control.tsx').then(({ Controls }) => [{
    view: 'Sessions.Controls',
    match: true,
    Render: Controls,
  }])
