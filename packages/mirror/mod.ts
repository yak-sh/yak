/**
 * @yaks/mirror — one sync between files and a graph, each direction optional.
 *
 * A mirror is a list of bindings. A binding names the files it covers and
 * carries a `read` (files → graph), a `values` (graph → the text each file
 * should hold), or both. Code is read-only: the files own it. A persona is
 * write-only: the graph owns it. A markdown document may go both ways.
 *
 * Each synced path remembers the pair it last agreed on: the file's Git blob
 * id and the hash of the graph's value. Against that memory a path is one of
 * four things — the same, moved on the file side (read it), moved on the graph
 * side (write it), or moved on both since they last agreed: a conflict,
 * reported and never overwritten, the same promise a `was` precondition makes
 * a write.
 *
 * ```ts
 * import { sync } from '@yaks/mirror'
 *
 * // let report = await sync(binding)
 * // report.conflicts -> paths changed on both sides, left as they are
 * ```
 *
 * @module
 */

import { oid } from '@yaks/git'

/** What a path last agreed on: the file's Git blob id, and the hash of the
 * graph's value — for a written file, the blob id of the text it rendered. */
export type Agreed = { blob: string; hash?: string }

/** What a sync does with one path. */
export type Act = 'same' | 'read' | 'write' | 'conflict'

/** One path's two sides now, and what they last agreed on. `file` is absent
 * when there is no file, `value` when the graph holds nothing for it. */
export type Sides = { file?: string; value?: string; agreed?: Agreed }

/** A set of files and the graph's side of them. */
export type Binding = {
  /** what reports and memory call it */
  name: string
  /** the covered files that exist now: path → Git blob id */
  files: () => Promise<Map<string, string>>
  /** graph → files: the text the graph says each path should hold; a path
   * absent here is a file the graph no longer has */
  values?: () => Promise<Map<string, string>>
  /** files → graph: read the paths that moved; `gone` are paths whose file is
   * gone. The graph's own record of what it read is its side of the memory. */
  read?: (paths: string[], gone: string[]) => Promise<void>
  /** what each path last agreed on */
  agreed: () => Promise<Map<string, Agreed>>
  /** record new agreements; `null` forgets a path */
  remember?: (changed: Map<string, Agreed | null>) => Promise<void>
}

/** What one sync did. */
export type Report = {
  read: string[]
  wrote: string[]
  removed: string[]
  conflicts: string[]
  failed: string[]
}

/** A path's decision, from its two sides and what they last agreed on.
 *
 * ```ts
 * decide({ file: 'a', agreed: { blob: 'a' } }, { read: true }) // 'same'
 * decide({ file: 'b', agreed: { blob: 'a' } }, { read: true }) // 'read'
 * decide({ file: 'b', value: 'c', agreed: { blob: 'a', hash: 'a' } },
 *   { write: true }) // 'conflict'
 * ```
 */
export let decide = (
  s: Sides,
  can: { read?: boolean; write?: boolean },
): Act => {
  if (s.file != null && s.file == s.value) return 'same'
  let fileMoved = s.file != s.agreed?.blob
  if (!can.write) return fileMoved ? 'read' : 'same'
  if (s.file == null && s.value == null) return 'same'
  // Where the graph owns the file, a missing file loses nothing by being
  // written: deleting it is how somebody resolves a conflict.
  if (!can.read && s.file == null) return 'write'
  if (!s.agreed) {
    // Nothing remembered: the owning side wins, and with two owners only an
    // absent side can yield without losing anything.
    if (!can.read || s.file == null) return 'write'
    return s.value == null ? 'read' : 'conflict'
  }
  let valueMoved = s.value != s.agreed.hash
  if (fileMoved && valueMoved) return 'conflict'
  if (valueMoved) return 'write'
  if (!fileMoved) return 'same'
  // Only the file moved: read it back, or, where the graph owns the file,
  // put back what the graph says.
  return can.read ? 'read' : 'write'
}

let utf8 = new TextEncoder()

/** The Git blob id of a text: what `git hash-object` prints for it. */
export let blobOf = (text: string): Promise<string> =>
  oid('blob', utf8.encode(text))

