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

/** The stage a band's own commands run in, below the story: what they write
 * is drawn as soon as it is written. */
export const BAND = 50

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
  // The bands run once each, by key, and only once every step of the story
  // has: a band is below the story, so reaching it is passing them all, and
  // what it writes may need what they wrote. How many steps there are is
  // known once the story is first reached.
  let done = new Set<string>()
  let waiting: string[] = []
  let story = Infinity
  let entered = 0
  // A section's commands, typed, then its agent's calls, drawn in `at`.
  let play = (body: string, at: number) => {
    let { sh, mcp } = scriptOf(body)
    return queue(async () => {
      stage = at
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
  let bands = () => {
    if (ran >= story) { for (let body of waiting.splice(0)) play(body, BAND) }
    return chain
  }
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
    /** Run a band's commands and its agent's calls once, the first time it
     * is reached, after every step of the story. */
    once: (key: string, body: string) => {
      if (!done.has(key)) waiting.push(body)
      done.add(key)
      return bands()
    },
    /** Run every step up to `n` (counting from 1) that has not run, typing
     * each step's commands and making its agent's calls. */
    reach: (bodies: string[], n: number) => {
      story = bodies.length
      while (ran < Math.min(n, bodies.length)) play(bodies[ran], ++ran)
      return bands()
    },
    /** Settles once everything queued has run. */
    idle: () => chain,
  }
}
