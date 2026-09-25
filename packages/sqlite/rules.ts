// Declared rules, evaluated. A rule's match compiles to one statement
// (@yaks/sql `rule`); this runs it, and reads its rows back as bindings.
//
// Run it against a batch overlay (./overlay.ts) and the same statement reads
// the graph with the batch in it. That is the whole of "rules run before
// persistence": no flag, no second code path, a different set of tables
// underneath — the overlay is a `with` prefix of CTEs, and each covered
// component's name points at its CTE, so what changes is a name.

import type { Vocab } from '@yaks/vocab'
import type { Binding, Bundle, Match } from '@yaks/graph'
import {
  type BindOpts,
  type Cte,
  type Driver,
  type On,
  type Row,
  rule,
} from '@yaks/sql'
import { overlay } from './overlay.ts'

/**
 * Run a compiled match and read its rows back as bindings. The statement is
 * the one above; what makes it report on a batch is the overlay under it
 * (./overlay.ts), not anything here.
 */
export let matched = (
  driver: Driver,
  m: Match,
  vocab: Vocab,
  opts: BindOpts = {},
  on: On = {},
  over: Cte[] = [],
): Binding[] => {
  return driver.query({ ...rule(m, vocab, opts, on), with: over }).map((
    row: Row,
  ) => ({
    entities: m.patterns.map((p, i) => p.makes ? null : String(row[`e${i}`])),
    vars: Object.fromEntries(m.vars.map((name) => [name, row[`v_${name}`]])),
  }))
}

/**
 * How declared rules are evaluated (@yaks/graph `Tx.bindings`): run every match
 * against this graph with `batch` folded in.
 *
 * One overlay for the whole set — `covers` is what the rules read — and then
 * one statement per match under it. The overlay is a `with` prefix, so it costs
 * nothing to build and nothing to tear down: every statement here simply
 * carries it.
 */
export let bindings = (
  driver: Driver,
  vocab: Vocab,
  matches: Match[],
  batch: Bundle[],
  covers: string[],
  opts: BindOpts = {},
): Binding[][] => {
  if (!matches.length) return []
  let over = overlay(driver, vocab, batch, covers)
  // What the batch is about, as the ids the overlay speaks in: the anchor
  // every match is narrowed to, so a rule asks about this batch rather than
  // about the file. With no batch there is nothing to be about and nothing to
  // anchor to: the caller is asking the match outright, which is what a
  // template invocation is.
  let touched = batch.length
    ? [...new Set(batch.map((b) => over.ids.get(b.entity.eid)!))]
      .filter((id) => id !== undefined)
    : undefined
  let on = { at: over.at, gone: over.gone, touched }
  return matches.map((m) => matched(driver, m, vocab, opts, on, over.with))
}
