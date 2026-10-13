// The directory's calendar job tag, shared by its domain facets.
import type { VocabDoc } from '@yaks/vocab'
export let sweepDoc: VocabDoc = {
  $defs: {
    sweep: {
      component: true,
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['git', 'kills', 'meter', 'trash', 'wrap'],
        },
        began: {
          type: 'string',
          format: 'date-time',
          stamped: true,
          description: 'when the run under way began; null once it ends',
        },
        since: {
          type: 'string',
          format: 'date-time',
          stamped: true,
          description:
            'when the first of the runs that died unfinished in a row began; ' +
            'null once one ends',
        },
        through: {
          type: 'string',
          format: 'date-time',
          stamped: true,
          description:
            'how far the last run that finished read; the next reads on ' +
            'from there',
        },
      },
    },
  },
}
