import * as fs from '@yaks/file/io'
import { isAbsolute, posix, relative, resolve, sep } from 'node:path'
import type { Ran, Run } from '@yaks/git/land'
import type { Need } from './landing.ts'
import { type Carried, type File, fileOf, type Target } from './push.ts'
import { output } from './subprocess.ts'

let text = new TextDecoder()

/** Save the changes a push merged from the platform. */
export let writeCarried = async (dir: string, files: Carried[]) => {
  for (let { path, content } of files) {
    let at = `${dir}/${path}`
    await fs.mkdir(posix.dirname(at), { recursive: true })
    await fs.writeTextFile(at, content)
  }
}

/** Stage the source paths that were written and commit only a changed tree. */
export let commitCarried = async (
  tree: string,
  need: Need,
  paths: string[],
  message: string,
) => {
  await need(tree, ['--literal-pathspecs', 'add', '--', ...paths])
  if (await need(tree, ['diff', '--cached', '--name-only', '-z'])) {
    await need(tree, ['commit', '-q', '--no-verify', '-m', message])
  }
}

/** The commit for a platform change, naming the writer that brought it to Git. */
export let carrying = (to: Target, files: Carried[], writer: string): string =>
  `${to.space ? `${to.space}/` : ''}${to.app}: carry ${
    files.map((f) => f.path).join(', ')
  } into git\n\nMerged platform changes into the app's Git source.\n\n` +
  [
    `Writer: ${writer}`,
    ...files.flatMap(({ path, from }) =>
      from ? [`Platform-File: ${from} ${JSON.stringify(path)}`] : []
    ),
  ].join('\n')

/** Git's earlier texts and the platform hashes already merged into them. A
 * retry can find its commit even if Git formatted or combined the text. */
export let fileHistory = async function* (
  run: (args: string[]) => Promise<Ran>,
  path: string,
  file: string,
  at?: string,
) {
  let log = await run([
    '--literal-pathspecs',
    'log',
    '--format=%H%x00%(trailers:key=Platform-File,valueonly,separator=%x00)%x01',
    ...at ? [at] : [],
    '--',
    file,
  ])
  if (!log.ok) {
    if (!at) return
    throw new Error(`git log for ${file}: ${log.err.trim()}`)
  }
  for (let entry of log.out.split('\x01')) {
    let [commit, ...sources] = entry.trim().split('\0')
    if (!commit) continue
    for (let source of sources) {
      let [, sha, name] = /^([a-f0-9]{64}) (.+)$/.exec(source) ?? []
      if (name == JSON.stringify(path)) yield { sha }
    }
    let shown = await run(['show', `${commit}:${file}`])
    if (shown.ok) yield shown.out
  }
}

/** The Git source of each file in a working directory, including file links. */
export let workingSource = async (dir: string, run: Run) => {
  let repo = await run(['rev-parse', '--show-toplevel'], dir)
  if (!repo.ok) return
  let root = repo.out.trim()
  return {
    root,
    path: async (path: string) => {
      let file = resolve(dir, path)
      let target = await fs.realPath(file).catch((error) => {
        if (fs.isNotFound(error)) return file
        throw error
      })
      let source = relative(root, target)
      if (
        isAbsolute(source) || source == '..' || source.startsWith(`..${sep}`)
      ) {
        throw new Error(`${path} links outside the Git checkout`)
      }
      return source
    },
  }
}

/** A manual push commits any local work on the carried paths before replacing
 * it. Path-limited commits leave the rest of the caller's index alone. */
export let saveCarried = async (
  dir: string,
  to: Target,
  files: Carried[],
  run: Run,
  writer: string,
  source: Awaited<ReturnType<typeof workingSource>>,
) => {
  if (!source) return await writeCarried(dir, files)
  let { root } = source
  let paths = await Promise.all(files.map(({ path }) => source.path(path)))
  let git = async (...args: string[]) => {
    let r = await run(['--literal-pathspecs', ...args], root)
    if (!r.ok) {
      throw new Error(
        `${writer}: git ${args[0]} failed in ${dir} for ${
          paths.join(', ')
        }: ${r.err.trim()}`,
      )
    }
    return r.out
  }

  let head = await run(['rev-parse', '--verify', 'HEAD'], root)
  let tracked = head.ok
    ? await git(
      'diff',
      '--name-only',
      '-z',
      'HEAD',
      '--',
      ...paths,
    )
    : await git('ls-files', '--cached', '-z', '--', ...paths)
  let untracked = await git(
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
    '--',
    ...paths,
  )
  let local = (tracked + untracked).split('\0').filter(Boolean)
  let commit = (message: string, selected: string[], ...flags: string[]) =>
    git(
      'commit',
      '--only',
      '--no-verify',
      ...flags,
      '-m',
      message,
      '--',
      ...selected,
    )
  if (local.length) {
    if (untracked) {
      await git(
        'add',
        '--intent-to-add',
        '--',
        ...untracked.split('\0').filter(Boolean),
      )
    }
    let app = to.space ? `${to.space}/${to.app}` : to.app
    await commit(
      `${app}: save local edits before carrying platform changes\n\nWriter: ${writer}`,
      local,
    )
  }
  await writeCarried(
    root,
    files.map((file, i) => ({ ...file, path: paths[i] })),
  )
  await git('add', '--intent-to-add', '--', ...paths)
  await commit(carrying(to, files, writer), paths, '--allow-empty')
}

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
) => {
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
  let links = new Map(entries.flatMap(({ path, rel, link }, i) => {
    if (!link) return []
    let target = text.decode(own[i])
    let source = posix.join(posix.dirname(path), target)
    return [[rel, posix.isAbsolute(target) ? target : source] as const]
  }))
  let targets = links.size
    ? await read([...links.values()].map((path) => `${sha}:${path}`))
    : []
  let next = 0
  let sources = new Map<string, string>()
  let files: File[] = entries.flatMap(({ rel, link }, i) => {
    let bytes = link ? targets[next++] : own[i]
    if (link && bytes) sources.set(rel, links.get(rel)!)
    return bytes ? [fileOf(rel, bytes)] : []
  }).sort((a, b) => a.path < b.path ? -1 : 1)
  return {
    files,
    source: (path: string) => {
      if (links.has(path) && !sources.has(path)) {
        throw new Error(`${dir}/${path} has no file target in Git`)
      }
      return sources.get(path) ?? `${dir}/${path}`
    },
  }
}
