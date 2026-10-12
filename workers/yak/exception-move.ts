// Legacy exception reports leave app graphs; transcript answers stay in place.
// Retired fields are available only to the mover, then their columns contract.
import { legacyException } from '@yaks/tracker'
import type { Comp } from '@yaks/graph'
import type { Rule } from './mover.ts'

let text = { type: 'string' as const, stamped: true }
export let exceptionSource = {
  $defs: {
    exception: {
      component: true,
      extends: true,
      type: 'object' as const,
      properties: {
        at: { ...text, format: 'date-time' },
        message: text,
        stack: text,
        request: text,
        request_id: text,
        requestId: text,
        version: { type: 'number' as const, stamped: true },
      },
    },
  },
}

export let exceptionRule: Rule = {
  mark: 'yak/store/exception/1',
  core: ['exception'],
  find: '.exception&*',
  source: exceptionSource,
  move: (row) => [legacyException(row).patch],
  forward: (row, _read, context) =>
    legacyException(row).records.map((record) => ({
      ...record,
      error: {
        ...record.error as Comp,
        tags: {
          ...(record.error as Comp).tags as object,
          store: context?.store,
        },
      },
      during: {
        ...record.during as Comp,
        ...context?.app ? { app: context.app } : {},
        ...context?.space ? { space: context.space } : {},
      },
    })),
  drop: Object.keys(exceptionSource.$defs.exception.properties).map((prop) =>
    `exception.${prop}`
  ),
}
