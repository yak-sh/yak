// Each interface's turn in the doors band: the browser, an agent over MCP and
// a terminal each make one change to the tab's graph, once, in order, after
// the story's steps, and what each printed and changed is kept for its window.
import type { Yak } from './yak.ts'
import type { Term } from './term.ts'
import type { Figure } from './figure.ts'
import { type Beat, called } from './site.ts'

/** What a turn did: what its window printed, and the entity it changed. */
export type Done = { out: string[]; fault: boolean; eid?: string }

export type Turns = ReturnType<typeof turns>

export let turns = (yak: Yak, term: Term, figure: Figure) => {
  let done: Done[] = []
  let ran = 0
  let chain = Promise.resolve()
  let listeners = new Set<() => void>()
  let told = () => listeners.forEach((l) => l())
  // A beat through the door its block names: typed in a terminal, called by
  // the agent, or called by a page in the browser.
  let run = (b: Beat) => {
    if (b.kind == 'sh') return yak.run(b.line)
    let { tool, args } = called(b.line)
    return b.kind == 'mcp' ? yak.ask(tool, args) : yak.call(tool, args)
  }
  return {
    /** Run every beat up to `n` (counting from 1) that has not run. */
    reach: (beats: Beat[], n: number) => {
      while (ran < Math.min(n, beats.length)) {
        let i = ran++
        chain = chain.then(() => term.idle()).then(async () => {
          let { code, out } = await run(beats[i])
          await yak.settled()
          done[i] = { out, fault: code != 0, eid: figure.last().eid }
          told()
        })
      }
      return chain
    },
    /** What beat `i` did, once it has run. */
    done: (i: number): Done | undefined => done[i],
    listen: (l: () => void) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    /** Settles once every beat reached has run. */
    idle: () => chain,
  }
}
