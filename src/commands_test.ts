// The : command line's pure half: every verb, the :open disambiguation,
// and what a bad line says. No wire, no DOM — a Ctx is just data.
import {
  type Command,
  commands,
  focusOf,
  ghost,
  run,
  suggest,
} from './commands.ts'
import { rows } from './client.ts'
import { type Snapshot } from './types.ts'
import { assertEquals, assertThrows } from '@std/assert'

let S = 'aaaaaaaa-0000-4000-8000-000000000001' // session sess-x
let P = 'aaaaaaaa-0000-4000-8000-000000000002' // project P-2
let B = 'aaaaaaaa-0000-4000-8000-000000000003' // board over P
let T = 'aaaaaaaa-0000-4000-8000-000000000004' // an open task on P
let D = 'aaaaaaaa-0000-4000-8000-000000000005' // the scribe desk task
let N = 'aaaaaaaa-0000-4000-8000-000000000006' // the scribe persona
let M = 'aaaaaaaa-0000-4000-8000-000000000007' // an inbound mail E-7
let UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-/

let snap: Snapshot = {
  changes: [
    { eid: S, name: 'entity', comp: { eid: S, num: 1, created_at: '' } },
    { eid: S, name: 'session', comp: { id: 'sess-x' } },
    { eid: P, name: 'entity', comp: { eid: P, num: 2, created_at: '' } },
    { eid: P, name: 'doc', comp: { title: 'Proj', body: '' } },
    { eid: P, name: 'project', comp: {} },
    { eid: P, name: 'repo', comp: { path: '/x', base_branch: 'main' } },
    { eid: B, name: 'entity', comp: { eid: B, num: 3, created_at: '' } },
    { eid: B, name: 'doc', comp: { title: 'Board', body: '' } },
    { eid: B, name: 'board', comp: { query: `.project_eid=${P}&.domain=Eng` } },
    { eid: T, name: 'entity', comp: { eid: T, num: 4, created_at: '' } },
    { eid: T, name: 'doc', comp: { title: 'A task', body: '' } },
    {
      eid: T,
      name: 'task',
      comp: { status: 'open', priority: 0, project_eid: P },
    },
    { eid: D, name: 'entity', comp: { eid: D, num: 5, created_at: '' } },
    { eid: D, name: 'doc', comp: { title: 'Scribe desk', body: '' } },
    { eid: D, name: 'task', comp: { status: 'open', priority: 3 } },
    { eid: D, name: 'alias', comp: { slug: 'scribe-desk' } },
    { eid: N, name: 'entity', comp: { eid: N, num: 6, created_at: '' } },
    { eid: N, name: 'doc', comp: { title: 'scribe', body: '' } },
    { eid: N, name: 'persona', comp: {} },
    { eid: N, name: 'alias', comp: { slug: 'scribe' } },
    { eid: M, name: 'entity', comp: { eid: M, num: 7, created_at: '' } },
    { eid: M, name: 'doc', comp: { title: 'Hello there', body: 'hi' } },
    {
      eid: M,
      name: 'mail',
      comp: {
        to: 'tasks@yak.sh',
        from: 'jeff@yak.sh',
        message_id: '<m1@yak.sh>',
        verified: 1,
      },
    },
  ],
  deps: [],
}
let all = rows(snap)
let ctx = (eid?: string, session?: string) => ({ eid, rows: all, session })
// A verb's changes, keyed by component — what most cases actually assert.
let comps = (line: string, eid?: string, session?: string) =>
  Object.fromEntries(
    (run(line, ctx(eid, session)).changes ?? []).map((c) => [c.name, c.comp]),
  )
Deno.test('new: a task, inheriting where you stand', () => {
  // On a board: the query's scalar equalities ride along, so it JOINS it.
  assertEquals(comps('new Ship it', B), {
    doc: { body: '', title: 'Ship it' },
    task: { status: 'open', project_eid: P, domain: 'Eng' },
  })
  assertEquals(comps('new Ship it', P).task, { status: 'open', project_eid: P })
  assertEquals(comps('new Ship it', T).task, { status: 'open', project_eid: P })
  assertEquals(comps('new Ship it').task, { status: 'open' }) // no context
  // the spec grammar tokenizes, so runs of spaces normalize to one
  assertEquals(
    run('new  Two  words ', ctx(B)).changes![0].comp!.title,
    'Two words',
  )
  // a newline (shift+enter's door) makes line 2 on the body
  assertEquals(comps('new Ship it\nwhy and how', B).doc, {
    title: 'Ship it',
    body: 'why and how',
  })
  // …and setters in the line win over what the context hands down
  assertEquals(comps('new P2 .domain=Ops Ship it', B).task, {
    status: 'open',
    project_eid: P,
    domain: 'Ops',
    priority: 2,
  })
  // One client-minted eid names the whole new entity.
  let cs = run('new Ship it', ctx(B)).changes!
  assertEquals(UUID.test(cs[0].eid), true)
  assertEquals(cs.every((c) => c.eid == cs[0].eid), true)
  assertThrows(() => run('new', ctx(B)), Error, 'needs a title')
})

