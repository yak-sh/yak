// How a task's state reads, in every interface: one word, the status its
// marks give it. A portable @yaks/render renderer, so a terminal prints the
// word (@yaks/text) and a browser styles it by its class (@yaks/preact).
//
// The status is computed, never stored (./status.ts), so the view computes it
// too, from the marks the bundle carries: a bundle a browser holds has no
// status property to read, and a matcher that has only the bundle cannot test
// one, which is why this matches the component rather than a status.

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
