import { type Ent } from '../../types.ts'
import { el } from '../ui.tsx'

let Pre = el('pre', 'Json')

// Any entity as raw JSON — the debugging floor; matches everything.
export let Json = ({ e }: { e: Ent }) => <Pre>{JSON.stringify(e, null, 2)}</Pre>
