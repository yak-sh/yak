// The prompt on the page: what has been typed into the tab's graph and what
// it printed, a line being typed, and the story's steps, each typed in once
// as its section is reached. The visitor types into the same prompt.
import type { Yak } from './yak.ts'
import { called, type Command, scriptOf, shown } from './site.ts'

/** A line the prompt shows: what was typed, what the agent called, what
 * came back (`fault` when it failed), or the comment saying what a command
 * of the story does. */
export type Line = {
  kind: 'in' | 'agent' | 'out' | 'fault' | 'note'
  text: string
}

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
  let ask = async (c: Command) => {
    let { tool, args } = called(c.line)
    lines.push({ kind: 'agent', text: shown(c) })
    told()
    let { code, out } = await yak.ask(tool, args)
    printed(code, out)
    await yak.settled()
    told()
  }

  // The story's commands reached so far run once each, in order, however
  // fast the page is scrolled past them: `next` is the step (from 0) and the
  // command in it that runs next.
  let next = { step: 0, line: 0 }
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
  // One command of a section, drawn in `at` as its `i`th: its comment
  // printed, then the line typed or the call made.
  let run = (c: Command, at: number, i: number) =>
    queue(async () => {
      stage = at
      line = i
      if (c.note) lines.push({ kind: 'note', text: `# ${c.note}` })
      if (c.kind == 'sh') return await type(c.line)
      await ask(c)
    })
  let bands = () => {
    if (next.step >= story) {
      for (let body of waiting.splice(0)) {
        scriptOf(body).forEach((c, i) => run(c, BAND, i))
      }
    }
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
    /** Run every command of the steps before step `n` (counting from 1)
     * and the first `m` of step `n` (all of them, unless told) that has not
     * run, typing each and making each of its agent's calls. */
    reach: (bodies: string[], n: number, m = Infinity) => {
      story = bodies.length
      while (next.step < Math.min(n, bodies.length)) {
        let { step, line } = next
        let commands = scriptOf(bodies[step])
        if (line >= commands.length) {
          next = { step: step + 1, line: 0 }
          continue
        }
        if (step == n - 1 && line >= m) break
        run(commands[line], step + 1, line)
        next = { step, line: line + 1 }
      }
      return bands()
    },
    /** Settles once everything queued has run. */
    idle: () => chain,
  }
}