Deno.test('fix: a bare id spawns, words file a task first', () => {
  // an existing task: nothing to mint, just the spawn intent
  let r = run('fix T-4', ctx())
  assertEquals(r.changes, undefined)
  assertEquals(r.spawn, T)
  // words: a task is filed and the mint IS the spawn target — with no
  // context, the sole repo-bearing project routes it (the spawn needs
  // a checkout)
  let f = run('fix the toolbar clips', ctx())
  assertEquals(f.spawn, f.changes![0].eid)
  assertEquals(
    Object.fromEntries(f.changes!.map((c) => [c.name, c.comp])).task,
    { status: 'open', project_eid: P },
  )
  // shift+enter's ask: line 2 on rides as the filed task's body
  assertEquals(comps('fix the bar clips\nrepro: shrink the window').doc, {
    title: 'the bar clips',
    body: 'repro: shrink the window',
  })
  // a worded fix is about the TOOL, not where you stand: the board's
  // context does NOT ride along (its domain stays out), and with many
  // repo projects the `home` alias names the deployment's own
  assertEquals(comps('fix Ship it', B).task, {
    status: 'open',
    project_eid: P,
  })
  let H = 'aaaaaaaa-0000-4000-8000-000000000008'
  let many = rows({
    changes: [
      ...snap.changes,
      { eid: H, name: 'entity', comp: { eid: H, num: 8, created_at: '' } },
      { eid: H, name: 'doc', comp: { title: 'Tool', body: '' } },
      { eid: H, name: 'project', comp: {} },
      { eid: H, name: 'repo', comp: { path: '/tool', base_branch: 'main' } },
      { eid: H, name: 'alias', comp: { slug: 'home' } },
    ],
  })
  let routed = run('fix Ship it', { rows: many, eid: B }).changes!
  assertEquals(
    routed.find((c) => c.name == 'task')!.comp!.project_eid,
    H, // home wins over the focused board's project
  )
  // …but a typed .project= always outranks home
  let told = run(`fix .project=${P} Ship it`, { rows: many }).changes!
  assertEquals(told.find((c) => c.name == 'task')!.comp!.project_eid, P)
  // bare :fix means HERE — the focused task is the target
  assertEquals(run('fix', ctx(T)), { spawn: T, msg: 'T-4 → agent' })
  assertThrows(() => run('fix', ctx(B)), Error, 'B-3 is not a task')
  assertThrows(() => run('fix', ctx()), Error, 'nothing focused')
  assertThrows(() => run('fix T-99', ctx()), Error, 'no such task')
})

Deno.test('status moves land on the focused task', () => {
  for (let s of ['done', 'wip', 'open']) {
    assertEquals(run(s, ctx(T)).changes, [
      { eid: T, name: 'task', comp: { status: s } },
    ])
  }
  assertEquals(run('done', ctx(T)).msg, 'T-4 → done')
  assertThrows(() => run('done', ctx(B)), Error, 'B-3 is not a task')
  assertThrows(() => run('done', ctx()), Error, 'nothing focused')
})

Deno.test('cancel: trailing words become a plain comment, same batch', () => {
  assertEquals(run('cancel', ctx(T)).changes, [
    { eid: T, name: 'task', comp: { status: 'cancelled' } },
  ])
  let why = run('cancel superseded by T-9', ctx(T, 'sess-x'))
  let [move, doc, comment] = why.changes!
  assertEquals(move, { eid: T, name: 'task', comp: { status: 'cancelled' } })
  assertEquals(doc.comp?.body, 'superseded by T-9')
  assertEquals(comment.name, 'comment')
  assertEquals(comment.comp?.target_eid, T)
  assertEquals(comment.comp?.author_eid, S) // ctx.session resolves to its row
  assertEquals(why.msg, 'T-4 → cancelled — superseded by T-9')
  assertThrows(() => run('cancel', ctx(B)), Error, 'B-3 is not a task')
})

