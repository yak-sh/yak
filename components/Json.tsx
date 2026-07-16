import { type Ent } from '../db.ts'

// Any entity through the JSON lens — the debugging floor; matches everything.
export let Json = ({ e }: { e: Ent }) => (
  <pre class='Json'>{JSON.stringify(e, null, 2)}</pre>
)
