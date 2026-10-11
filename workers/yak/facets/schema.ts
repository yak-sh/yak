// Scalar and ownership shapes shared by the Worker's vocabulary facets.
import type { PropSchema } from '@yaks/vocab'
export let ref = (death: string): PropSchema => ({
  type: 'string',
  ref: 'entity',
  death,
})
export let text: PropSchema = { type: 'string' }
export let num: PropSchema = { type: 'number' }
export let bool: PropSchema = { type: 'boolean' }
export let time: PropSchema = { type: 'string', format: 'date-time' }
export let owned = (s: PropSchema): PropSchema => ({ ...s, stamped: true })
export let unique = (s: PropSchema): PropSchema => ({ ...s, unique: true })
