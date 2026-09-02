import {
  awake,
  cols,
  comps,
  deaths,
  friendly,
  nick,
  propRenames,
  renames,
  type Session,
  settled,
  stamped,
  standing,
  viewRenames,
} from './types.ts'
import { assertEquals } from '@std/assert'

Deno.test('renames: one table splits into view and prop doors by namespace', () => {
  // Every row lands in exactly one door, chosen by its `view:` namespace.
  for (let key of Object.keys(renames)) {
    let isView = key.startsWith('view:')
    assertEquals(key.slice('view:'.length) in viewRenames, isView, key)
    assertEquals(key in propRenames, !isView, key)
  }
  assertEquals(
    Object.keys(viewRenames).length + Object.keys(propRenames).length,
    Object.keys(renames).length,
  )
  // The `view:` prefix is stripped for the renderer door.
  assertEquals(viewRenames['Show'], 'Full')
  assertEquals(viewRenames['Task.Row'], 'Board.List.Tile')
  // A rename never points at itself — that would be a dead row.
  for (let [from, to] of Object.entries(renames)) {
    assertEquals(from.replace(/^view:/, '') == to, false, from)
  }
})

Deno.test('the current vocabulary carries no representation suffixes', () => {
  for (let [comp, props] of Object.entries({ ...comps, ...stamped })) {
    for (let prop of Object.keys(props)) {
      assertEquals(prop.endsWith('_eid'), false, `${comp}.${prop}`)
    }
  }
})

Deno.test('nick: the model word, vendor and versions dropped', () => {
  assertEquals(nick('claude-fable-5'), 'fable')
  assertEquals(nick('claude-opus-4-8'), 'opus')
  assertEquals(nick('claude-haiku-4-5-20251001'), 'haiku')
  assertEquals(nick('gpt-5.6-sol'), 'sol')
  assertEquals(nick('gpt-5.6-terra'), 'terra')
  assertEquals(nick(''), null)
  assertEquals(nick(null), null)
  assertEquals(nick('claude-3'), null) // nothing left to call it
})

Deno.test('friendly: the display face — caps back, dots back, pins off', () => {
  assertEquals(friendly('claude-opus-4-8'), 'Opus 4.8')
  assertEquals(friendly('claude-fable-5'), 'Fable 5')
  assertEquals(friendly('claude-haiku-4-5-20251001'), 'Haiku 4.5')
  assertEquals(friendly('sonnet'), 'Sonnet') // a short alias stays a word
  assertEquals(friendly('gpt-5.6-sol'), 'GPT 5.6 Sol')
  assertEquals(friendly('fake-fast'), 'Fake Fast')
  assertEquals(friendly(''), null)
  assertEquals(friendly(null), null)
})

