// How a task's state reads, in every interface: one word, its status. A
// portable @yaks/render renderer, so a terminal prints the word (@yaks/text)
// and a browser styles it by its class (@yaks/preact).
//
// The status is computed, never stored (./status.ts). A read carries the value
// its store derived, and `statusOf` falls back to it where the bundle lacks the
// marks, so a task read as `.task` alone still says done. A bundle built by
// hand may carry neither, which is why this matches the component rather than
// a status.

import { parse } from '@yaks/query'
import { define, type Registry } from '@yaks/render'
import { TASK } from './comp.ts'
import { statusOf } from './status.ts'

/** `Status` for a task: `open`, `done` or `cancelled`. */
export let views: Registry = define([
  {
    view: 'Status',
    match: parse(`.${TASK}`),
    render: (b, h) => {
      let status = statusOf(b)
      return h('span', { class: `Status Status-${status}` }, status)
    },
  },
])
