import { el } from './ui.tsx'

let Pip = el('span', 'Dot')

// A status pip. The colour rides the modifier (`Dot-wip`, …), which just
// re-points the `--dot` custom property — structure stays put. A gated
// entity (open `requires` deps) burns red whatever its status says:
// blocked is a FACT about the edges, not a status anyone maintains.
export let Dot = (
  { status, gated }: { status: string; gated?: boolean },
) => <Pip mod={gated ? 'gated' : status} title={gated ? 'blocked' : status} />