Deno.test('open: an argument navigates, none is the status move', () => {
  assertEquals(run('open T-4', ctx()).go, T) // no focus needed to navigate
  assertEquals(run('open 4', ctx()).go, T) // bare num
  assertEquals(run(`open ${T}`, ctx()).go, T) // eid
  assertEquals(run('open B-3', ctx(T)).go, B) // argument wins over the move
  assertEquals(run('open', ctx(T)).changes![0].comp, { status: 'open' })
  assertEquals(run('open', ctx(T)).go, undefined)
  assertThrows(() => run('open T-99', ctx()), Error, 'no such entity: T-99')
})

Deno.test('claim: names a session, or takes the ambient one', () => {
  assertEquals(run('claim sess-x', ctx(T)).changes, [
    { eid: T, name: 'claim', comp: { session_eid: S } }, // known: no mint
  ])
  // An unknown session is minted, and the claim points at the new entity.
  let minted = run('claim sess-new', ctx(T)).changes!
  assertEquals(minted[0].name, 'session')
  assertEquals(minted[0].comp, { id: 'sess-new' })
  assertEquals(UUID.test(minted[0].eid), true)
  assertEquals(minted[1].comp, { session_eid: minted[0].eid })
  assertEquals(run('claim', ctx(T, 'sess-x')).changes!.length, 1) // ambient
  assertThrows(() => run('claim', ctx(T)), Error, 'name a session')
})

Deno.test('set: the write grammar, routed and grouped', () => {
  assertEquals(comps('set .status=done .priority=2', T), {
    task: { status: 'done', priority: 2 },
  })
  assertEquals(comps('set .title=two words .status=wip', T), {
    doc: { title: 'two words' }, // params start at a dot: spaces survive
    task: { status: 'wip' },
  })
  assertEquals(run('set .status=done', ctx(T)).msg, 'T-4 .status=done')
  assertThrows(() => run('set .nope=1', ctx(T)), Error, 'unknown prop')
  assertThrows(() => run('set .x=1', ctx(T)), Error, 'ambiguous')
  assertThrows(() => run('set .doc.nope=1', ctx(T)), Error, 'no such prop')
  assertThrows(() => run('set title=x', ctx(T)), Error, 'not a param: title=x')
  assertThrows(() => run('set', ctx(T)), Error, 'needs .prop=value')
})

Deno.test('dispatch: unknown names say so, local verbs ride, empty is a no-op', () => {
  assertThrows(() => run('nope', ctx(T)), Error, 'not a command: nope')
  assertEquals(run('', ctx(T)), {})
  assertEquals(run('   ', ctx(T)), {})
  let zoom: Command = {
    args: 'n',
    about: 'test',
    run: (rest) => ({ msg: `zoom ${rest}` }),
  }
  assertEquals(run('zoom 2', ctx(T), { zoom }).msg, 'zoom 2')
})

Deno.test('suggest: prefix leads, substring trails, empty lists all', () => {
  let names = (line: string) => suggest(line, commands).map(([n]) => n)
  assertEquals(names(''), Object.keys(commands))
  assertEquals(names('d')[0], 'done')
  assertEquals(names('op')[0], 'open')
  assertEquals(names('e').includes('new'), true) // substring still finds
  assertEquals(names('zzz'), [])
})

Deno.test('ghost: verb remainder, then unconsumed example args', () => {
  let g = (line: string) => ghost(line, commands)
  assertEquals(g('op'), 'en')
  assertEquals(g('open'), ' [T-42]') // verb stands: the args appear
  assertEquals(g('open '), '[T-42]')
  assertEquals(g('open T-4'), '') // the slot is being consumed
  assertEquals(g('se'), 't')
  assertEquals(g('set .status=done '), '…') // one slot down, one to go
  assertEquals(g('fix'), ' [T-42 | the toolbar clips at small widths]')
  assertEquals(g('fix T-4'), '') // the bracket group is ONE slot
  assertEquals(g('done'), '') // no args to offer
  assertEquals(g('zzz'), '')
  assertEquals(g(''), '')
})

Deno.test('focusOf: one claim is "here"; none, several, or no session is not', () => {
  let claimed = (eids: string[]) =>
    rows({
      changes: [
        ...snap.changes,
        ...eids.map((eid) => ({
          eid,
          name: 'claim',
          comp: { session_eid: S },
        })),
      ],
    })
  assertEquals(focusOf(claimed([T]), 'sess-x'), T)
  assertEquals(focusOf(claimed([]), 'sess-x'), undefined)
  assertEquals(focusOf(claimed([T, B]), 'sess-x'), undefined)
  assertEquals(focusOf(claimed([T]), 'sess-unknown'), undefined)
  assertEquals(focusOf(claimed([T]), undefined), undefined)
})

