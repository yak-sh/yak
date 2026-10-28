// The owner's deployment history. Uploading code does not move data; giving
// it traffic can. Keep every stored-shape boundary in this history, even after
// someone rolls the code back. The directory does not roll its rows back.
import type { Ran } from '@yaks/git/land'
import { CallError, Interrupted } from '@yaks/tools/errors'
import { WRANGLER } from '../../workers/yak/wrangler.ts'
import { Refused } from './refusal.ts'
import { output } from './subprocess.ts'

// One git run in `cwd`, answered as it came — the runner @yaks/git lands with.
// A run cut off by shutdown is no answer from git, so it is thrown as it came.
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
    if (error instanceof CallError || error instanceof Interrupted) throw error
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
  annotations?: Record<string, string>
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

// Kernel-only rollback leaves the compiler serving its current protocol.
// The header is the wire declaration, including in versions predating this
// check. No header names the original bare-ask protocol; an expression we
// cannot read is unknown, never permission to roll back.
export let compilerProtocolIn = (source: string): string | null => {
  let clean = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
  if (!clean.includes('x-yak-compiler-job')) return '0'
  return clean.match(/['"]x-yak-compiler-job['"]\s*:\s*['"](\d+)['"]/)?.[1] ??
    null
}

export let compilerRefusal = (
  target: string | null,
  // The catalog-free receiver requires protocol 1. Keep this floor even if
  // main is reverted or its build fails: neither restores the sibling.
  current: string | null = '1',
): string | undefined =>
  target == null || current == null
    ? 'no rollback: compiler protocol unknown'
    : target != current
    ? `no rollback: compiler protocol changed (${target} → ${current})`
    : undefined

/// shaIn('739f56b25cae820c8541a8b4a1ade2f7a6c7e9be A release module…') -> '739f56b25cae820c8541a8b4a1ade2f7a6c7e9be'
/// shaIn('yaks.app emergency rollback to 739f56b2: build path broken') -> undefined
/** The commit a version's or deployment's message leads with, written in full
 * by the deploy door (workers/yak/wrangler.ts `--message`). */
export let shaIn = (message?: string): string | undefined =>
  message?.match(/^([a-f\d]{40})\b/i)?.[1].toLowerCase()

/** What serves now: the newest deployment's leading version, the commit its
 * message names (a rollback's names none; its version's does), when it went
 * live, and whether an operator rolled back to it. */
export let serving = (deployments: Deployment[]) => {
  let now =
    deployments.toSorted((a, b) =>
      Date.parse(b.created_on) - Date.parse(a.created_on)
    )[0]
  let lead = now?.versions.toSorted((a, b) => b.percentage - a.percentage)[0]
  return now && lead
    ? {
      version: lead.version_id,
      sha: now.versions.length == 1
        ? shaIn(now.annotations?.['workers/message'])
        : undefined,
      at: now.created_on,
      rollback: now.annotations?.['workers/triggered_by'] == 'rollback',
    }
    : undefined
}

/// let put = (sha: string, created_on: string, triggered = 'upload') => ({ id: created_on, created_on, versions: [{ version_id: sha, percentage: 100 }], annotations: { 'workers/message': `${sha.repeat(40)} subject`, 'workers/triggered_by': triggered } })
/// debuts([put('b', '2026-10-28T12:36:58Z'), put('b', '2026-10-28T12:36:52Z'), put('a', '2026-10-28T12:25:58Z')]) -> [{ sha: 'a'.repeat(40), at: '2026-10-28T12:25:58Z' }, { sha: 'b'.repeat(40), at: '2026-10-28T12:36:52Z' }]
/// debuts([put('a', '2026-10-28T12:25:58Z', 'rollback')]) -> []
/** Each commit the deploy door put live, and when its first deployment did,
 * oldest first: deployments that serve one version and name their commit. A
 * rollback is an operator's choice of what serves, not a commit's way live. */
export let debuts = (deployments: Deployment[]) => {
  let first = new Map<string, string>()
  for (
    let d of deployments.toSorted((a, b) =>
      Date.parse(a.created_on) - Date.parse(b.created_on)
    )
  ) {
    let sha = d.versions.length == 1 &&
        d.annotations?.['workers/triggered_by'] != 'rollback'
      ? shaIn(d.annotations?.['workers/message'])
      : undefined
    if (sha && !first.has(sha)) first.set(sha, d.created_on)
  }
  return [...first].map(([sha, at]) => ({ sha, at }))
}

export let deploymentsFor = (id: string, deployments: Deployment[]) =>
  deployments.filter((d) =>
    d.versions.some((v) => v.version_id == id && v.percentage > 0)
  ).sort((a, b) => Date.parse(a.created_on) - Date.parse(b.created_on))

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
    let served = deploymentsFor(v.id, history)
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
  refusal?: string,
) => {
  let r = await git(root, args, stopping)
  if (!r.ok) {
    let message = `git ${args[0]} exited ${r.code}: ${r.err.trim()}`
    if (refusal) throw new CallError(refusal, message)
    throw new Error(message)
  }
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
  let guarded = boundaries(rows, floor)
  for (let row of guarded) {
    if (row.refusal) continue
    let source = row.commit && await git(root, [
      'show',
      `${row.commit.sha}:workers/yak/esbuild.ts`,
    ], stopping)
    row.refusal = compilerRefusal(
      source?.ok ? compilerProtocolIn(source.out) : null,
    )
  }
  return guarded
}

// Both activations of a two-phase deploy carry the same source commit. Keep
// versions addressable, but default rollback must leave that commit entirely.
let previous = (rows: Deploy[]): Deploy[] => {
  let source = (r: Deploy) => r.commit?.sha ?? r.id
  let latest = (a: Deploy, b: Deploy) =>
    Date.parse(b.created) - Date.parse(a.created)
  let current = rows.filter((r) => r.live).sort(latest)[0]
  let prior = rows.filter((r) => (r.prior ?? 0) > 0)
  // A prior gradual deployment across distinct commits still needs the owner
  // to choose which source to restore.
  if (new Set(prior.map(source)).size > 1) return prior
  if (prior.length && (!current || source(prior[0]) != source(current))) {
    return prior.sort(latest).slice(0, 1)
  }
  return rows.filter((r) =>
    r.first && !r.live && (!current || source(r) != source(current))
  ).sort((a, b) => Date.parse(b.last!) - Date.parse(a.last!) || latest(a, b))
    .slice(0, 1)
}

export let rollbackTarget = (rows: Deploy[], want?: string): Deploy => {
  let found = want ? rows.filter((r) => r.id.startsWith(want)) : previous(rows)
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
      `${target.id}: ${target.refusal}. Correct code with yak admin revert <sha> --as admin@bot.yak.sh; main is always deployed.`,
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