/** Every path's decision, without doing anything: what a `--check` reports. */
export let plan = async (
  b: Binding,
): Promise<{ path: string; act: Act; sides: Sides; text?: string }[]> => {
  let [files, texts, agreed] = await Promise.all([
    b.files(),
    b.values?.() ?? new Map<string, string>(),
    b.agreed(),
  ])
  let values = new Map<string, string>()
  for (let [path, text] of texts) values.set(path, await blobOf(text))
  let paths = [...new Set([...files.keys(), ...texts.keys(), ...agreed.keys()])]
    .sort()
  let can = { read: !!b.read, write: !!b.values }
  return paths.map((path) => {
    let sides = {
      file: files.get(path),
      value: values.get(path),
      agreed: agreed.get(path),
    }
    return { path, act: decide(sides, can), sides, text: texts.get(path) }
  })
}

// A write goes to a temp file beside the target and is renamed over it: a
// reader mid-write — a harness loading its instructions — sees the old file or
// the new one, never an empty one.
let put = (path: string, text: string) => {
  Deno.mkdirSync(path.slice(0, path.lastIndexOf('/')) || '.', {
    recursive: true,
  })
  let tmp = `${path}.${crypto.randomUUID()}.tmp`
  try {
    Deno.writeTextFileSync(tmp, text)
    Deno.renameSync(tmp, path)
  } catch (e) {
    try {
      Deno.removeSync(tmp)
    } catch { /* nothing to clean */ }
    throw e
  }
}

/** Sync one binding: read what moved on the file side, write what moved on
 * the graph side, and report what moved on both. A failure on one path never
 * stops the others. */
export let sync = async (b: Binding): Promise<Report> => {
  let out: Report = {
    read: [],
    wrote: [],
    removed: [],
    conflicts: [],
    failed: [],
  }
  let learned = new Map<string, Agreed | null>()
  let gone: string[] = []
  for (let { path, act, sides, text } of await plan(b)) {
    if (act == 'conflict') out.conflicts.push(path)
    else if (act == 'read') {
      out.read.push(path)
      if (sides.file == null) gone.push(path)
    } else if (act == 'write') {
      try {
        if (text == null) {
          Deno.removeSync(path)
          out.removed.push(path)
          learned.set(path, null)
        } else {
          put(path, text)
          out.wrote.push(path)
          learned.set(path, { blob: sides.value!, hash: sides.value })
        }
      } catch (e) {
        out.failed.push(`${path}: ${(e as Error).message}`)
      }
    } else if (!b.values) continue
    else if (sides.file == null && sides.value == null) learned.set(path, null)
    else if (sides.agreed?.blob != sides.file) {
      // Both sides already say the same thing: remember that they agree.
      learned.set(path, { blob: sides.file!, hash: sides.value })
    }
  }
  if (out.read.length) {
    try {
      await b.read!(out.read, gone)
    } catch (e) {
      out.failed.push(`${b.name}: ${(e as Error).message}`)
      out.read = []
    }
  }
  if (learned.size) await b.remember?.(learned)
  return out
}

/** The covered files among `paths` that exist, with their blob ids. */
export let present = async (paths: string[]): Promise<Map<string, string>> => {
  let out = new Map<string, string>()
  for (let path of paths) {
    let text: string
    try {
      text = Deno.readTextFileSync(path)
    } catch {
      continue
    }
    out.set(path, await blobOf(text))
  }
  return out
}

/** A memory kept as one JSON file — for a binding whose graph side cannot
 * hold it. A missing or unreadable file remembers nothing. */
export let memo = (
  file: string,
): Pick<Binding, 'agreed' | 'remember'> => {
  let load = (): Record<string, Agreed> => {
    try {
      return JSON.parse(Deno.readTextFileSync(file))
    } catch {
      return {}
    }
  }
  return {
    agreed: () => Promise.resolve(new Map(Object.entries(load()))),
    remember: (changed) => {
      let all = load()
      for (let [path, a] of changed) {
        if (a) all[path] = a
        else delete all[path]
      }
      put(file, JSON.stringify(all, null, 1) + '\n')
      return Promise.resolve()
    },
  }
}
