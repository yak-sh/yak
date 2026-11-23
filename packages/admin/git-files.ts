import { posix } from 'node:path'
import { type File, fileOf } from './push.ts'
import { output } from './subprocess.ts'

let text = new TextDecoder()

/** Git's NUL-delimited batch replies. Blob lengths frame the raw bytes, so
 * both names and blobs may contain newlines and blobs may contain NULs. */
export let objects = (bytes: Uint8Array, count: number) => {
  let at = 0
  let out: (Uint8Array | undefined)[] = []
  for (let i = 0; i < count; i++) {
    let end = bytes.indexOf(0, at)
    if (end < 0) throw new Error('git cat-file returned an incomplete header')
    let header = text.decode(bytes.subarray(at, end))
    at = end + 1
    if (header.endsWith(' missing')) {
      out.push(undefined)
      continue
    }
    let [, type, size] = /^\w+ (\w+) (\d+)$/.exec(header) ?? []
    let next = at + Number(size)
    if (bytes[next] !== 0) {
      throw new Error('git cat-file returned an incomplete object')
    }
    out.push(type == 'blob' ? bytes.subarray(at, next) : undefined)
    at = next + 1
  }
  if (at != bytes.length) throw new Error('git cat-file returned extra data')
  return out
}

type Blobs = (specs: string[]) => Promise<(Uint8Array | undefined)[]>

export let blobs =
  (cwd: string, stopping: AbortSignal): Blobs => async (specs) => {
    if (!specs.length) return []
    let input = new TextEncoder().encode(specs.join('\0') + '\0')
    let ran = await output(
      'git',
      {
        cwd,
        args: ['cat-file', '--batch', '-Z'],
        stdout: 'piped',
        stderr: 'piped',
      },
      stopping,
      input,
    )
    if (!ran.success) {
      throw new Error(
        `git cat-file exited ${ran.code}: ${text.decode(ran.stderr)}`,
      )
    }
    return objects(ran.stdout, specs.length)
  }

/** Files as the commit holds them, with dotfiles omitted and in-tree file
 * links read at that commit. Each app needs one Git batch for its files and
 * at most one more for link targets. */
export let filesAt = async (
  run: (args: string[]) => Promise<string>,
  read: Blobs,
  sha: string,
  dir: string,
): Promise<File[]> => {
  let listed = await run([
    'ls-tree',
    '-r',
    '-z',
    '--full-tree',
    sha,
    '--',
    `${dir}/`,
  ])
  let entries = listed.split('\0').flatMap((entry) => {
    let [, mode, oid, path] = /^(\d+) blob (\w+)\t(.+)$/s.exec(entry) ?? []
    if (!path) return []
    let rel = path.slice(dir.length + 1)
    return rel.split('/').some((name) => name.startsWith('.'))
      ? []
      : [{ oid, path, rel, link: mode == '120000' }]
  })
  let bytes = await read(entries.map(({ oid }) => oid))
  let own = entries.map(({ oid }, i) => {
    if (!bytes[i]) throw new Error(`git cat-file did not return blob ${oid}`)
    return bytes[i]!
  })
  let links = entries.flatMap(({ path, link }, i) =>
    link
      ? [
        `${sha}:${
          posix.normalize(posix.join(posix.dirname(path), text.decode(own[i])))
        }`,
      ]
      : []
  )
  let targets = links.length ? await read(links) : []
  let next = 0
  return entries.flatMap(({ rel, link }, i) => {
    let bytes = link ? targets[next++] : own[i]
    return bytes ? [fileOf(rel, bytes)] : []
  }).sort((a, b) => a.path < b.path ? -1 : 1)
}
