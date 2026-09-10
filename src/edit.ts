// Fleet patch-format doors. @yaks/graph owns operator recognition and the one
// portable patchText implementation shared by $edit and graph_patch. This
// adapter retains prop addressing, Row → guarded Change, and the rewrite hint.
// The guarded builder uses the fleet sha() and stays out of client.ts's
// browser module graph.
import { type Change, idOf } from './types.ts'
import { type Row } from './client.ts'
import { bodyCols } from './props.ts'
import { sha } from './sha.ts'
import { type EditHunk, patchText } from '@yaks/graph'
export {
  type EditHunk,
  editHunks,
  isEditOp,
  isFieldOp,
  patchText,
} from '@yaks/graph'

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
          `place — the $edit operator, as a dot-param value here ` +
          `(.${col}={"$edit":{"old":…,"new":…}}), as a comp value in ` +
          `graph_apply, or graph_patch (Codex: V4A) — instead of rewriting ` +
          `the whole value (cheaper, and it won't clobber a concurrent edit).`
      }
    }
  }
  return ''
}
