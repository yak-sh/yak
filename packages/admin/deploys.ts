// The owner's deployment history. Uploading code does not move data; giving
// it traffic can. Keep every stored-shape boundary in this history, even after
// someone rolls the code back. The directory does not roll its rows back.
import type { Ran } from '@yaks/git/land'
import { CallError } from '@yaks/tools'
import { WRANGLER } from '../../workers/yak/wrangler.ts'
import { Refused } from './accounts.ts'
import { output } from './subprocess.ts'

// One git run in `cwd`, answered as it came — the runner @yaks/git lands with.
export let git = async (
  cwd: string,
  args: string[],
  stopping: AbortSignal,
): Promise<Ran> => {
  try {
    let ran = await output('git', {
      cwd,
      args,
      env: { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '' },
      stdout: 'piped',
      stderr: 'piped',
    }, stopping)
    let text = new TextDecoder()
    return {
      ok: ran.success,
      code: ran.code,
      out: text.decode(ran.stdout),
      err: text.decode(ran.stderr),
    }
  } catch (error) {
    if (error instanceof CallError) throw error
    return {
      ok: false,
      code: -1,
      out: '',
      err: `git ${args.join(' ')} in ${cwd}: ${error}`,
    }
  }
}

export type Commit = { sha: string; at: string; subject: string }
export type Version = {
  id: string
  metadata: { created_on: string }
  annotations?: Record<string, string>
}
export type Deployment = {
  id: string
  created_on: string
  versions: { version_id: string; percentage: number }[]
}
export type Deploy = {
  id: string
  created: string
  commit?: Commit
  estimated: boolean
  marks: string[] | null
  first?: string
  last?: string
  live: number
  prior?: number
  boundary: string[]
  refusal?: string
}

// Wrangler prints arrays; the API envelopes are useful fixtures too.
export let rowsIn = <T>(raw: unknown, key: string): T[] => {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw == 'object') {
    let r = raw as Record<string, unknown>
    for (let name of ['result', key, 'items']) {
      if (r[name] != null) return rowsIn<T>(r[name], key)
    }
  }
  throw new Error(`unrecognized Wrangler ${key} JSON`)
}

export let commitsIn = (text: string): Commit[] =>
  text.trim().split('\n').filter(Boolean).map((line) => {
    let [sha, at, ...subject] = line.split('\t')
    return { sha, at, subject: subject.join('\t') }
  }).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))

