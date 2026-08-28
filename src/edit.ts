// The graph's Edit primitive (T-16357), made comp-agnostic (T-23829): a
// surgical old→new replacement on the CURRENT value of ANY text column of ANY
// comp — not just doc.body — guarded by the value the caller read (Change.was,
// the wire's compare-and-swap) so a concurrent edit is refused rather than
// clobbered. One patch core, reached through two doors that funnel here: the
// `$edit` field operator in apply() (the one Claude-facing edit surface,
// T-23843) and `graph_patch` (Codex's V4A format, prop-addressed).
//
// It lives here, not in client.ts, because it needs sha() and sha.ts pulls
// node:crypto — server-only. client.ts is in the browser module graph
// (browser_test guards that), so the one builder that hashes stays out of it.
import { type Change, idOf } from './types.ts'
import { type Row } from './client.ts'
import { bodyCols } from './props.ts'
import { sha } from './sha.ts'

// One surgical hunk: replace `old` with `new`, unique-or-`all` — the file Edit
// tool's contract. A `$edit` field carries one of these or a list; a V4A
// section parses into a list of them.
export type EditHunk = { old: string; new: string; all?: boolean }

// THE core: apply a sequence of surgical replacements to `value`, each match
// unique unless `all`, refusing rather than clobbering. `where` names the
// column for the error. A net-unchanged result refuses — an edit that writes
// nothing is a mistake, not a no-op. Pure: no db, no sha, just the string.
export let patchText = (
  value: string,
  hunks: EditHunk[],
  where: string,
): string => {
  let out = value
  for (let { old, new: replacement, all } of hunks) {
    if (!old) throw new Error('edit: the text to replace is empty')
    let hits = out.split(old).length - 1
    if (hits == 0) {
      throw new Error(`edit: not found in ${where}: ${JSON.stringify(old)}`)
    }
    if (hits > 1 && !all) {
      throw new Error(
        `edit: ${hits} matches in ${where} — pass replace_all/all, or ` +
          `include surrounding text to make the match unique`,
      )
    }
    out = all ? out.split(old).join(replacement) : out.replace(old, replacement)
  }
  if (out == value) {
    throw new Error('edit: the replacement leaves the value unchanged')
  }
  return out
}

// A comp-agnostic guarded patch: read the CURRENT value of `comp.column` off the
// row, apply the hunks, and emit a Change carrying `was: {column: sha(current)}`
// so apply() refuses a stale write. Works on any text column of any comp.
export let editChange = (
  row: Row,
  comp: string,
  column: string,
  hunks: EditHunk[],
): Change => {
  let c = row.comps[comp as keyof typeof row.comps] as
    | Record<string, unknown>
    | undefined
  if (!c) throw new Error(`${idOf(row)} has no ${comp} component to edit`)
  let cur = c[column]
  if (typeof cur != 'string') {
    throw new Error(
      `${idOf(row)}.${comp}.${column} is not a text value to edit`,
    )
  }
  let next = patchText(cur, hunks, `${idOf(row)}.${comp}.${column}`)
  return {
    eid: row.eid,
    name: comp,
    comp: { [column]: next },
    was: { [column]: sha(cur) },
  }
}

// A `$edit` field-operator payload → hunks. `{ old, new, all? }`, or a list of
// them for a multi-hunk patch. This is Claude's own Edit idiom, riding a comp
// value in the bundle/change format instead of a bespoke tool.
export let editHunks = (op: unknown): EditHunk[] => {
  let one = (h: unknown): EditHunk => {
    if (!h || typeof h != 'object' || Array.isArray(h)) {
      throw new Error('$edit: each hunk is { old, new, all? }')
    }
    let { old, new: fresh, all } = h as Record<string, unknown>
    if (typeof old != 'string' || typeof fresh != 'string') {
      throw new Error('$edit: old and new must both be text')
    }
    return { old, new: fresh, ...(all === true ? { all: true } : {}) }
  }
  return Array.isArray(op) ? op.map(one) : [one(op)]
}

// Is this comp value a `$edit` field operator (rather than a literal)? A column
// value that is a plain object carrying `$edit`. apply() detects it, reads the
// current column, and lands the patched result with the was-guard.
export let isEditOp = (v: unknown): v is { $edit: unknown } =>
  v != null && typeof v == 'object' && !Array.isArray(v) && '$edit' in v

// Is this comp value ANY field operator — a plain object with a `$`-sigil key?
// Every real scalar is a literal, so a `$`-keyed object is an operator: a known
// one apply() resolves, or a typo apply() must refuse legibly rather than pass
// to storage as a non-scalar.
export let isFieldOp = (v: unknown): v is Record<string, unknown> =>
  v != null && typeof v == 'object' && !Array.isArray(v) &&
  Object.keys(v as object).some((k) => k.startsWith('$'))

