// How a process reads, in every interface: as the command it runs, the words a
// person typed to start it — `yak task new Buy the cake` — rather than its id.
// Its options stop the name: `yak serve --share --ready /run/…` reads as
// `yak serve`, and the whole line rides the tooltip. A process is what signs
// the writes it makes (./self.ts), so this is the name a write's author reads
// as wherever one is named. A portable @yaks/render renderer, so a terminal
// prints it and a browser mounts it.

import { parse } from '@yaks/query/core'
import { define, type Registry } from '@yaks/render'
import { PROCESS } from './comp.ts'

/** A command's words before its first option. */
export let named = (command: string): string => {
  let words = command.split(' ')
  let first = words.findIndex((w, i) => i > 0 && w.startsWith('-'))
  return (first < 0 ? words : words.slice(0, first)).join(' ')
}

/** `Title` for a process that knows its command. */
export let views: Registry = define([
  {
    view: 'Title',
    match: parse(`.${PROCESS}.command`),
    render: (b, h) => {
      let command = String((b[PROCESS] as { command: string }).command)
      return h('span', { title: command }, named(command))
    },
  },
])