// Pin the derivation to what db.ts's hand-kept AIMED and soft-detach
// lists used to say — plus the words those lists never had: sessions
// detach from a dead task/persona (the T-3685 gap), a dead client's
// shelf releases, bylines and memory provenance keep.
Deno.test('death words: every reference declares, the sets hold', () => {
  let words = (w: Parameters<typeof deaths>[0]) =>
    new Set(deaths(w).map(([c, p]) => `${c}.${p}`))
  assertEquals(
    words('cascade'),
    new Set([
      'card.target',
      'comment.target',
      // a commit row dies with the task it was landed for (M-31946 §7)
      'commit.target',
      // a notice dies with the entity it is about (D-13858)
      'notice.target',
      // both ends: a standing instruction is meaningless without the
      // actor who gave it or the thread it is about
      'subscription.actor',
      'subscription.target',
      'stop_request.target',
      'knock.target',
      'wake.target',
      // a dream is meaningless without the venture it consolidates
      'dream.scope',
      'pin.canvas',
      // a pane dies with its layout and with its container (D-14718)
      'pane.layout',
      'pane.parent',
      'camera.client',
      'camera.canvas',
      'fold.client',
      'fold.board',
      // a cursor dies with the client whose looking it records (T-12788)
      'cursor.client',
      // the lazy partition has no life after its owning Session
      'entry.session',
      // an attachment cannot survive without the content it names
      'attachment.blob',
      // the platform directory (D-32318): an app and a membership die with
      // their space, a membership with its person
      'app.space',
      'member.space',
      'member.person',
      // an edge dies with either endpoint (D-23820): the reverse-index reap
      'edge.from',
      'edge.to',
    ]),
  )
  assertEquals(
    words('detach'),
    new Set([
      'task.project',
      'task.assignee',
      'client.actor',
      // A selected chat remains session history if either side disappears;
      // only its selection coordinates detach.
      'chat.actor',
      'chat.target',
      'session.actor',
      'session.parent',
      'session.requested_task',
      'session.persona',
      // a fork lets go of its fork-point entry rather than dying with it
      'fork.from',
      'spawn.persona',
      'role.scope',
      'role.checkout',
      'role.wake_target',
      'persona.home',
      // a shown entity's death only empties its pane; a directly deleted
      // root orphans the layout rather than cascading through it
      'pane.content',
      'layout.root',
      // a space outlives the app that answered its bare hostname
      'space.home',
    ]),
  )
  assertEquals(
    words('release'),
    new Set(['claim.session', 'shelf.client']),
  )
  assertEquals(
    words('keep'),
    new Set([
      'memory.scope',
      // a goal outlives the project it guided — guidance is not the venture
      'goal.scope',
      'session.role',
      'mail.target',
      'mail.reply_to',
      'deliver.to',
      'created.by',
      'updated.by',
      // A Session log keeps correlation after the referenced entry dies.
      'generation.through',
      'output.source',
      'result.call',
      'checkpoint.through',
      'cancel.target',
      // a cursor aimed at a dead entity keeps the tombstone; nav derives a
      // nearest-live fallback at read time, never a repair write (T-12788)
      'cursor.target',
      // A recall floater keeps naming its source message and memories after
      // either dies — the dedup ledger and provenance survive.
      'recalled.source',
      // Proposal, decision, and feedback bylines outlive their tombstones.
      'decided.by',
      'proposed.by',
      'feedback.by',
      // The done/cancelled marks keep their byline past the actor's tombstone.
      'completed.by',
      'cancelled.by',
    ]),
  )
})

// The declared stamped columns must never leak into the wire allowlist —
// cols() reads comps alone, and this holds it to that.
Deno.test('stamped: declared, and still not wire-writable', () => {
  for (let [comp, props] of Object.entries(stamped)) {
    for (let col of Object.keys(props)) {
      assertEquals(
        cols(comp).includes(col),
        false,
        `${comp}.${col} leaked into the allowlist`,
      )
    }
  }
})

Deno.test('settled: done or cancelled, nothing else', () => {
  assertEquals(settled('done'), true)
  assertEquals(settled('cancelled'), true)
  assertEquals(settled('open'), false)
  assertEquals(settled('wip'), false)
  assertEquals(settled(null), false)
  assertEquals(settled(undefined), false)
})

// The client's half of door.ts `present()` — one predicate every surface
// shares (T-7461). Origin never enters it: an operator's own terminal is a
// session somebody is home in, and a managed row that ended is not.
let sess = (x: Partial<Session>): Session => ({ eid: 'e', id: 'i', ...x })

Deno.test('awake: a status says it, else an open door does', () => {
  assertEquals(awake(sess({ status: 'starting' })), true)
  assertEquals(awake(sess({ status: 'running' })), true)
  assertEquals(awake(sess({ status: 'stopping' })), true)
  // An ending stamps finished_at in the same breath as the status
  // (sessions.ts stamp()), so the two clauses never fight over a run.
  assertEquals(awake(sess({ status: 'completed', finished_at: 'x' })), false)
  assertEquals(awake(sess({ pid: 9 })), true) // an operator at the keyboard
  assertEquals(awake(sess({ pid: 9, finished_at: 'x' })), false) // a ghost
  assertEquals(awake(sess({})), false) // no pid, no run: no door
})

Deno.test('standing: an external session borrows the word from its door', () => {
  assertEquals(standing(sess({ status: 'completed' })), 'completed')
  assertEquals(standing(sess({ pid: 9 })), 'running')
  assertEquals(standing(sess({ pid: 9, finished_at: 'x' })), '') // dim again
  assertEquals(standing(sess({})), '')
})

Deno.test('standing: an awake idle turn rests without hiding its ending', () => {
  assertEquals(standing(sess({ status: 'running', turn: 'idle' })), 'idle')
  assertEquals(standing(sess({ pid: 9, turn: 'idle' })), 'idle')
  assertEquals(
    standing(sess({ status: 'completed', turn: 'idle', finished_at: 'x' })),
    'completed',
  )
})
