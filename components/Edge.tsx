import { type Edge as Kind } from '../db.ts'

// An edge is already a sentence — the type verb renders verbatim.
export let Edge = ({ type, to }: { type: Kind; to: string }) => (
  <span class='Edge'>{type} {to}</span>
)