// Read the declarations, never execute historical TypeScript. Before
// BOUNDARIES existed every MARKS entry moved data; before the second migration
// MARK alone named the first pass.
// An unfamiliar expression is unknown, never an empty migration history.
export let marksIn = (source: string): string[] | null => {
  let clean = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
  let names = new Map(
    [...clean.matchAll(
      /\b(?:let|const)\s+(\w+)\s*=\s*(['"])(yak\/store\/[^'"]+)\2/g,
    )]
      .map((m) => [m[1], m[3]]),
  )
  let word = ['BOUNDARIES', 'MARKS'].find((word) =>
    new RegExp(`\\b(?:let|const)\\s+${word}\\b`).test(clean)
  )
  if (!word) return names.has('MARK') ? [names.get('MARK')!] : null
  let list = clean.match(
    new RegExp(`\\b${word}\\s*=\\s*\\[([^\\]]*)\\][ \\t]*;?[ \\t]*(?:\\n|$)`),
  )?.[1]
  if (list == null) return null
  let marks = list.split(',').map((s) => s.trim()).filter(Boolean).map((s) =>
    names.get(s) ?? s.match(/^['"](yak\/store\/[^'"]+)['"]$/)?.[1]
  )
  return marks.every((m) => m != null) ? marks : null
}

export let deploysIn = (
  versions: Version[],
  deployments: Deployment[],
  commits: Commit[],
): Deploy[] => {
  let history = [...deployments].sort((a, b) =>
    Date.parse(a.created_on) - Date.parse(b.created_on)
  )
  let latest = history.at(-1)
  let log = [...commits].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  return versions.map((v): Deploy => {
    if (!v.id || !Number.isFinite(Date.parse(v.metadata?.created_on))) {
      throw new Error('version has no id or creation time')
    }
    let message = v.annotations?.['workers/message'] ?? ''
    let named = message.match(/^([a-f\d]{7,40})(?:\s+(.*))?$/i)
    let commit = named
      ? log.find((c) => c.sha.startsWith(named[1])) ?? {
        sha: named[1],
        at: '',
        subject: named[2] ?? '',
      }
      : log.find((c) => Date.parse(c.at) <= Date.parse(v.metadata.created_on))
    let served = history.filter((d) =>
      d.versions.some((s) => s.version_id == v.id && s.percentage > 0)
    )
    return {
      id: v.id,
      created: v.metadata.created_on,
      commit,
      estimated: !named,
      marks: null,
      first: served[0]?.created_on,
      last: served.at(-1)?.created_on,
      live: latest?.versions.find((s) => s.version_id == v.id)?.percentage ?? 0,
      prior: history.at(-2)?.versions.find((s) =>
        s.version_id == v.id
      )?.percentage ?? 0,
      boundary: [],
    }
  }).sort((a, b) => Date.parse(b.created) - Date.parse(a.created))
}

export let boundaries = (
  rows: Deploy[],
  floor: string[] | null = [],
): Deploy[] => {
  let out = rows.map((r) => ({
    ...r,
    boundary: [] as string[],
    refusal: undefined as string | undefined,
  }))
  let served = out.filter((r) => r.first).sort((a, b) =>
    Date.parse(a.first!) - Date.parse(b.first!)
  )
  let moved = new Set<string>()
  let newest: Deploy | undefined
  for (let r of served) {
    r.boundary = (r.marks ?? []).filter((m) => !moved.has(m))
    for (let mark of r.boundary) moved.add(mark)
    if (r.boundary.length) newest = r
  }
  for (let mark of floor ?? []) moved.add(mark)
  let unknown = floor == null || !served.length ||
    served.some((r) => r.marks == null)
  let estimated = served.some((r) => r.estimated)
  for (let r of out) {
    let missing = [...moved].filter((m) => !r.marks?.includes(m))
    let older = newest && Date.parse(r.created) < Date.parse(newest.created)
    if ((r.marks && missing.length) || older) {
      r.refusal = `no rollback: data moved (${
        (missing.length ? missing : newest!.boundary).join(', ')
      })`
    } else if (unknown || r.marks == null) {
      r.refusal = 'no rollback: migration history unknown'
    } else if (estimated || r.estimated) {
      r.refusal =
        'no rollback: commit inferred by time; version messages required'
    } else if (!r.first) {
      r.refusal = 'no rollback: version never deployed'
    }
  }
  return out
}

export let table = (rows: Deploy[]): string => {
  let first = Math.min(
    ...rows.filter((r) => r.first).map((r) => Date.parse(r.first!)),
  )
  let lines = [
    'VERSION                               LIVE   FIRST LIVE                COMMIT    SUBJECT',
  ]
  for (let r of rows) {
    lines.push(
      `${r.id}  ${r.live ? `${r.live}%`.padEnd(5) : '—    '}  ${
        r.first ?? '(never deployed)'
      }  ` +
        `${r.commit?.sha.slice(0, 8) ?? '?'}${r.estimated ? '~' : ''}  ${
          r.commit?.subject ?? '(commit unknown)'
        }`,
    )
    if (r.boundary.length) {
      let before = Date.parse(r.first!) == first
        ? ' (at or before the first retained deployment)'
        : ''
      lines.push(`  ── data boundary: ${r.boundary.join(', ')}${before}`)
    }
    if (r.refusal) lines.push(`  ${r.refusal}`)
  }
  if (rows.some((r) => r.estimated)) {
    lines.push(
      '~ commit inferred from git time; upload time cannot prove its source.',
    )
  }
  lines.push(
    'Boundaries assume served migrations ran; main’s migration history also prevents older data rollbacks.',
  )
  return lines.join('\n')
}

export let command = async (
  cwd: string,
  cmd: string,
  args: string[],
  stopping: AbortSignal,
) => {
  let r = await output(cmd, {
    cwd,
    args,
    stdin: 'null',
    stdout: 'piped',
    stderr: 'piped',
  }, stopping)
  let text = new TextDecoder()
  if (!r.success) {
    throw new Error(
      `${cmd} ${args[0]} exited ${r.code}: ${text.decode(r.stderr).trim()}`,
    )
  }
  return text.decode(r.stdout).trim()
}

export let needGit = async (
  root: string,
  args: string[],
  stopping: AbortSignal,
) => {
  let r = await git(root, args, stopping)
  if (!r.ok) throw new Error(`git ${args[0]} exited ${r.code}: ${r.err.trim()}`)
  return r.out.trim()
}

export let wrangler = (
  root: string,
  args: string[],
  stopping: AbortSignal,
) =>
  command(
    `${root}/workers/yak`,
    WRANGLER[0],
    [...WRANGLER.slice(1), ...args],
    stopping,
  )

/** The two deployment-history reads, in order and never at once. Wrangler's
 * rotating OAuth refresh rewrites one shared credential file without a lock;
 * concurrent processes can read it between truncate and write and falsely say
 * this already-signed-in box is not logged in. */
export let deploymentLists = async (
  read: (args: string[]) => Promise<string>,
): Promise<[string, string]> => [
  await read(['versions', 'list', '--json']),
  await read(['deployments', 'list', '--json']),
]

export let deploys = async (
  root: string,
  stopping: AbortSignal,
): Promise<Deploy[]> => {
  // Git has no credential store in common with Wrangler and can still read
  // beside it. Only the two Wrangler processes must not overlap.
  let [[vs, ds], log] = await Promise.all([
    deploymentLists((args) => wrangler(root, args, stopping)),
    needGit(root, [
      'log',
      'main',
      '--first-parent',
      '--format=%H%x09%cI%x09%s',
    ], stopping),
  ])
  let versions = rowsIn<Version>(JSON.parse(vs), 'versions')
  let deployments = rowsIn<Deployment>(JSON.parse(ds), 'deployments')
  // The most recent ten uploads may omit an old version deployed by rollback.
  for (
    let id of new Set(
      deployments.flatMap((d) => d.versions.map((v) => v.version_id)),
    )
  ) {
    if (versions.some((v) => v.id == id)) continue
    let raw = JSON.parse(
      await wrangler(root, ['versions', 'view', id, '--json'], stopping),
    )
    versions.push(raw.result ?? raw)
  }
  let rows = deploysIn(versions, deployments, commitsIn(log))
  let marks = new Map<string, string[] | null>()
  let markers = async (sha: string) => {
    if (!marks.has(sha)) {
      let file = await git(
        root,
        ['show', `${sha}:workers/yak/migrate.ts`],
        stopping,
      )
      if (file.ok) marks.set(sha, marksIn(file.out))
      else {
        // A commit predating migrate.ts has no passes; a missing commit is
        // unknown. Ask git about the tree, not about its error wording.
        let tree = await git(root, [
          'ls-tree',
          sha,
          '--',
          'workers/yak/migrate.ts',
        ], stopping)
        marks.set(sha, tree.ok && !tree.out.trim() ? [] : null)
      }
    }
    return marks.get(sha)!
  }
  for (let row of rows) {
    if (row.commit) row.marks = await markers(row.commit.sha)
  }
  // Wrangler retains a short deployment window. A past migration must not
  // disappear from the safety rule when its version ages out of that window.
  // Main always deploys: conservatively include every boundary it has carried,
  // even if that particular build failed. A shallow history cannot prove this.
  let floor: string[] | null = []
  if (
    await needGit(root, ['rev-parse', '--is-shallow-repository'], stopping) ==
      'true'
  ) {
    floor = null
  } else {
    let history = await needGit(root, [
      'log',
      'main',
      '--first-parent',
      '--format=%H',
      '--',
      'workers/yak/migrate.ts',
    ], stopping)
    for (let sha of history.split('\n').filter(Boolean)) {
      let found = await markers(sha)
      if (found == null) {
        floor = null
        break
      }
      floor.push(...found)
    }
  }
  return boundaries(rows, floor)
}

export let rollbackTarget = (rows: Deploy[], want?: string): Deploy => {
  let prior = rows.filter((r) => (r.prior ?? 0) > 0)
  let found = want
    ? rows.filter((r) => r.id.startsWith(want))
    : prior.length
    ? prior
    : rows.filter((r) => r.first && !r.live).sort((a, b) =>
      Date.parse(b.last!) - Date.parse(a.last!)
    ).slice(0, 1)
  if (found.length != 1) {
    throw new Refused(
      `rollback target ${
        want ?? '(previous deployment)'
      } names ${found.length} versions; name one version explicitly`,
    )
  }
  let target = found[0]
  if (target.refusal) {
    throw new Refused(
      `${target.id}: ${target.refusal}. Correct code with yak admin revert <sha> --owner; main is always deployed.`,
    )
  }
  return target
}

export let rollback = async (
  root: string,
  want: string | undefined,
  out: (line: string) => void,
  stopping: AbortSignal,
) => {
  let target = rollbackTarget(await deploys(root, stopping), want)
  out(
    await wrangler(root, [
      'rollback',
      target.id,
      '-y',
      '--message',
      `yaks.app emergency rollback to ${target.commit?.sha}: build path broken`,
    ], stopping),
  )
  let checked = await output(Deno.execPath(), {
    cwd: root,
    args: ['run', '-A', 'bin/verify-deploy.ts', '--tail', '0'],
    stdin: 'null',
  }, stopping)
  return checked.code
}
