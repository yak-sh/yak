// The prompt on the page: what has been typed into the tab's graph and what
// it printed, a line being typed, and the story's steps, each typed in once
// as its section is reached. The visitor types into the same prompt.
import type { Yak } from './yak.ts'
import { scriptOf } from './site.ts'

/** A line the prompt shows: what was typed, what the agent called, or what
 * came back (`fault` when it failed). */
export type Line = { kind: 'in' | 'agent' | 'out' | 'fault'; text: string }

/** Where in the story a line is: its step (or LIVE and on for a visitor's
 * line), and which of that step's commands it is, counting from 0. */
export type At = { stage: number; line: number }

/** How long the prompt waits between typed characters; none in a test. */
export type Pace = { key: number; pause: number }

export type Term = ReturnType<typeof term>

/** The first stage a visitor's own line is drawn in: the story's steps are
 * stages 1 to n, and each line the visitor enters is one after this. */
export const LIVE = 100

export let term = (yak: Yak, pace: Pace = { key: 0, pause: 0 }) => {
  let lines: Line[] = []
  let history: string[] = []
  let typed = (line: string) => {
    if (history.at(-1) != line) history.push(line)
  }
  let typing = ''
  let busy = false
  let listeners = new Set<() => void>()
  let told = () => listeners.forEach((l) => l())
  let wait = (ms: number) =>
    ms ? new Promise((ok) => setTimeout(ok, ms)) : Promise.resolve()
  let chain = Promise.resolve()
  let queue = (work: () => Promise<void>) =>
    chain = chain.then(async () => {
      busy = true
      told()
      try {
        await work()
      } finally {
        busy = false
        told()
      }
    })

  let printed = (code: number, out: string[]) => {
    let kind: Line['kind'] = code ? 'fault' : 'out'
    lines.push(...out.map((text) => ({ kind, text })))
  }
  let submit = async (line: string) => {
    typed(line)
    lines.push({ kind: 'in', text: line })
    told()
    let { code, out } = await yak.run(line)
    printed(code, out)
    await yak.settled()
    told()
  }
  let type = async (line: string) => {
    for (let i = 1; i <= line.length; i++) {
      typing = line.slice(0, i)
      told()
      await wait(pace.key)
    }
    await wait(pace.pause)
    typing = ''
    await submit(line)
  }
  let ask = async (tool: string, args: Record<string, unknown>) => {
    lines.push({ kind: 'agent', text: `${tool} ${JSON.stringify(args)}` })
    told()
    let { code, out } = await yak.ask(tool, args)
    printed(code, out)
    await yak.settled()
    told()
  }

  // The steps reached so far run once each, in order, however fast the page
  // is scrolled past them.
  let ran = 0
  // What the prompt is running: a story step's number, or a visitor's line
  // as LIVE and on; 0 before anything has run.
  let stage = 0
  let line = 0
  let entered = 0
  return {
    lines: () => lines,
    typing: () => typing,
    busy: () => busy,
    listen: (l: () => void) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    /** Type a line the visitor wrote and run it. */
    enter: (text: string) =>
      queue(() => {
        stage = LIVE + entered++
        line = 0
        return submit(text)
      }),
    /** The stage what runs now is drawn in. */
    stage: () => stage,
    /** The command running now. */
    at: (): At => ({ stage, line }),
    /** Every line typed at the prompt, oldest first, as a shell keeps them. */
    history: () => history,
    /** Run every step up to `n` (counting from 1) that has not run, typing
     * each step's commands and making its agent's calls. */
    reach: (bodies: string[], n: number) => {
      while (ran < Math.min(n, bodies.length)) {
        let { sh, mcp } = scriptOf(bodies[ran++])
        let step = ran
        queue(async () => {
          stage = step
          for (let [i, said] of sh.entries()) {
            line = i
            await type(said)
          }
          for (let [i, { tool, args }] of mcp.entries()) {
            line = sh.length + i
            await ask(tool, args)
          }
        })
      }
      return chain
    },
    /** Settles once everything queued has run. */
    idle: () => chain,
  }
}
