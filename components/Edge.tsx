import { type Edge as Kind } from '../db.ts'

// How each edge type reads when drawn from a task out to its target.
let arrow = { blocks: 'blocks', subtask: 'subtask of', informs: 'informs' }

// A dependency tag: "<relation> → <target title>".
export let Edge = ({ type, to }: { type: Kind; to: string }) => (
  <span class='Edge'>{arrow[type]} → {to}</span>
)
