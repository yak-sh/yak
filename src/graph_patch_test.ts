// The comp-agnostic patch doors (T-23829): the `$edit` field operator resolved
// inside apply(), the V4A prop-addressed parser, and the shared guarded core —
// each proven on a real in-memory graph so the operator, the was-guard, and the
// multi-target parse are exercised end to end, not mocked.
import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert'
import { editChange, parsePropPatch, patchHint } from './edit.ts'
import { type Row, rows } from './client.ts'
import type { Change } from './types.ts'
Deno.env.set('DB_PATH', ':memory:')
let { apply, bound, open, snapshot } = await import('./db.ts')
let { db } = await import('./live_db.ts')

open()
let uid = () => crypto.randomUUID()

// The whole graph as flat changes, and one entity reassembled as a Row.
let all = (): Change[] => snapshot(db).changes
let row = (eid: string): Row =>
  rows({ changes: all().filter((c) => c.eid == eid) })[0]

// One value off an entity's component.
let value = (eid: string, name: string, col: string): unknown =>
  all().find((c) => c.eid == eid && c.name == name)?.comp?.[col]

Deno.test('$edit patches a NON-doc text column — comp-agnostic', () => {
  let E = uid()
  apply(db, [{ eid: E, name: 'project', comp: { color: 'draft green' } }])
  apply(db, [
    {
      eid: E,
      name: 'project',
      comp: { color: { $edit: { old: 'draft ', new: '' } } },
    },
  ])
  assertEquals(value(E, 'project', 'color'), 'green')
})

Deno.test('$edit on doc.body: single, multi-hunk, and replace-all', () => {
  let E = uid()
  apply(db, [{
    eid: E,
    name: 'doc',
    comp: { title: 'D', body: 'one two three' },
  }])

  // A list of hunks applies in sequence.
  apply(db, [{
    eid: E,
    name: 'doc',
    comp: {
      body: { $edit: [{ old: 'one', new: '1' }, { old: 'three', new: '3' }] },
    },
  }])
  assertEquals(value(E, 'doc', 'body'), '1 two 3')

  // replace_all takes every occurrence of a non-unique match.
  apply(db, [{ eid: E, name: 'doc', comp: { body: 'aa aa aa' } }])
  apply(db, [{
    eid: E,
    name: 'doc',
    comp: { body: { $edit: { old: 'aa', new: 'bb', all: true } } },
  }])
  assertEquals(value(E, 'doc', 'body'), 'bb bb bb')
})

Deno.test('$edit refuses: non-unique, unchanged, and non-text', () => {
  let E = uid()
  apply(db, [{ eid: E, name: 'doc', comp: { title: 'D', body: 'aa aa' } }])

  // A non-unique match with no `all` is refused rather than clobbering.
  assertThrows(
    () =>
      apply(db, [{
        eid: E,
        name: 'doc',
        comp: { body: { $edit: { old: 'aa', new: 'x' } } },
      }]),
    Error,
    '2 matches',
  )
  // An edit that leaves the value unchanged is a mistake, not a no-op.
  assertThrows(
    () =>
      apply(db, [{
        eid: E,
        name: 'doc',
        comp: { body: { $edit: { old: 'a', new: 'a', all: true } } },
      }]),
    Error,
    'unchanged',
  )
  // $edit on an absent value has nothing to patch.
  let P = uid()
  apply(db, [{ eid: P, name: 'project', comp: {} }])
  assertThrows(
    () =>
      apply(db, [{
        eid: P,
        name: 'project',
        comp: { color: { $edit: { old: 'x', new: 'y' } } },
      }]),
    Error,
    'no text value',
  )
  // And $edit on a non-text column (an enum) is refused outright.
  let T = uid()
  apply(db, [{ eid: T, name: 'task', comp: {} }])
  assertThrows(
    () =>
      apply(db, [{
        eid: T,
        name: 'task',
        comp: { status: { $edit: { old: 'open', new: 'wip' } } },
      }]),
    Error,
    'not a wire-writable text column',
  )
})

Deno.test('editChange guards with the value read — a concurrent edit refuses', () => {
  let E = uid()
  apply(db, [{
    eid: E,
    name: 'doc',
    comp: { title: 'D', body: 'version one' },
  }])
  let read = row(E) // holds body 'version one'

  // Someone else rewrites the body before our patch lands.
  apply(db, [{ eid: E, name: 'doc', comp: { body: 'version two' } }])

  // Our patch, built against the stale read, is refused — not clobbered.
  let ch = editChange(read, 'doc', 'body', [{ old: 'one', new: 'ONE' }])
  assertThrows(() => apply(db, [ch]), Error, 'has moved')
  assertEquals(value(E, 'doc', 'body'), 'version two') // untouched
})

