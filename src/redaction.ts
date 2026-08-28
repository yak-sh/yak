// Value redaction's content mechanics and backup-history report. The database
// transaction lives in db.ts, beside the journal it rewrites; this module keeps
// the pure string transform and the filesystem-facing git read independently
// testable. Removed values never cross a process argv or appear in a report.

import { type Change, comps, stamped } from './types.ts'

export let REDACTED = '[redacted]'
export type DocColumn = 'title' | 'body'

let textType = (name: string, prop: string) => {
  let t = comps[name]?.[prop] ?? stamped[name]?.[prop]
  return t == 'text' || t == 'body' || t == 'url' ||
    t == 'query' || (typeof t == 'object' && 'text' in t)
}

let replace = (text: string, value: string) => {
  let count = text.split(value).length - 1
  return count ? { text: text.replaceAll(value, REDACTED), count } : null
}

// scrubBatch's per-change test, lifted to one normalized journal_field row: a
// content (text) column, never the redaction audit's own — so redact() can
// scrub the parallel record (journal_field.value) in the same breath as the
// JSON batch, keeping the two representations consistent for every reader that
// now reads the normalized rows (T-18880).
export let scrubbable = (name: string, prop: string) =>
  name != 'redaction' && textType(name, prop)

// Scrub content columns in one applied batch. Structural strings (eids, enum
// states, timestamps) stay whole: corrupting replay to hide a short value is
// not forgetting it. Unknown historical columns are treated as content so a
// retired spelling cannot preserve what the current vocabulary no longer sees.
export let scrubBatch = (batch: Change[], value: string) => {
  let count = 0
  let changes = batch.map((change) => {
    // A prior redaction is the permanent proof of forgetting. Its target,
    // column, and hash are structural even though two happen to store as text;
    // redacting them would erase the audit while leaving its live row intact.
    if (!change.comp || change.name == 'redaction') return change
    let comp = { ...change.comp }
    let moved = false
    for (let [prop, old] of Object.entries(comp)) {
      if (typeof old != 'string' || !textType(change.name, prop)) continue
      let next = replace(old, value)
      if (!next) continue
      comp[prop] = next.text
      count += next.count
      moved = true
    }
    return moved ? { ...change, comp } : change
  })
  return { batch: changes, count }
}

export let docColumns = (
  batch: Change[],
  eid: string,
  value: string,
): DocColumn[] => {
  let found = new Set<DocColumn>()
  for (let change of batch) {
    if (change.eid != eid || change.name != 'doc' || !change.comp) continue
    for (let column of ['title', 'body'] as DocColumn[]) {
      let text = change.comp[column]
      if (typeof text == 'string' && text.includes(value)) found.add(column)
    }
  }
  return [...found]
}

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
// full, so the commit that first introduced the earliest scrubbed row is the
// exact start of the published exposure range. Pickaxe searches for that row's
// timestamp — never the removed value — and the row remains after its payload
// is sanitized, so its occurrence is monotonic across later dumps.
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
  let pattern = `INSERT INTO journal VALUES('${since.replaceAll("'", "''")}',`
  let intro = await run(root, [
    'log',
    '--format=%H%x09%cI',
    '--reverse',
    `--since=${floor}`,
    `-S${pattern}`,
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
