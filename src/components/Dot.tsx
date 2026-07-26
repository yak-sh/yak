import { el } from './ui.tsx'

let Pip = el('span', 'Dot')

// A status pip: a glyph in a disc. The colour rides `--dot`; the SHAPE
// says the state — ring open, half-moon wip, a drawn check or ✕ once it
// settles. `live` says someone is on the work RIGHT NOW (live.ts
// crewed: the claim's session is awake) — the wip pip fills and
// breathes instead of sitting half; liveness is a FACT about the claim,
// as gated (open `requires` deps, burns red whatever the status says)
// is a fact about the edges — neither is a status anyone maintains.
// The pip is paint; everything else (a click, a title, a class) flows
// through — whether it's also a CONTROL is the host's business.
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
    <Pip
      mod={gated ? 'gated' : wipLive ? ['wip', 'live'] : status}
      title={gated ? 'blocked' : wipLive ? 'wip · live' : status}
      {...rest}
    />
  )
}
