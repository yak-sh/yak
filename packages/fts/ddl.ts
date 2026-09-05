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
// WHEN A COLUMN IS NOT ITS OWN TEXT. @yaks/blob swaps a body for its SHA-256
// and keeps the prose in a store beside the rows, so a trigger reading the
// column would index the address and a search would find the body by title
// alone. A {@link Text} entry says how to resolve one, and it is applied on
// BOTH sides of the mirror:
//
//   - the triggers write the resolved words, so every write path indexes prose
//     — the plugin's, a plain `insert into doc`, a restore;
//   - the index's content becomes a VIEW that resolves the same way
//     (`<comp>_text`), because FTS5 reads the content back for `snippet()` and
//     for `rebuild`, and both would otherwise answer with the hash.
//
// Resolving in a trigger is sound because a blob is immutable and
// content-addressed: the text an address stands for is the same when the delete
// side reads it as when the insert side did, which is the whole of what the
// mirror rule asks. And a body written in the same batch is already there — the
// bytes go in before the row that names them.
//
// `heal()` is the other half. An index that drifts from its table (a trigger
// that did not run, a file restored around it) answers wrong quietly, so it is
// checked and rebuilt rather than trusted.

import {
  type Field,
  indexes,
  indexName,
  type Text,
  textName,
} from './fields.ts'
import type { Driver } from './driver.ts'

let q = (name: string): string => `"${name.replaceAll('"', '""')}"`

let lit = (s: string): string => s.replaceAll("'", "''")

// One component's index and the triggers that follow its table, plus the view
// the index reads back through when any of its columns resolves.
let index = (comp: string, props: string[], text: Text): string[] => {
  let fts = indexName(comp)
  let cols = props.map(q).join(', ')
  // How one column reads as text, given SQL naming its stored value. Absent a
  // resolution the value IS the text, which is every ordinary column.
  let read = (prop: string, stored: string) =>
    text[`${comp}.${prop}`]?.(stored) ?? stored
  let resolved = props.filter((p) => text[`${comp}.${p}`])
  // The values a trigger writes: the column read as text, or '' for a null —
  // the index never holds a null term, and delete must mirror insert exactly.
  let side = (s: string) =>
    props.map((p) => `coalesce(${read(p, `${s}.${q(p)}`)}, '')`).join(', ')
  // What FTS5 reads a column back out of: the table itself, or the view that
  // resolves it. `<comp>_text` is this package's own name, deliberately not
  // @yaks/sqlite's `doc_value` — that view is the read source for whole `doc`
  // rows, and a narrower one standing in its place under `if not exists` would
  // hide the columns a query needs.
  let content = resolved.length ? textName(comp) : comp
  return [
    ...(resolved.length
      ? [
        `create view if not exists ${q(content)} as
      select "entity", ${
          props.map((p) => `${read(p, q(p))} as ${q(p)}`).join(', ')
        }, "entity" as rowid from ${q(comp)}`,
      ]
      : []),
    `create virtual table if not exists ${q(fts)} using fts5(
      ${cols}, content='${lit(content)}', content_rowid='entity'
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
// component, its text view where one is needed, then the index and its three
// triggers. Run them after the component tables exist — an external-content
// index names the table it mirrors. `text` says which columns are not their own
// text (`blobText(vocab)` from @yaks/blob is one); with none, every column
// indexes as it stands.
export let schema = (fields: Field[], text: Text = {}): string[] =>
  indexes(fields).flatMap(({ comp, props }) => index(comp, props, text))

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
