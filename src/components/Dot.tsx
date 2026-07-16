import { el } from './ui.tsx'

let Pip = el('span', 'Dot')

// A status pip. The colour rides the modifier (`Dot-wip`, …), which just
// re-points the `--dot` custom property — structure stays put.
export let Dot = ({ status }: { status: string }) => <Pip mod={status} />
