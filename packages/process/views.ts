// How a process reads, in every interface: as the command it runs, the line a
// person typed to start it — `yak task new Buy the cake` — rather than its id.
// A process is what signs the writes it makes (./self.ts), so this is the name
// a write's author reads as wherever one is named. A portable @yaks/render
// renderer, so a terminal prints it and a browser mounts it.

import { parse } from '@yaks/query/core'
import { define, type Registry } from '@yaks/render'
import { PROCESS } from './comp.ts'

/** `Title` for a process that knows its command. */
export let views: Registry = define([
  {
    view: 'Title',
    match: parse(`.${PROCESS}.command`),
    render: (b, h) =>
      h('span', null, String((b[PROCESS] as { command: string }).command)),
  },
])