Deno.test('knock: recipient resolves, words ride as plain comment, project defaults', () => {
  let k = run('knock B-3 need it today', ctx(T, 'sess-x'))
  let [knock, doc, comment] = k.changes!
  assertEquals(knock.name, 'knock')
  assertEquals(knock.comp, { target_eid: T, to_eid: B })
  assertEquals(doc.comp?.body, 'need it today')
  assertEquals(comment.comp?.target_eid, T)
  // no recipient word: a task asks its own project
  let p = run('knock', ctx(T))
  assertEquals(p.changes![0].comp, { target_eid: T, to_eid: P })
  // a doc with no project and no name: nowhere to aim
  assertThrows(() => run('knock', ctx(B)), Error, 'name a recipient')
})

Deno.test('mail: to, subject, -- body — one letter, minted whole', () => {
  let r = run('mail jeff Lunch plans -- noon at the taco place?', ctx())
  let [doc, mail] = r.changes!
  assertEquals(doc.comp, {
    title: 'Lunch plans',
    body: 'noon at the taco place?',
  })
  assertEquals(mail.name, 'mail')
  assertEquals(mail.comp, { to: 'jeff' }) // as given: delivery resolves
  assertEquals(doc.eid, mail.eid)
  assertEquals(UUID.test(doc.eid), true)
  assertEquals(r.msg, 'mail → jeff — Lunch plans')
  assertThrows(() => run('mail jeff no fold', ctx()), Error, '-- body')
  assertThrows(() => run('mail jeff -- body', ctx()), Error, '-- body')
  assertThrows(() => run('mail', ctx()), Error, '-- body')
})

Deno.test('reply: answers the named mail — or the focused one', () => {
  let r = run('reply E-7 on it — landing today', ctx())
  let [doc, mail] = r.changes!
  assertEquals(doc.comp, {
    title: 'Re: Hello there',
    body: 'on it — landing today',
  })
  // the far side: an inbound row answers its sender, threaded at authoring
  assertEquals(mail.comp, { to: 'jeff@yak.sh', reply_to_eid: M })
  assertEquals(r.msg, 'E-7 ← reply → jeff@yak.sh')
  // standing on the mail, every word is the page
  let f = run('reply on it', ctx(M))
  assertEquals(f.changes![0].comp?.body, 'on it')
  assertEquals(f.changes![1].comp?.reply_to_eid, M)
  assertThrows(() => run('reply E-7', ctx()), Error, 'needs words')
  assertThrows(() => run('reply on it', ctx(T)), Error, 'T-4 is not a mail')
  assertThrows(() => run('reply on it', ctx()), Error, 'nothing focused')
})

Deno.test('scribe: summon the desk onto a session brief', () => {
  let out = run('scribe S-1', ctx())
  // the ask is a comment on the desk task…
  let comment = out.changes!.find((c) => c.name == 'comment')
  assertEquals(comment?.comp?.target_eid, D)
  // …and the pinned desk spawn rides the same batch
  let spawn = out.changes!.find((c) => c.name == 'session' && c.comp?.provider)
  assertEquals(spawn?.comp?.model, 'claude-haiku-4-5')
  assertEquals(spawn?.comp?.requested_task_eid, D)
  assertEquals(out.msg, 'S-1 → scribe')
  // a focused session needs no argument
  assertEquals(run('scribe', ctx(S)).msg, 'S-1 → scribe')
  // anything that isn't a session: say so
  assertThrows(() => run('scribe', ctx(T)), Error, 'name a session')
})

Deno.test('scribe: a busy desk queues the ask without a second spawn', () => {
  let W = 'aaaaaaaa-0000-4000-8000-000000000007'
  let busy = rows({
    changes: [
      ...snap.changes,
      { eid: W, name: 'entity', comp: { eid: W, num: 7, created_at: '' } },
      {
        eid: W,
        name: 'session',
        comp: { requested_task_eid: D, status: 'running' },
      },
    ],
  })
  let out = run('scribe S-1', { rows: busy })
  assertEquals(
    out.changes!.some((c) => c.name == 'session' && c.comp?.provider),
    false,
  )
  assertEquals(out.changes!.some((c) => c.name == 'comment'), true)
  assertEquals(out.msg, 'S-1 → scribe (desk busy, ask queued)')
})