// ── graph_patch: Codex's V4A patch, adapted to address a PROP not a file ──
//
// Same `*** Begin Patch` / `*** Update … ` / `@@` / `±` shape Codex emits for
// files, but each section targets `<entity>.<comp>.<column>`. Multiple sections
// per call, the way file apply_patch spans files. The only change from the file
// tool is the address (a prop) and the sink (a Change, not a file write).

export type PatchSection = {
  address: string
  entity: string
  comp: string
  column: string
  hunks: EditHunk[]
}

// A V4A hunk's `-`/`+`/` ` lines → one str_replace: `old` is the context+removed
// lines, `new` is the context+added lines, in order. The shared context anchors
// the match so it stays unique without a line-number.
let sectionHunks = (lines: string[], address: string): EditHunk[] => {
  let hunks: EditHunk[] = []
  let old: string[] = []
  let neu: string[] = []
  let started = false
  let flush = () => {
    if (started && (old.length || neu.length)) {
      hunks.push({ old: old.join('\n'), new: neu.join('\n') })
    }
    old = []
    neu = []
  }
  for (let line of lines) {
    if (line.startsWith('@@')) {
      flush()
      started = true
      continue
    }
    if (!started) {
      throw new Error(`graph_patch: ${address} has a line before its @@ hunk`)
    }
    let mark = line[0]
    let rest = line.slice(1)
    if (mark == '-') old.push(rest)
    else if (mark == '+') neu.push(rest)
    else if (mark == ' ' || line == '') {
      // A bare empty line is empty context; a ' '-prefixed line is context.
      old.push(rest)
      neu.push(rest)
    } else {
      throw new Error(
        `graph_patch: ${address} hunk line must start with '+', '-' or ' ' — got ${
          JSON.stringify(line)
        }`,
      )
    }
  }
  flush()
  if (!hunks.length) throw new Error(`graph_patch: ${address} has no @@ hunk`)
  return hunks
}

// Parse a V4A prop-addressed patch into its sections. Pure — the caller
// resolves each `entity` to a Row and builds an editChange per section.
export let parsePropPatch = (patch: string): PatchSection[] => {
  let lines = patch.replace(/\r\n?/g, '\n').split('\n')
  // Tolerate leading/trailing blank lines around the envelope.
  let start = lines.findIndex((l) => l.trim() == '*** Begin Patch')
  if (start < 0) throw new Error('graph_patch: missing *** Begin Patch')
  let end = lines.findIndex((l, i) => i > start && l.trim() == '*** End Patch')
  if (end < 0) throw new Error('graph_patch: missing *** End Patch')
  let body = lines.slice(start + 1, end)
  let sections: PatchSection[] = []
  let address: string | null = null
  let buf: string[] = []
  let close = () => {
    if (address == null) return
    let m = address.match(/^(.+)\.([^.\s]+)\.([^.\s]+)$/)
    if (!m) {
      throw new Error(
        `graph_patch: address must be <entity>.<comp>.<column> — got ${
          JSON.stringify(address)
        }`,
      )
    }
    sections.push({
      address,
      entity: m[1],
      comp: m[2],
      column: m[3],
      hunks: sectionHunks(buf, address),
    })
  }
  for (let line of body) {
    let m = line.match(/^\*\*\* Update Prop:\s*(.+?)\s*$/)
    if (m) {
      close()
      address = m[1]
      buf = []
      continue
    }
    if (address == null) {
      if (line.trim() == '') continue
      throw new Error(
        `graph_patch: expected '*** Update Prop: <addr>' — got ${
          JSON.stringify(line)
        }`,
      )
    }
    buf.push(line)
  }
  close()
  if (!sections.length) {
    throw new Error('graph_patch: no *** Update Prop section')
  }
  return sections
}

// ── The warm path (M-4066): nudge a full-value rewrite toward the door ──
//
// A large full-value body write through an UPDATE door is the moment to point
// at the surgical patch. Returns a one-line hint, or '' when the write is small
// or already an operator (never fires on a `$edit`). `name` speaks the human id.
export let PATCH_HINT_MIN = 500
export let patchHint = (
  changes: Change[],
  name?: (eid: string) => string,
): string => {
  for (let c of changes) {
    if (!c.comp) continue
    for (let col of bodyCols(c.name)) {
      let v = c.comp[col]
      if (typeof v == 'string' && v.length >= PATCH_HINT_MIN) {
        let who = name?.(c.eid) ?? c.eid
        return `\nhint: that was a ${v.length}-char full-value ${c.name}.${col} ` +
          `rewrite on ${who}. To change PART of a large value, patch it in ` +
          `place — the $edit operator in graph_apply (Claude: ` +
          `comp:{${col}:{$edit:{old,new}}}) or graph_patch (Codex: V4A) — ` +
          `instead of rewriting the whole value (cheaper, and it won't ` +
          `clobber a concurrent edit).`
      }
    }
  }
  return ''
}
