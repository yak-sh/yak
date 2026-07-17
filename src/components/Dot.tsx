import { el } from './ui.tsx'

let Pip = el('span', 'Dot')

// A status pip. The colour rides the modifier (`Dot-wip`, …), which just
// re-points the `--dot` custom property — structure stays put. A gated
// entity (open `requires` deps) burns red whatever its status says:
// blocked is a FACT about the edges, not a status anyone maintains.
// The pip is paint; everything else (a click, a title, a class) flows
// through — whether it's also a CONTROL is the host's business.
export let Dot = (
  { status, gated, ...rest }: {
    status: string
    gated?: boolean
    [x: string]: unknown
  },
) => (
  <Pip
    mod={gated ? 'gated' : status}
    title={gated ? 'blocked' : status}
    {...rest}
  />
)
