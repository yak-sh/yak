// Value redaction's content test and backup-history report. The database
// transaction lives in db.ts, beside the journal it scrubs; this module keeps
// the pure column test and the filesystem-facing git read independently
// testable. Removed values never cross a process argv or appear in a report.

import { comps, stamped } from './types.ts'

export let REDACTED = '[redacted]'
export type DocColumn = 'title' | 'body'

let textType = (name: string, prop: string) => {
  let t = comps[name]?.[prop] ?? stamped[name]?.[prop]
  return t == 'text' || t == 'body' || t == 'url' ||
    t == 'query' || (typeof t == 'object' && 'text' in t)
}

// Which journal_field rows redact() may rewrite: a content (text) column.
// Structural strings (eids, enum states, timestamps) stay whole: corrupting
// replay to hide a short value is not forgetting it. Never the redaction
// audit's own columns — its target, column, and hash are structural even though
// two happen to store as text, and scrubbing them would erase the proof of
// forgetting while leaving its live row intact. A column the vocabulary does
// not know is left alone: only what it says is text is content.
export let scrubbable = (name: string, prop: string) =>
  name != 'redaction' && textType(name, prop)

export type Commit = { sha: string; at: string }
export type Published = {
  ref: string | null
  count?: number
  first?: Commit
  last?: Commit
  error?: string
}

type Output = { success: boolean; stdout: string; stderr: string }
type Run = (root: string, args: string[]) => Promise<Output>

// Redaction's history report and backup's snapshot+push share this advisory
// lock. Without it, backup could VACUUM before the scrub and publish after the
// report, creating one more leaked commit behind a truthful-looking answer.
export let withBackupLock = async <T>(root: string, run: () => Promise<T>) => {
  let file: Deno.FsFile | undefined
  try {
    file = await Deno.open(`${root}/.git/tasks-backup.lock`, {
      create: true,
      write: true,
    })
  } catch (e) {
    if (
      !(e instanceof Deno.errors.NotFound) &&
      !(e instanceof Deno.errors.NotADirectory)
    ) throw e
  }
  if (!file) return await run()
  await file.lock()
  try {
    return await run()
  } finally {
    await file.unlock()
    file.close()
  }
}

let decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes).trim()
let git: Run = async (root, args) => {
  let out = await new Deno.Command('git', {
    args: ['-C', root, ...args],
  }).output()
  return {
    success: out.success,
    stdout: decode(out.stdout),
    stderr: decode(out.stderr),
  }
}

let commit = (line: string): Commit | undefined => {
  let [sha, at] = line.split('\t')
  return sha && at ? { sha, at } : undefined
}

// The journal is append-only between redactions and every backup dumps it in
// full, so the commit that first introduced the earliest scrubbed transaction
// is the exact start of the published exposure range. The search is for that
// journal_tx row's timestamp in its INSERT — never the removed value — and the
// row remains after its field values are sanitized, so its occurrence is
// monotonic across later dumps. A regex (-G), since the row's id precedes the
// timestamp in the dump and is not known here.
export let published = async (
  root: string,
  since: string | undefined,
  run: Run = git,
): Promise<Published> => {
  let upstream = await run(root, [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{upstream}',
  ])
  if (!upstream.success) return { ref: null, count: 0 }
  if (!since) return { ref: upstream.stdout }
  // Git commit dates have one-second precision. Include the preceding second
  // so a quick snapshot+commit in the row's own second cannot fall outside
  // the walk; pickaxe still decides whether the row was present.
  let floor = new Date(+new Date(since) - 1000).toISOString()
  let stamp = since.replaceAll("'", "''").replace(/[.+?^$()[\]{}|\\]/g, '\\$&')
  let pattern = `INSERT INTO journal_tx VALUES\\([0-9]+,'${stamp}',`
  let intro = await run(root, [
    'log',
    '--format=%H%x09%cI',
    '--reverse',
    `--since=${floor}`,
    `-G${pattern}`,
    upstream.stdout,
    '--',
    ':(glob)snap/journal.sql.part.*',
  ])
  if (!intro.success) {
    return {
      ref: upstream.stdout,
      error: intro.stderr || 'git history inspection failed',
    }
  }
  let first = commit(intro.stdout.split('\n')[0] ?? '')
  let tip = await run(root, [
    'log',
    '-1',
    '--format=%H%x09%cI',
    upstream.stdout,
  ])
  if (!tip.success) {
    return { ref: upstream.stdout, error: tip.stderr || 'git tip read failed' }
  }
  let last = commit(tip.stdout)
  if (!first) {
    return last && +new Date(last.at) < +new Date(floor)
      ? { ref: upstream.stdout, count: 0 }
      : { ref: upstream.stdout }
  }
  let after = await run(root, [
    'rev-list',
    '--count',
    `${first.sha}..${upstream.stdout}`,
  ])
  if (!after.success || !last) {
    return {
      ref: upstream.stdout,
      error: after.stderr || 'git exposure count failed',
    }
  }
  return {
    ref: upstream.stdout,
    count: Number(after.stdout) + 1,
    first,
    last,
  }
}
