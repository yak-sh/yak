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
import { commandOut, orderIn, spawnSpec } from './commands.ts'
import { spawnDefault } from './providers.ts'
import { type Change, idOf, type Snapshot } from './types.ts'
import { find, type Row, rows, spawnChanges, spawnDefaults } from './client.ts'

type Cast = (changes: Change[]) => void

// A `:` line, run against the graph the caller holds: the batch it asks
// for, plus what to say back. Every server-side door that obeys an order
// runs THIS — a comment that opens with ':', the extension's file box —
// so the two halves commands.ts deliberately leaves undone are done once.
// Those halves are the wire (a verb returns an intent and never writes)
// and the spawn (`:fix` names a task; only the server knows what provider
// to default to).
//
// A refusal is WORDS, never a throw: the reason is the receipt, and a
// door that swallowed it would leave the typist guessing.
export let order = (
  all: Row[],
  snap: Snapshot,
  line: string,
  focus?: string,
  session?: string,
  // Routes the default transport by readiness: a comment `:fix` chooses
  // graph-native Codex only when its account is signed in, else the CLI
  // fallback. Absent means graph-native by table order (the pure-command path).
  blocked?: (name: string) => boolean,
) => {
  let changes: Change[] = []
  let said = ''
  let spawned = ''
  try {
    let out = commandOut(all, line, focus, session)
    changes.push(...(out.changes ?? []))
    said = out.msg ?? ''
    // `:fix` from a comment is the point of the whole feature — an agent
    // started by saying so where the work is discussed. The request is a
    // session entity like any other spawn; created(session) validates it,
    // so a bad one lands as a failed Session, never as a broken receipt.
    if (out.spawn) {
      // Validate the spawn against the graph AS THE COMMAND LEFT IT: a
      // spec-line `:fix` files its task in out.changes, and that fresh eid
      // must be visible or spawnChanges throws `no task` — the catch below
      // would then discard the whole order and land a bare refusal receipt.
      let after = out.changes?.length
        ? rows({ changes: [...snap.changes, ...out.changes] })
        : all
      let want = spawnSpec(out.spawn)
      let mine = spawnDefaults(all, session)
      let table = providers()
      let { provider, model } = spawnDefault(table, {
        provider: want.provider ?? mine.provider,
        model: want.model ?? (want.provider ? undefined : mine.model),
      }, blocked)
      if (!provider || !model) throw new Error('no provider to default to')
      let made = spawnChanges(after, {
        ...want,
        provider,
        model,
        by: session,
        deps: snap.deps,
      })
      changes.push(...made.changes)
      spawned = want.task ?? made.eid
      let onto = want.task ? find(after, want.task) : undefined
      said = [said, onto ? `spawned onto ${idOf(onto)}` : 'spawned chat']
        .filter(Boolean).join('\n')
    }
  } catch (e) {
    said = (e as Error).message
    changes.length = 0
  }
  return { changes, said, spawned }
}

// The author, as the vocabulary knows them: `run` wants the session's own
// id (that's how :claim names a lease and how focus resolves), while the
// journal wants whatever the writer wrote as. A comment typed in a browser
// has a client, not a session — its orders still run, minus the verbs that
// need a lease to speak of.
let speaker = (via: string) =>
  (db.prepare('select id from session where eid = ? or id = ?')
    .get(via, via) as { id: string } | undefined)?.id

export let obeyed =
  (cast: Cast, ready?: () => Promise<boolean>) =>
  async (ceid: string, comp: Record<string, unknown>) => {
    let target = String(comp.target ?? '')
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

    // Only the graph-native Codex transport is account-gated; a `:fix` here
    // routes around it to the CLI fallback when the account isn't ready.
    let ok = ready ? await ready().catch(() => false) : true
    let blocked = (name: string) => name == 'codex' && !ok

    let snap = snapshot(db)
    // Teach at the point of failure: order() hands back the refusal as
    // words, and the receipt below says them where the order was given,
    // so the next line typed is a better one.
    let { changes, said } = order(
      rows(snap),
      snap,
      line,
      target,
      session,
      blocked,
    )
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

// A RECEIPT NEVER COMMANDS — the loop's floor, and it belongs here because
// this effect both reads comments and mints them. orderIn() is the only
// thing that makes a body an order, so one leading space is the entire
// mechanism: invisible when rendered, and the first line can no longer
// open with ':'. No command's message starts that way today, which is
// precisely why the floor is structural rather than incidental — the day
// one does, the graph would obey itself forever.
export let inert = (body: string) => orderIn(body) ? ` ${body}` : body

// The answer, spoken where the order was: a comment on the same target.
// It rides the bus, which is exactly the ack a headless asker needs.
let receipt = (target: string, body: string): Change[] => {
  let cid = crypto.randomUUID()
  return [
    { eid: cid, name: 'doc', comp: { title: '', body: inert(body) } },
    { eid: cid, name: 'comment', comp: { target: target } },
  ]
}
