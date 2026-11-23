// The runner on a developer's own machine (D-470): it dials out to the space,
// takes each session asked of this machine, runs it with the developer's own
// CLI in a checkout of its own, and hands back what the CLI prints and how it
// ended. The space reads that into the transcript and writes the report
// (./machines.ts). There is no tunnel and no open port: every exchange is a
// call the runner makes.
//
// It reads no sign-in of the CLI's: the CLI is started as the developer would
// start it, and finds its own. What the runner holds is its token for the
// space, which it hands the run in its environment, so the run's tools reach
// the space as the developer (./adapters.ts `Job.keys`).
//
// The loop is the core; the space's tools, the child process and the checkout
// are given to it, and the defaults at the bottom of this file are the only
// places it touches the machine.

import { command } from '@yaks/process/command'
import * as disk from '@yaks/file/io'
import { adapters } from './adapters.ts'
import type { Handed } from './machines.ts'

/** A CLI started for a run: its pid, the lines it prints, and how it ends
 * (its exit code, or null when it was killed by a signal). */
export type Child = {
  pid: number
  lines: AsyncIterable<string>
  done: Promise<number | null>
}

/** What a runner works with. */
export type Runner = {
  /** the machine, by the name it is registered under */
  machine: string
  /** one of the space's tools, answering its `content.body` */
  call: (tool: string, args: Record<string, unknown>) => Promise<string>
  /** where a run works: a checkout of its own, made for the session, or the
   * same one again where it carries on */
  checkout: (session: string) => Promise<string>
  /** start a CLI */
  launch: (
    argv: string[],
    o: { cwd: string; env: Record<string, string> },
  ) => Promise<Child>
  /** the MCP servers each run is connected to, by name to URL */
  mcp?: Record<string, string>
  /** the token each of `mcp` is sent, by name, read as each run starts */
  token?: (server: string) => Promise<string | null>
  /** how many runs go at once (default 2) */
  room?: number
  /** how long the runner waits when nothing is asked (ms, default 5000) */
  every?: number
  /** how often a run's new lines are handed back (ms, default 2000) */
  flush?: number
  /** where a failure the loop goes on past is told */
  report?: (error: unknown, what: string) => void
  /** stops the loop: what is running is handed back to its end */
  signal?: AbortSignal
}

let pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((done) => {
    let t = setTimeout(done, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      done()
    }, { once: true })
  })

// The environment variable a server's token rides in.
let keyOf = (server: string) =>
  `YAK_MCP_TOKEN_${server.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`

/**
 * Run one session the space handed this machine, to its end: launch its CLI,
 * hand back its lines as they come and its exit once it ends. A run that
 * cannot start is handed back as ended, unseen.
 */
export let runOne = async (r: Runner, job: Handed): Promise<void> => {
  let { machine, call } = r
  let tell = (args: Record<string, unknown>) =>
    call('session_log', { machine, session: job.session, ...args })
  let adapter = adapters[job.cli]
  let keys: Record<string, string> = {}
  let env: Record<string, string> = { ...adapter?.env }
  for (let server of Object.keys(r.mcp ?? {})) {
    let token = await r.token?.(server)
    if (!token) continue
    keys[server] = keyOf(server)
    env[keys[server]] = token
  }
  let child: Child
  try {
    if (!adapter) throw new Error(`no adapter runs ${job.cli}`)
    let cwd = await r.checkout(job.session)
    let argv = adapter.argv({ ...job, mcp: r.mcp, keys })
    child = await r.launch(argv, { cwd, env })
  } catch (error) {
    r.report?.(error, `starting ${job.name}`)
    await tell({ exit: null })
    return
  }
  await tell({ pid: child.pid })
  let from = 0
  let held: string[] = []
  // Lines go back in order, one hand at a time: a hand that fails is kept
  // and sent with the next.
  let sending = Promise.resolve()
  let send = (exit?: { exit: number | null }) => {
    sending = sending.then(async () => {
      if (!held.length && !exit) return
      let lines = held.splice(0)
      try {
        await tell({ lines, from, ...exit })
        from += lines.length
      } catch (error) {
        held.unshift(...lines)
        r.report?.(error, `handing back ${job.name}`)
        if (exit) throw error
      }
    })
    return sending
  }
  let tick = setInterval(() => send(), r.flush ?? 2000)
  try {
    for await (let line of child.lines) if (line.trim()) held.push(line)
    let code = await child.done
    clearInterval(tick)
    // The end is told until the space has it: a run whose end is lost reads
    // as going forever.
    for (let tries = 0;; tries++) {
      try {
        await send({ exit: code })
        return
      } catch {
        sending = Promise.resolve()
        await pause(Math.min(60_000, 1000 * 2 ** tries))
      }
    }
  } finally {
    clearInterval(tick)
  }
}

/**
 * Take and run what the space asks of this machine until `signal` aborts:
 * as many runs at once as `room` allows, each to its end.
 */
export let run = async (r: Runner): Promise<void> => {
  let going = new Set<Promise<void>>()
  let room = r.room ?? 2
  while (!r.signal?.aborted) {
    if (going.size >= room) {
      await Promise.race(going)
      continue
    }
    let job: Handed | undefined
    try {
      let body = await r.call('session_take', { machine: r.machine })
      job = body ? JSON.parse(body) as Handed : undefined
    } catch (error) {
      r.report?.(error, 'taking a session')
    }
    if (!job) {
      await pause(r.every ?? 5000, r.signal)
      continue
    }
    let one: Promise<void> = runOne(r, job)
      .catch((error) => r.report?.(error, `running ${job.name}`))
      .finally(() => going.delete(one))
    going.add(one)
  }
  await Promise.all(going)
}

/** Each line a stream of bytes holds, as it arrives. */
export async function* linesOf(
  bytes: ReadableStream<Uint8Array<ArrayBuffer>>,
): AsyncGenerator<string> {
  let rest = ''
  let dec = new TextDecoder()
  for await (let chunk of bytes) {
    let lines = (rest + dec.decode(chunk, { stream: true })).split('\n')
    rest = lines.pop()!
    yield* lines
  }
  if (rest) yield rest
}

/** Start a CLI as a child of this process, its output read line by line and
 * what it says on stderr left to this process's own. */
export let launching: Runner['launch'] = async (argv, { cwd, env }) => {
  let [program, ...args] = argv
  let child = command(program, {
    args,
    cwd,
    env,
    stdin: 'null',
    stdout: 'piped',
    stderr: 'inherit',
  }).spawn()
  await child.started
  return {
    pid: child.pid,
    lines: linesOf(child.stdout),
    done: child.status.then((s) => s.signal ? null : s.code),
  }
}

/** A checkout for each session under `runs`, cut from `source`'s HEAD on a
 * branch of its own (`session-<session>`), and the same one again for a run
 * that carries on. Work left in it stays: it is the developer's to land. */
export let checkouts = (source: string, runs: string) =>
async (
  session: string,
): Promise<string> => {
  let path = `${runs}/${session}`
  try {
    await disk.stat(path)
    return path
  } catch (e) {
    if (!disk.isNotFound(e)) throw e
  }
  await disk.mkdir(runs, { recursive: true })
  let made = await command('git', {
    args: ['-C', source, 'worktree', 'add', '-b', `session-${session}`, path],
    stdin: 'null',
  }).output()
  if (!made.success) {
    throw new Error(
      `git worktree add ${path}: ${new TextDecoder().decode(made.stderr)}`,
    )
  }
  return path
}
