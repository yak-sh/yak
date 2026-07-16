import { type Edge as Kind } from '../db.ts'

// How each edge reads from the parent's side: it depends on its children.
let label = {
  blocks: 'blocked by',
  contains: 'contains',
  informs: 'informed by',
}

// A dependency tag: "<relation> <child title>".
export let Edge = ({ type, to }: { type: Kind; to: string }) => (
  <span class='Edge'>{label[type]} {to}</span>
)
