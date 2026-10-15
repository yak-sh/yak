// The directory's meter declarations.
import type { VocabDoc } from '@yaks/vocab'
export let docs: VocabDoc[] = [{
  $defs: {
    account_usage: {
      component: true,
      wire: false,
      type: 'object',
      properties: {
        month: { type: 'string' },
        at: { type: 'string', format: 'date-time' },
        requests: { type: 'number' },
        rows_read: { type: 'number' },
        duration: { type: 'number' },
      },
    },
    account_alert: {
      component: true,
      wire: false,
      type: 'object',
      properties: {
        month: { type: 'string' },
        requests: { type: 'string' },
        rows_read: { type: 'string' },
        duration: { type: 'string' },
        rate: { type: 'string' },
      },
    },
  },
}]
