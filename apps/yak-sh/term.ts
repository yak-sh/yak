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

/** Where in the story a line is: its step (BAND for a band's, LIVE and on
 * for a visitor's line), and which of that step's commands it is, counting
 * from 0. */
export type At = { step: number; line: number }

/** How long the prompt waits between typed characters; none in a test. */
export type Pace = { key: number; pause: number }

export type Term = ReturnType<typeof term>

/** The first stage a visitor's own line is drawn in: the story's commands
 * are stages 1 to n, and each line the visitor enters is one after this. */
export const LIVE = 100

/** The stage a band's own commands run in, below the story: what they write
 * is drawn as soon as it is written. */
export const BAND = 50

/** A line the page itself runs (a step of the story, a band's turn) that
 * failed: the page is broken, not the visitor's typing, so it is reported,
 * and the tracker's page reporter yaks.app weaves in files it. */
export let reported = (line: string, out: string[]) =>
  globalThis.reportError(
    new Error(`yak.sh: ${line} failed: ${out.join(' ').slice(0, 500)}`),
  )

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
  let queue = (work: () => Promise<unknown>) =>
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
    return { code, out }
  }
  // How many of the story's commands are waiting to run behind the one
  // running: the reader has scrolled past them.
  let behind = 0
  // A line is typed a key at a time, unless the reader has scrolled past
  // commands still to come: then the rest of it is typed at once, so the
  // prompt keeps up with them.
  let type = async (line: string) => {
    for (let i = 1; i <= line.length && !behind; i++) {
      typing = line.slice(0, i)
      told()
      await wait(pace.key)
    }
    if (!behind) await wait(pace.pause)
    typing = ''
    let { code, out } = await submit(line)
    if (code) reported(line, out)
  }
  let ask = async (c: Command) => {
    let { tool, args } = called(c.line)
    lines.push({ kind: 'agent', text: shown(c) })
    told()
    let { code, out } = await yak.ask(tool, args)
    if (code) reported(shown(c), out)
    printed(code, out)
    await yak.settled()
    told()
  }

  // The story's commands reached so far run once each, in order, however
  // fast the page is scrolled past them: `next` is the step (from 0) and the
  // command in it that runs next.
  let next = { step: 0, line: 0 }
  // The stage what the prompt runs is drawn in: a story command's number,
  // BAND, or a visitor's line as LIVE and on; 0 before anything has run.
  // `at` is the step and command it is.
  let stage = 0
  let at: At = { step: 0, line: 0 }
  let ran = 0
  // The bands run once each, by key, and only once every step of the story
  // has: a band is below the story, so reaching it is passing them all, and
  // what it writes may need what they wrote. How many steps there are is
  // known once the story is first reached.
  let done = new Set<string>()
  let waiting: string[] = []
  let story = Infinity
  let entered = 0
  // One command, drawn in stage `drawn` as command `i` of `step`: its
  // comment printed, then the line typed or the call made.
  let run = (c: Command, drawn: number, step: number, i: number) => {
    behind++
    return queue(async () => {
      behind--
      stage = drawn
      at = { step, line: i }
      if (c.note) lines.push({ kind: 'note', text: `# ${c.note}` })
      if (c.kind == 'sh') return await type(c.line)
      await ask(c)
    })
  }
  // Settles once every step of the story has been typed, with whatever the
  // bands had queued by then: the turns below run after it, however soon the
  // reader is past them.
  let whole!: () => void
  let storied = new Promise<void>((ok) => whole = ok)
  let bands = () => {
    if (next.step >= story) {
      for (let body of waiting.splice(0)) {
        scriptOf(body).forEach((c, i) => run(c, BAND, BAND, i))
      }
      whole()
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
        at = { step: stage, line: 0 }
        return submit(text)
      }),
    /** The stage what runs now is drawn in. */
    stage: () => stage,
    /** The command running now. */
    at: (): At => at,
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
        run(commands[line], ++ran, step + 1, line)
        next = { step, line: line + 1 }
      }
      return bands()
    },
    /** Settles once the whole story has run, and the bands queued by then. */
    story: () => storied.then(() => chain),
    /** Settles once everything queued has run. */
    idle: () => chain,
  }
}
