// Entity suggestions speak the same human id + title vocabulary wherever a
// picker appears. Exact ids lead so Enter means the id the operator typed.
import { type Ent, idOf } from '../types.ts'

export let label = (e: Ent) => `${idOf(e)} — ${e.doc?.title || e.kind}`

export let match = (q: string, e: Ent) =>
  !q || label(e).toLowerCase().includes(q.toLowerCase())

export let order = (q: string) => (a: Ent, b: Ent) => {
  let sought = q.toLowerCase()
  let exact = (e: Ent) => +(idOf(e).toLowerCase() == sought)
  return exact(b) - exact(a) || b.num - a.num
}