Deno.test('graph_patch: parse V4A, multi-prop across two entities', () => {
  let A = uid(), B = uid()
  apply(db, [{
    eid: A,
    name: 'doc',
    comp: { title: 'A', body: 'the old line\nkeep me' },
  }])
  apply(db, [{ eid: B, name: 'project', comp: { color: 'red' } }])

  let sections = parsePropPatch(
    `*** Begin Patch
*** Update Prop: ${A}.doc.body
@@
-the old line
+the new line
 keep me
*** Update Prop: ${B}.project.color
@@
-red
+blue
*** End Patch`,
  )
  assertEquals(sections.length, 2)
  assertEquals(sections[0].comp, 'doc')
  assertEquals(sections[0].column, 'body')

  // Each section builds a guarded editChange; apply lands them atomically.
  let batch = sections.map((s) =>
    editChange(row(s.entity), s.comp, s.column, s.hunks)
  )
  apply(db, batch)
  assertEquals(value(A, 'doc', 'body'), 'the new line\nkeep me')
  assertEquals(value(B, 'project', 'color'), 'blue')
})

Deno.test('graph_patch: a bad hunk / address refuses cleanly', () => {
  assertThrows(
    () => parsePropPatch('nothing here'),
    Error,
    'Begin Patch',
  )
  assertThrows(
    () =>
      parsePropPatch(
        `*** Begin Patch
*** Update Prop: T-1.body
@@
-x
+y
*** End Patch`,
      ),
    Error,
    '<entity>.<comp>.<column>',
  )
  // A hunk that doesn't match its target is caught at apply/build time.
  let E = uid()
  apply(db, [{ eid: E, name: 'doc', comp: { title: 'D', body: 'present' } }])
  let [s] = parsePropPatch(
    `*** Begin Patch
*** Update Prop: ${E}.doc.body
@@
-absent
+x
*** End Patch`,
  )
  assertThrows(
    () => editChange(row(E), s.comp, s.column, s.hunks),
    Error,
    'not found',
  )
})

Deno.test('warm-path hint fires on a large full-value body write, not on $edit', () => {
  let big = 'x'.repeat(600)
  assertStringIncludes(
    patchHint([{ eid: 'T-1', name: 'doc', comp: { body: big } }]),
    'full-value doc.body',
  )
  // A $edit operator is not a full-value literal — no nudge.
  assertEquals(
    patchHint([{
      eid: 'T-1',
      name: 'doc',
      comp: { body: { $edit: { old: 'a', new: 'b' } } },
    }]),
    '',
  )
  // A small body write is fine as-is.
  assertEquals(
    patchHint([{ eid: 'T-1', name: 'doc', comp: { body: 'short' } }]),
    '',
  )
})

Deno.test('bound() refuses a non-scalar for a scalar column — the storage guard', () => {
  // A scalar passes through; a bool column coerces true/false to 1/0.
  assertEquals(bound('doc', 'body', 'ok'), 'ok')
  assertEquals(bound('doc', 'body', null), null)
  assertEquals(bound('repo', 'push', true), 1)

  // An object or array can never land in a text/number column — node:sqlite
  // only rejects it by accident, so the boundary names the offender.
  assertThrows(
    () => bound('doc', 'body', { some: 'object' }),
    Error,
    'doc.body expects a scalar value, got object',
  )
  assertThrows(
    () => bound('task', 'priority', [1, 2]),
    Error,
    'task.priority expects a scalar value, got array',
  )
})

Deno.test('an unknown $-operator is refused legibly at the operator layer', () => {
  let E = uid()
  apply(db, [{ eid: E, name: 'doc', comp: { title: 'D', body: 'text' } }])
  // A `$`-keyed typo survives normalize's pass-through, then editOps names it
  // — better than bound()'s generic "expects a scalar" and long before storage.
  assertThrows(
    () =>
      apply(db, [{
        eid: E,
        name: 'doc',
        comp: { body: { $edt: { old: 'a', new: 'b' } } },
      }]),
    Error,
    'unknown operator "$edt"',
  )
  // The body is untouched by the refusal.
  assertEquals(value(E, 'doc', 'body'), 'text')
})
