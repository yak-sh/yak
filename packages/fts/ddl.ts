// The index, and keeping it true.
//
// One FTS5 index per indexed component, named `<comp>_fts`. Each is
// EXTERNAL-CONTENT (`content='<comp>'`): it stores the inverted index and
// nothing else, reading the words themselves back out of the component's own
// table, so the prose is never kept twice. `content_rowid='entity'` lines the
// index's rowid up with the component's integer owner — which is the entity's
// spine id — so a match answers with an id the rest of the query already
// speaks, and no join is needed to get there.
//
// Three triggers keep it current. The one rule an external-content index
// imposes: a delete must be handed EXACTLY the values the insert was handed, or
// the index keeps words for rows that no longer say them. So both sides read
// the same way — the stored text, or '' for a null — and an update is spelled
// as the delete then the insert.
//
// `heal()` is the other half. An index that drifts from its table (a trigger
// that did not run, a file restored around it) answers wrong quietly, so it is
// checked and rebuilt rather than trusted.

import { type Field, indexes, indexName } from './fields.ts'
import type { Driver } from './driver.ts'

let q = (name: string): string => `"${name.replaceAll('"', '""')}"`

// One component's index and the triggers that follow its table.
let index = (comp: string, props: string[]): string[] => {
  let fts = indexName(comp)
  let cols = props.map(q).join(', ')
  // The values a trigger writes: the stored text, or '' for a null — the index
  // never holds a null term, and delete must mirror insert exactly.
  let side = (s: string) =>
    props.map((p) => `coalesce(${s}.${q(p)}, '')`).join(', ')
  return [
    `create virtual table if not exists ${q(fts)} using fts5(
      ${cols}, content='${comp.replaceAll("'", "''")}', content_rowid='entity'
    )`,
    `create trigger if not exists ${q(`${fts}_insert`)} after insert on ${
      q(comp)
    } begin
      insert into ${q(fts)}(rowid, ${cols}) values (new.entity, ${side('new')});
    end`,
    `create trigger if not exists ${q(`${fts}_delete`)} after delete on ${
      q(comp)
    } begin
      insert into ${q(fts)}(${q(fts)}, rowid, ${cols})
        values ('delete', old.entity, ${side('old')});
    end`,
    `create trigger if not exists ${q(`${fts}_update`)} after update on ${
      q(comp)
    } begin
      insert into ${q(fts)}(${q(fts)}, rowid, ${cols})
        values ('delete', old.entity, ${side('old')});
      insert into ${q(fts)}(rowid, ${cols}) values (new.entity, ${side('new')});
    end`,
  ]
}

// The whole search schema for a set of fields, as ordered statements: per
// component, the index then its three triggers. Run them after the component
// tables exist — an external-content index names the table it mirrors.
export let schema = (fields: Field[]): string[] =>
  indexes(fields).flatMap(({ comp, props }) => index(comp, props))

// Is this index still telling the truth about its table? Two questions, cheap
// then thorough: does it hold a row per row of the component, and does FTS5's
// own integrity check pass. Answers the complaint, or undefined for a healthy
// index.
let fault = (db: Driver, comp: string): string | undefined => {
  let fts = indexName(comp)
  let count = (t: string) =>
    Number(db.query(`select count(*) as n from ${t}`, [])[0].n)
  try {
    let [indexed, rows] = [count(q(fts)), count(q(comp))]
    if (indexed != rows) return `${fts} holds ${indexed} of ${rows} rows`
    db.exec(
      `insert into ${q(fts)}(${q(fts)}, rank) values('integrity-check', 1)`,
    )
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

// Check every index and rebuild the ones that drifted; answers the names of the
// indexes rebuilt (usually none). A rebuild that does not fix the fault throws
// with BOTH complaints — the first says what was wrong, the second whether the
// damage is wider than the index.
export let heal = (db: Driver, fields: Field[]): string[] => {
  let healed: string[] = []
  for (let { comp } of indexes(fields)) {
    let before = fault(db, comp)
    if (!before) continue
    let fts = indexName(comp)
    db.exec(`insert into ${q(fts)}(${q(fts)}) values('rebuild')`)
    let after = fault(db, comp)
    if (after) {
      throw new Error(
        `${fts} is still broken after a rebuild; before: ${before}; after: ${after}`,
      )
    }
    healed.push(fts)
  }
  return healed
}
