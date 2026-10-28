import { POPULATION_VERSION } from './population.ts'
// What a store's `install()` runs, known once per vocabulary and read
// overrides, and the store's part of a composed schema's print (./follow.ts).
// Shared by the writing store (./mod.ts) and the reading one (./read-store.ts),
// which reads the print and nothing else.

import type { Derived, Stmt } from '@yaks/sql'
import { render } from '@yaks/sql/core'
import type { Vocab } from '@yaks/vocab'
import { digest, sha256 } from '@yaks/graph/sha256'
import { FIT, indexed, tabled } from './ddl.ts'

// What `install()` runs, known once per vocabulary and read overrides: the
// fingerprint of its statements, the statements that create an object where
// it is missing, and the objects they create. Over a current file the
// rendering and the hashing were most of what an install cost, and none of it
// moves while a process holds the same vocabulary: a Vocab is a value nobody
// mutates once it is loaded, so the object itself is the key.
type Make = Extract<
  Stmt,
  { t: 'create table' | 'create index' | 'create view' | 'create trigger' }
>
export type Plan = { print: string; raised: Make[]; made: string[] }
let makes = (s: Stmt): s is Make =>
  s.t == 'create table' || s.t == 'create index' || s.t == 'create view' ||
  s.t == 'create trigger'
let plans = [
  new WeakMap<Vocab, WeakMap<Derived, Plan>>(),
  new WeakMap<Vocab, WeakMap<Derived, Plan>>(),
]
let NONE: Derived = {}

// Where the plan for a vocabulary and its read overrides is kept.
let shelf = (vocab: Vocab, file: boolean) => {
  let held = plans[Number(file)]
  let by = held.get(vocab) ?? new WeakMap<Derived, Plan>()
  held.set(vocab, by)
  return by
}

// A plan but its print, and the text its print digests.
let draft = (vocab: Vocab, derived: Derived, file: boolean) => {
  let stmts = [...tabled(vocab, derived, file), ...indexed(vocab)]
  let raised = stmts.filter(makes)
  return {
    // The fitting's revision rides beside them (ddl.ts `FIT`): what fitting
    // changes is read off the file, so a fitting that learns something new
    // installs again over a file whose statements are as they were.
    text: [FIT, POPULATION_VERSION, ...stmts.map((s) => render(s).sql)]
      .join(';\n'),
    raised,
    made: raised.map((s) => s.name),
  }
}

export let plan = (
  vocab: Vocab,
  derived: Derived = NONE,
  file = false,
): Plan => {
  let by = shelf(vocab, file)
  let known = by.get(derived)
  if (known) return known
  let { text, raised, made } = draft(vocab, derived, file)
  let fresh = { print: sha256(text), raised, made }
  by.set(derived, fresh)
  return fresh
}

/** {@link plan}, its print digested by the platform rather than in script,
 * and kept where `plan` finds it. A schema's statements are a hundred
 * kilobytes, which the script digest takes milliseconds over in a process
 * that has not compiled it yet, as every command starts; a host that can wait
 * before it binds its store asks this first. */
export let planned = async (
  vocab: Vocab,
  derived: Derived = NONE,
  file = false,
): Promise<Plan> => {
  let by = shelf(vocab, file)
  let known = by.get(derived)
  if (known) return known
  let { text, raised, made } = draft(vocab, derived, file)
  let print = await digest(text)
  // One `plan` made while the digest ran is the same plan, and stays.
  if (!by.has(derived)) by.set(derived, { print, raised, made })
  return by.get(derived)!
}
