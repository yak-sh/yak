// What each file read as it ran, from Deno's audit of its permission checks:
// started with DENO_AUDIT_PERMISSIONS naming a file, a runtime writes a JSON
// line there for every check it makes, under -A too: a file or directory
// read by path (template URLs and directory walks included), a module
// imported by a computed specifier (by its URL), a variable read. The runner
// marks where each file starts with a check of its own (`mark`), so every
// line after it, until the next mark, is that file's.
//
// Only the runtime's own checks are seen. A Deno child that inherits the
// variable opens the same file again and empties it, so the runner takes it
// out of its environment before any test runs (`audit`), and what a child
// process reads, Deno's or any other program's, is not seen.
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { written } from './find.ts'

/** The variable naming the file a runtime audits into. */
export let AUDIT = 'DENO_AUDIT_PERMISSIONS'

// A variable nobody sets, read to mark where a file starts.
let MARK = '@yaks/testing '

/** The file this runtime audits into, if it was started with one, taken out
 * of its environment, so no process it starts writes there. */
export let audit = (): string | undefined => {
  let file = Deno.env.get(AUDIT)
  Deno.env.delete(AUDIT)
  return file
}

/** Marks where `file` starts, in the audit. */
export let mark = (file: string): void => void Deno.env.get(`${MARK}${file}`)

/// path('file:///r/a%20b.ts', '/r') -> 'a b.ts'
/// path('/r/pkg/', '/r') -> 'pkg'
/// path('x/../y.json', '/r') -> 'y.json'
/// path('/r', '/r') -> '.'
/// path('/elsewhere/y.json', '/r') -> undefined
/// path('/r/.README.md.12.345.example.ts', '/r') -> undefined
/** A path a check names, from `root`; none outside it, or the runner's. */
export let path = (value: string, root: string): string | undefined => {
  let at = resolve(
    root,
    value.startsWith('file:') ? fileURLToPath(value) : value,
  )
  return at == root
    ? '.'
    : at.startsWith(`${root}/`) && !written(basename(at))
    ? at.slice(root.length + 1)
    : undefined
}

// Under -A a file's check is a read and a write, and every FFI call is one:
// most lines are neither a read nor a mark.
let ENV = '"permission":"env"'
let READ = '"permission":"read"'
let heeded = (line: string) => line.includes(ENV) || line.includes(READ)

/**
 * What each file marked in `lines` (an audit's) read inside `root` (the
 * checkout), sorted, each once: not the file itself, which the runner imports
 * by its URL and its key holds already. A file marked twice (a run that loads
 * each file again) read what both times did.
 */
export let reads = (
  lines: Iterable<string>,
  root: string,
): Map<string, string[]> => {
  let out = new Map<string, Set<string>>()
  let at: Set<string> | undefined
  let file = ''
  for (let line of lines) {
    if (!heeded(line)) continue
    let env = line.includes(ENV)
    let value: unknown
    try {
      value = JSON.parse(line).value
    } catch {
      continue
    }
    // A check of no path (the working directory, all of a kind) names none.
    if (typeof value != 'string') continue
    if (env) {
      if (!value.startsWith(MARK)) continue
      file = value.slice(MARK.length)
      at = out.get(file) ?? new Set()
      out.set(file, at)
      continue
    }
    let p = at && path(value, root)
    if (p && p != file) at!.add(p)
  }
  return new Map([...out].map(([file, paths]) => [file, [...paths].sort()]))
}

/** What each file marked in the audit at `log` read (`reads`), the file read
 * a piece at a time: a run's audit runs to hundreds of megabytes, more than
 * one string holds. */
export let audited = async (
  log: string,
  root: string,
): Promise<Map<string, string[]>> => {
  let kept: string[] = []
  let text = new TextDecoder()
  let pending = ''
  for await (let bytes of (await Deno.open(log)).readable) {
    let lines = (pending + text.decode(bytes, { stream: true })).split('\n')
    pending = lines.pop()!
    kept.push(...lines.filter(heeded))
  }
  kept.push(pending + text.decode())
  return reads(kept, root)
}
