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
            'when the first of the runs in a row that died unfinished, or ' +
            'that Cloudflare could not answer, began; null once one finishes',
        },
        reported: {
          type: 'string',
          format: 'date-time',
          stamped: true,
          description:
            'when the runs since `since` that Cloudflare could not answer ' +
            'were reported as an outage, once; null once one finishes',
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
