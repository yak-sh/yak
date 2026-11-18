// The directory's calendar job tag, shared by its store words.
import type { VocabDoc } from '@yaks/vocab'
export let sweepDoc: VocabDoc = {
  $defs: {
    file_retirement: {
      component: true,
      type: 'object',
      wire: false,
      journal: false,
      description:
        'Unreferenced bucket keys, kept for thirty days after discovery before deletion.',
      properties: {
        keys: { type: 'array', items: { type: 'string' } },
        at: {
          type: 'string',
          format: 'date-time',
          description:
            'When these keys were first observed unreferenced; absent while an erased owner still stands.',
        },
        owner: {
          type: 'string',
          ref: 'entity',
          death: 'keep',
          description:
            'The app, space or visit whose explicit erasure retires these keys.',
        },
      },
    },
    delete_retired_files: {
      effect: true,
      created: ['file_retirement'],
      description:
        'Defer orphaned files for the store restore window, then check references before deleting.',
    },
    release_remake: {
      component: true,
      type: 'object',
      description:
        'a release to make again as itself, compiled by the toolkit serving ' +
        'it now (toolkit.ts), done once by the remake sweep its row wakes',
      properties: {
        app: { type: 'string', description: 'the app' },
        source: {
          type: 'string',
          description:
            'the release it serves that its toolkit has moved on from',
        },
        fence: {
          type: 'string',
          description:
            'the release fence the last run drew, kept before it took it; ' +
            'the next run lifts it if that run died holding it',
        },
      },
    },
    sweep: {
      component: true,
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: [
            'git',
            'kills',
            'meter',
            'refusals',
            'remake',
            'trash',
            'wrap',
          ],
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
