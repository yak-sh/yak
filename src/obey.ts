// A comment whose first line opens with `:` IS a command line, and the
// graph obeys it — the same commands.ts table the web bar, the TUI, the
// CLI (`task :fix T-42`) and MCP already run. The comment's target is the
// focus, its author is the actor. Say `:done` on T-1 and T-1 closes;
// reply `:done` to a task's email and the inbound sweep lands the comment
// and the graph obeys. One vocabulary, now in every channel where words
// already flow — and no new authority: the order becomes the same wire
// batch a typist would have written, so claim leases and every apply rule
// hold unchanged.
//
// An EFFECT, never an apply rule: the comment is the RECORD OF THE ASK
// and must land whatever the order does. Execution is the response to it,
// post-commit, unable to reject the batch that carried it.

import { apply, db, snapshot } from './db.ts'
import { dispatch, trace } from './effects.ts'
import { providers } from './adapters.ts'
import { commandOut, orderIn } from './commands.ts'
import { type Change, idOf } from './types.ts'
import { find, rows, spawnChanges, spawnDefaults } from './client.ts'

type Cast = (changes: Change[]) => void

// The author, as the vocabulary knows them: `run` wants the session's own
// id (that's how :claim names a lease and how focus resolves), while the
// journal wants whatever the writer wrote as. A comment typed in a browser
// has a client, not a session — its orders still run, minus the verbs that
// need a lease to speak of.
let speaker = (via: string) =>
  (db.prepare('select id from session where eid = ? or id = ?')
    .get(via, via) as { id: string } | undefined)?.id

export let obeyed =
  (cast: Cast) => (ceid: string, comp: Record<string, unknown>) => {
    // A receipt never commands. This one line is the loop's floor: every
    // comment this effect mints is an event, so nothing it says can cascade.
    if (comp.event) return
    let target = String(comp.target_eid ?? '')
    if (!target) return
    let doc = db.prepare('select body from doc where eid = ?').get(ceid) as
      | { body: string | null }
      | undefined
    let line = orderIn(String(doc?.body ?? ''))
    if (!line) return
    let via = String(
      (db.prepare('select via from created where eid = ?').get(ceid) as
        | { via: string | null }
        | undefined)?.via ?? '',
    )
    let session = via ? speaker(via) : undefined

    let snap = snapshot(db)
    let all = rows(snap)
    let changes: Change[] = []
    let said = ''
    try {
      let out = commandOut(all, line, target, session)
      changes.push(...(out.changes ?? []))
      said = out.msg ?? ''
      // `:fix` from a comment is the point of the whole feature — an agent
      // started by saying so where the work is discussed. The request is a
      // session entity like any other spawn; created(session) validates it,
      // so a bad one lands as a failed Session, never as a broken receipt.
      if (out.spawn) {
        let mine = spawnDefaults(all, session)
        let table = providers()
        let provider = mine.provider ?? table[0]?.name
        let model = mine.model ??
          table.find((p) => p.name == provider)?.models[0]
        if (!provider || !model) throw new Error('no provider to default to')
        let made = spawnChanges(all, {
          task: out.spawn,
          provider,
          model,
          by: session,
          deps: snap.deps,
        })
        changes.push(...made.changes)
        let onto = find(all, out.spawn)
        said = [said, `spawned onto ${onto ? idOf(onto) : out.spawn}`]
          .filter(Boolean).join('\n')
      }
    } catch (e) {
      // Teach at the point of failure: the refusal IS the receipt, said
      // where the order was given, so the next line typed is a better one.
      said = (e as Error).message
      changes.length = 0
    }
    if (!said && !changes.length) return // `:open` moves a viewport we don't have
    if (said) changes.push(...receipt(target, said))
    try {
      let t = trace()
      let out = apply(db, changes, t, via || undefined)
      cast(out)
      dispatch(out, t, (c, e) => console.warn(`obey effect ${c} —`, e))
    } catch (e) {
      console.warn('order dropped —', e)
    }
  }

// The answer, spoken where the order was: a comment on the same target,
// stamped as an event — the server talking, so it renders subordinate and
// the mail relay leaves it alone (M-4062). It still rides the bus, which
// is exactly the ack a headless asker needs.
let receipt = (target: string, body: string): Change[] => {
  let cid = crypto.randomUUID()
  return [
    { eid: cid, name: 'doc', comp: { title: '', body } },
    { eid: cid, name: 'comment', comp: { target_eid: target, event: 1 } },
  ]
}
