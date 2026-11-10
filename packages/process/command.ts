// Commands and their byte streams, implemented at the process boundary.
import {
  type ChildProcess as NativeChild,
  spawn,
  spawnSync,
} from 'node:child_process'
import process from 'node:process'
import { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { type Signal, signalCode } from './system.ts'

export type CommandOptions = {
  args?: string[]
  cwd?: string | URL
  env?: Record<string, string>
  clearEnv?: boolean
  stdin?: 'piped' | 'inherit' | 'null'
  stdout?: 'piped' | 'inherit' | 'null'
  stderr?: 'piped' | 'inherit' | 'null'
  signal?: AbortSignal
  detached?: boolean
  ipc?: boolean
  uid?: number
  gid?: number
  windowsRawArguments?: boolean
}
export type CommandStatus = {
  success: boolean
  code: number
  signal: Signal | null
}
export type CommandOutput = CommandStatus & {
  stdout: Uint8Array<ArrayBuffer>
  stderr: Uint8Array<ArrayBuffer>
}
export type ChildProcess = {
  pid: number
  /** Settles once the child is running, or rejects when it could not start
   * (a missing program), before any of its pipes are used. */
  started: Promise<void>
  status: Promise<CommandStatus>
  stdin: WritableStream<Uint8Array>
  stdout: ReadableStream<Uint8Array<ArrayBuffer>>
  stderr: ReadableStream<Uint8Array<ArrayBuffer>>
  output: () => Promise<CommandOutput>
  kill: (signal?: Signal) => void
  ref: () => void
  unref: () => void
  [Symbol.asyncDispose]: () => Promise<void>
}
let path = (value: string | URL) =>
  value instanceof URL ? fileURLToPath(value) : value
let stdio = (value: 'piped' | 'inherit' | 'null') =>
  value == 'piped' ? 'pipe' : value == 'null' ? 'ignore' : value
let options = (o: CommandOptions, collect = false) => ({
  cwd: o.cwd == null ? undefined : path(o.cwd),
  env: o.clearEnv
    ? { ...o.env }
    : o.env
    ? { ...process.env, ...o.env }
    : undefined,
  stdio: [
    stdio(o.stdin ?? 'null'),
    stdio(o.stdout ?? (collect ? 'piped' : 'inherit')),
    stdio(o.stderr ?? (collect ? 'piped' : 'inherit')),
    ...o.ipc ? ['ipc' as const] : [],
  ] as [
    'pipe' | 'inherit' | 'ignore',
    'pipe' | 'inherit' | 'ignore',
    'pipe' | 'inherit' | 'ignore',
    'ipc'?,
  ],
  signal: o.signal,
  detached: o.detached,
  uid: o.uid,
  gid: o.gid,
  windowsVerbatimArguments: o.windowsRawArguments,
})
let status = (code: number | null, signal: Signal | null): CommandStatus => ({
  success: code == 0 && signal == null,
  code: code ?? signalCode(signal),
  signal,
})
let bytes = async (
  stream: ReadableStream<Uint8Array<ArrayBuffer>> | undefined,
) =>
  stream
    ? new Uint8Array(await new Response(stream).arrayBuffer())
    : new Uint8Array()
// A child and its pipes hold the process open, and can be ref'd and unref'd
// together. A child that never started (no pid) holds nothing.
type Held = { ref: () => void; unref: () => void }
let held = (p: NativeChild) =>
  (p.pid ? [p, p.stdin, p.stdout, p.stderr].filter((s) => s) : []) as Held[]
let child = (p: NativeChild): ChildProcess => {
  let started = new Promise<void>((resolve, reject) => {
    p.once('spawn', resolve)
    p.once('error', reject)
  })
  started.catch(() => {})
  let done = new Promise<CommandStatus>((resolve, reject) => {
    p.once('error', reject)
    p.once('exit', (code, signal) => resolve(status(code, signal)))
  })
  let out = p.stdout
    ? Readable.toWeb(p.stdout) as ReadableStream<Uint8Array<ArrayBuffer>>
    : undefined
  let err = p.stderr
    ? Readable.toWeb(p.stderr) as ReadableStream<Uint8Array<ArrayBuffer>>
    : undefined
  let input = p.stdin ? Writable.toWeb(p.stdin) : undefined
  let missing = (): never => {
    throw new TypeError('command stream was not piped')
  }
  return {
    pid: p.pid ?? 0,
    started,
    status: done,
    get stdin() {
      return input ?? missing()
    },
    get stdout() {
      return out ?? missing()
    },
    get stderr() {
      return err ?? missing()
    },
    output: async () => {
      let [result, stdout, stderr] = await Promise.all([
        done,
        bytes(out),
        bytes(err),
      ])
      return { ...result, stdout, stderr }
    },
    // By pid, not `p.kill`: Deno's `p.kill` also closes an IPC channel, and a
    // child tied to its parent by one (@yaks/cli runtime.ts) reads that as the
    // parent gone and ends at once, instead of draining on the signal.
    kill: (signal = 'SIGTERM') => {
      if (p.exitCode != null || p.signalCode != null || !p.pid) return
      try {
        process.kill(p.pid, signal)
      } catch (error) {
        // Exited before its exit was heard: as `p.kill`, nothing to signal.
        if ((error as { code?: string }).code != 'ESRCH') throw error
      }
    },
    ref: () => {
      for (let h of held(p)) h.ref()
    },
    unref: () => {
      for (let h of held(p)) h.unref()
    },
    [Symbol.asyncDispose]: async () => {
      if (p.exitCode == null && p.signalCode == null) p.kill('SIGTERM')
      await done
    },
  }
}
export let command = (program: string | URL, o: CommandOptions = {}) => ({
  spawn: (): ChildProcess =>
    child(spawn(path(program), o.args ?? [], options(o))),
  output: (): Promise<CommandOutput> =>
    child(spawn(path(program), o.args ?? [], options(o, true))).output(),
  outputSync: (): CommandOutput => {
    let result = spawnSync(path(program), o.args ?? [], {
      ...options(o, true),
      maxBuffer: Infinity,
    })
    if (result.error) throw result.error
    return {
      ...status(result.status, result.signal),
      stdout: new Uint8Array(result.stdout ?? []),
      stderr: new Uint8Array(result.stderr ?? []),
    }
  },
})
