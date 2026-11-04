// This program's operating-system boundary. Callers do not depend on its runtime.
import process from 'node:process'
import { cpus, loadavg, release } from 'node:os'
import { format, inspect } from 'node:util'
import { readSync, writeSync } from 'node:fs'
import { Readable, Writable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { constants } from 'node:os'

export { cpus, format, inspect, loadavg }
export {
  clearInterval,
  clearTimeout,
  setInterval,
  setTimeout,
} from 'node:timers'
export type Signal = NodeJS.Signals
export type {
  ChildProcess,
  CommandOptions,
  CommandOutput,
  CommandStatus,
} from './command.ts'
export type Env = {
  get: (name: string) => string | undefined
  set: (name: string, value: string) => void
  delete: (name: string) => void
  toObject: () => Record<string, string>
}
export let env: Env = {
  get: (name: string) => process.env[name],
  set: (name: string, value: string) => {
    process.env[name] = value
  },
  delete: (name: string) => {
    delete process.env[name]
  },
  toObject: (): Record<string, string> =>
    Object.fromEntries(
      Object.entries(process.env).filter((row): row is [string, string] =>
        row[1] != null
      ),
    ),
}
export let args: string[] = process.argv.slice(2)
export let pid = process.pid
export let ppid = process.ppid
export let cwd = (): string => process.cwd()
export let execPath = (): string => process.execPath
export let mainModule: string = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : ''
export let main = (url: string): boolean => url == mainModule
export let os = process.platform == 'win32' ? 'windows' : process.platform
export let build = {
  os,
  arch: process.arch,
  target: `${process.arch}-${process.platform}`,
}
export let version = { ...process.versions }
export let runtimeName = process.versions.deno ? 'deno' : 'node'
export let runtimeVersion = process.versions.deno ?? process.versions.node
export let osRelease = release
export let uid = (): number | null => process.getuid?.() ?? null
export let exit = (code?: number): never => process.exit(code)
export let setExitCode = (code: number): void => {
  process.exitCode = code
}
export let kill = (pid: number, signal: Signal | number = 'SIGTERM'): void => {
  process.kill(pid, signal)
}
export let addSignalListener = (signal: Signal, fn: () => void): void => {
  process.on(signal, fn)
}
export let removeSignalListener = (signal: Signal, fn: () => void): void => {
  process.off(signal, fn)
}
export let cpuUsage = process.cpuUsage
export let memoryUsage = (): NodeJS.MemoryUsage => process.memoryUsage()
export let signalCode = (signal: Signal | null): number =>
  signal ? 128 + (constants.signals[signal] ?? 0) : 1
export let unrefTimer = (timer: unknown): void => {
  if (
    timer && typeof timer == 'object' && 'unref' in timer &&
    typeof timer.unref == 'function'
  ) timer.unref()
}
export type Input = {
  isTerminal: () => boolean
  setRaw: (raw: boolean, options?: { cbreak?: boolean }) => void
  readable: ReadableStream<Uint8Array<ArrayBuffer>>
  read: (buffer: Uint8Array) => Promise<number | null>
  readSync: (buffer: Uint8Array) => number | null
}
export type Output = {
  isTerminal: () => boolean
  writeSync: (buffer: Uint8Array) => number
  write: (buffer: Uint8Array) => Promise<number>
  writable: WritableStream<Uint8Array>
}
let input: ReadableStream<Uint8Array<ArrayBuffer>> | undefined
export let stdin: Input = {
  isTerminal: () => !!process.stdin.isTTY,
  setRaw: (raw: boolean, _options?: { cbreak?: boolean }) => {
    process.stdin.setRawMode(raw)
  },
  get readable(): ReadableStream<Uint8Array<ArrayBuffer>> {
    return input ??= Readable.toWeb(process.stdin) as ReadableStream<
      Uint8Array<ArrayBuffer>
    >
  },
  read: async (buffer: Uint8Array): Promise<number | null> => {
    let stream = process.stdin
    let chunk: Buffer | null = stream.read(buffer.length)
    if (!chunk) {
      if (stream.readableEnded) return null
      await new Promise<void>((resolve, reject) => {
        let clear = () => {
          stream.off('readable', ready)
          stream.off('error', failed)
          stream.off('end', ready)
        }
        let ready = () => {
          clear()
          resolve()
        }
        let failed = (error: Error) => {
          clear()
          reject(error)
        }
        stream.once('readable', ready)
        stream.once('error', failed)
        stream.once('end', ready)
      })
      chunk = stream.read(buffer.length) ?? stream.read()
    }
    if (!chunk) return null
    let count = Math.min(buffer.length, chunk.length)
    buffer.set(chunk.subarray(0, count))
    if (chunk.length > count) stream.unshift(chunk.subarray(count))
    return count
  },
  readSync: (buffer: Uint8Array) =>
    readSync(0, buffer, 0, buffer.length, null) || null,
}
let output = (
  stream: typeof process.stdout | typeof process.stderr,
  fd: number,
): Output => ({
  isTerminal: () => !!stream.isTTY,
  writeSync: (buffer: Uint8Array) => writeSync(fd, buffer),
  write: (buffer: Uint8Array): Promise<number> =>
    new Promise((resolve, reject) => {
      stream.write(
        buffer,
        (error) => error ? reject(error) : resolve(buffer.length),
      )
    }),
  get writable(): WritableStream<Uint8Array> {
    return Writable.toWeb(stream)
  },
})
export let stdout: Output = output(process.stdout, 1)
export let stderr: Output = output(process.stderr, 2)
export let consoleSize = (): { columns: number; rows: number } => ({
  columns: process.stdout.columns ?? 80,
  rows: process.stdout.rows ?? 24,
})
