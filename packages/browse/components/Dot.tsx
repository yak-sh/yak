import * as ui from '@yaks/ui'

// How each state wears the pip (@yaks/ui Dot): a shape saying where it is and a
// tone. Task statuses first — ring open, half-moon wip, a check done, a cross
// cancelled — then the other lifecycles that borrow the pip: a session's (a
// ring while starting, the pulse while going, a glyph for how it ended), a
// wake's and an inbox row's. A state not named here is the plain dim disc.
let looks: Record<string, string[]> = {
  open: ['ring', 'info'],
  wip: ['half', 'active'],
  done: ['check', 'positive'],
  cancelled: ['cross'], // settled, but not a success: stays dim
  unread: ['accent'],
  idle: ['half', 'active'],
  settled: ['half', 'active'],
  pending: ['half', 'active'],
  running: ['pulse', 'active'],
  completed: ['check', 'positive'],
  failed: ['cross', 'negative'],
  interrupted: ['cross', 'caution'],
  stopped: ['cross', 'caution'],
  lost: ['dashed', 'special'],
}

// A status pip. `live` says someone is on the work right now (live.ts crewed:
// the claim's session is awake), so the wip pip fills and breathes instead of
// sitting half; `gated` (the `blocked` facet: stuck on an external reason,
// D-17094) burns red whatever the status says. Both are facts about the
// entity, not statuses anyone maintains. Open `requires` deps are not gated:
// they are normal work, the calm deps tally (live.ts openDeps), never the
// alarm. The pip is paint; a click, a title or a class flows through.
export let Dot = (
  { status, gated, live, ...rest }: {
    status: string
    gated?: boolean
    live?: boolean
    [x: string]: unknown
  },
) => {
  let wipLive = live && status == 'wip' && !gated
  return (
    <ui.Dot
      mod={gated
        ? ['alert', 'negative']
        : wipLive
        ? ['pulse', 'active']
        : looks[status]}
      title={gated ? 'blocked' : wipLive ? 'wip · live' : status}
      {...rest}
    />
  )
}
