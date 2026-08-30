// The : command line's pure half: every verb, the :open disambiguation,
// and what a bad line says. No wire, no DOM — a Ctx is just data.
import {
  cardCommands,
  type Command,
  commands,
  focusOf,
  ghost,
  orderIn,
  run,
  suggest,
} from './commands.ts'
import { cascade, inflate, rows } from './client.ts'
import { type Snapshot } from './types.ts'
import { text } from './verb.ts'
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
    { eid: S, name: 'entity', comp: { eid: S, num: 1 } },
    { eid: S, name: 'session', comp: { id: 'sess-x' } },
    { eid: P, name: 'entity', comp: { eid: P, num: 2 } },
    { eid: P, name: 'doc', comp: { title: 'Proj', body: '' } },
    { eid: P, name: 'project', comp: {} },
    { eid: P, name: 'repo', comp: { path: '/x', base_branch: 'main' } },
    { eid: B, name: 'entity', comp: { eid: B, num: 3 } },
    { eid: B, name: 'doc', comp: { title: 'Board', body: '' } },
    { eid: B, name: 'board', comp: { query: `.project=${P}&.domain=Eng` } },
    { eid: T, name: 'entity', comp: { eid: T, num: 4 } },
    { eid: T, name: 'doc', comp: { title: 'A task', body: '' } },
    {
      eid: T,
      name: 'task',
      comp: { priority: 0, project: P },
    },
    { eid: D, name: 'entity', comp: { eid: D, num: 5 } },
    { eid: D, name: 'doc', comp: { title: 'Scribe desk', body: '' } },
    { eid: D, name: 'task', comp: { priority: 3 } },
    { eid: D, name: 'alias', comp: { slug: 'scribe-desk' } },
    { eid: N, name: 'entity', comp: { eid: N, num: 6 } },
    { eid: N, name: 'doc', comp: { title: 'scribe', body: '' } },
    { eid: N, name: 'persona', comp: {} },
    { eid: N, name: 'alias', comp: { slug: 'scribe' } },
    { eid: M, name: 'entity', comp: { eid: M, num: 7 } },
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

Deno.test('basic card commands mint the smallest editable entities', () => {
  let expected: Record<string, Record<string, unknown>[]> = {
    task: [{ title: '', body: '' }, {}],
    session: [{ id: '' }],
    doc: [{ title: '', body: '' }],
    memory: [{ title: '', body: '' }, { scope: null }],
  }
  for (let name of cardCommands) {
    let made = run(name, ctx())
    assertEquals(made.card, made.changes![0].eid)
    assertEquals(made.changes!.every((c) => c.eid == made.card), true)
    assertEquals(
      made.changes!.map((c) =>
        name == 'session' ? { ...c.comp, id: '' } : c.comp
      ),
      expected[name],
    )
    assertEquals(UUID.test(made.card!), true)
    if (name == 'session') {
      assertEquals(UUID.test(String(made.changes![0].comp!.id)), true)
    }
  }
})

Deno.test('basic card properties use the standard dot-param grammar', () => {
  // status is derived (D-24102): a `.status=` on a card mint is dropped, not
  // written — the honest path to wip is a claim.
  assertEquals(comps('task .title=Next step .priority=2 .status=wip'), {
    doc: { title: 'Next step', body: '' },
    task: { priority: 2 },
  })
  assertEquals(comps('session .id=review'), { session: { id: 'review' } })
  assertEquals(comps('doc .title=Notes .body=some words'), {
    doc: { title: 'Notes', body: 'some words' },
  })
  assertEquals(comps('memory .title=Lesson .memory.scope=P-2'), {
    doc: { title: 'Lesson', body: '' },
    memory: { scope: 'P-2' },
  })
  assertThrows(() => run('doc words', ctx()), Error, 'not a param')
  assertThrows(() => run('doc .status=open', ctx()), Error, 'cannot set task')
  assertThrows(
    () => run('task .session.id=review Ship it', ctx()),
    Error,
    'cannot set session',
  )
})

Deno.test('session cards inherit missing configuration, never run state', () => {
  let source = structuredClone(snap)
  source.changes.find((c) => c.eid == S && c.name == 'session')!.comp = {
    id: 'sess-x',
    cwd: '/worktree',
    provider: 'codex',
    model: 'gpt-source',
    effort: 'high',
    actor: P,
    status: 'running',
    transcript: '/tmp/source.jsonl',
    latest_seq: 42,
  }
  let made = run('session .model=gpt-override .effort=', {
    eid: S,
    rows: rows(source),
  })
  let session = made.changes![0].comp!
  assertEquals(session.provider, 'codex')
  assertEquals(session.model, 'gpt-override')
  assertEquals(session.effort, '')
  assertEquals(session.cwd, '/worktree')
  assertEquals(session.actor, P)
  assertEquals('status' in session, false)
  assertEquals('transcript' in session, false)
  assertEquals('latest_seq' in session, false)

  let called = run('session', { rows: rows(source), session: 'sess-x' })
  assertEquals(called.changes![0].comp?.provider, 'codex')
})

Deno.test('task cards take their title first and body below', () => {
  let made = run('task Ship it\nwhy and how', ctx(B))
  assertEquals(comps('task Ship it\nwhy and how', B), {
    doc: { title: 'Ship it', body: 'why and how' },
    task: {},
  })
  assertEquals(made.card, made.changes![0].eid)
  assertEquals(made.spawn, undefined)
})

Deno.test('new: a task, inheriting where you stand', () => {
  // On a board: the query's scalar equalities ride along, so it JOINS it.
  assertEquals(comps('new Ship it', B), {
    doc: { body: '', title: 'Ship it' },
    task: { project: P, domain: 'Eng' },
  })
  assertEquals(comps('new Ship it', P).task, { project: P })
  assertEquals(comps('new Ship it', T).task, { project: P })
  assertEquals(comps('new Ship it').task, {}) // no context
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
    project: P,
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
    { project: P },
  )
  // shift+enter's ask: line 2 on rides as the filed task's body
  assertEquals(comps('fix the bar clips\nrepro: shrink the window').doc, {
    title: 'the bar clips',
    body: 'repro: shrink the window',
  })
  // a worded fix is about the TOOL, not where you stand: the board's
  // context does NOT ride along (its domain stays out), and with many
  // repo projects the `tasks` venture alias names the deployment's own
  assertEquals(comps('fix Ship it', B).task, {
    project: P,
  })
  let H = 'aaaaaaaa-0000-4000-8000-000000000008'
  let many = rows({
    changes: [
      ...snap.changes,
      { eid: H, name: 'entity', comp: { eid: H, num: 8 } },
      { eid: H, name: 'doc', comp: { title: 'Tool', body: '' } },
      { eid: H, name: 'project', comp: {} },
      { eid: H, name: 'repo', comp: { path: '/tool', base_branch: 'main' } },
      { eid: H, name: 'alias', comp: { slug: 'tasks' } },
    ],
  })
  let routed = run('fix Ship it', { rows: many, eid: B }).changes!
  assertEquals(
    routed.find((c) => c.name == 'task')!.comp!.project,
    H, // the canonical venture wins over the focused board's project
  )
  // …but a typed .project= always outranks the deployment identity
  let told = run(`fix .project=${P} Ship it`, { rows: many }).changes!
  assertEquals(told.find((c) => c.name == 'task')!.comp!.project, P)
  // bare :fix means HERE — the focused task is the target
  assertEquals(run('fix', ctx(T)), { spawn: T, msg: 'T-4 → agent' })
  assertThrows(() => run('fix', ctx(B)), Error, 'B-3 is not a task')
  assertThrows(() => run('fix', ctx()), Error, 'nothing focused')
  assertThrows(() => run('fix T-99', ctx()), Error, 'no such task')
})

Deno.test('status moves land on the focused task', () => {
  // Status is DERIVED (D-24102): the moves mint/retract marks, never a task
  // write. `done` wears `completed`; `open` retracts both marks.
  assertEquals(run('done', ctx(T)).changes, [
    { eid: T, name: 'cancelled', comp: null },
    { eid: T, name: 'completed', comp: {} },
  ])
  assertEquals(run('open', ctx(T)).changes, [
    { eid: T, name: 'completed', comp: null },
    { eid: T, name: 'cancelled', comp: null },
    { eid: T, name: 'claim', comp: null },
  ])
  // wip is a guarded live claim, never a raw claim batch.
  assertEquals(run('wip', ctx(T, 'sess-x')).mutation, {
    mutation: 'claim_work',
    target: T,
    session: 'sess-x',
    mode: 'ready',
  })
  assertThrows(() => run('wip', ctx(T)), Error, 'run under a session')
  assertEquals(run('done', ctx(T)).msg, 'T-4 → done')
  assertThrows(() => run('done', ctx(B)), Error, 'B-3 is not a task')
  assertThrows(() => run('done', ctx()), Error, 'nothing focused')
  assertThrows(() => run('done because', ctx(T)), Error, 'usage :done')
})

Deno.test('chat starts a taskless model with an optional multiline prompt', () => {
  assertEquals(run('chat', ctx()), {
    spawn: { provider: 'codex' },
    msg: 'chat → agent',
  })
  assertEquals(run('chat Explain this\nwith examples', ctx()), {
    spawn: { provider: 'codex', prompt: 'Explain this\nwith examples' },
    msg: 'chat → agent',
  })
  assertEquals(run('chat .model=kimi-k2.7-code Why?', ctx()), {
    spawn: { prompt: 'Why?', model: 'kimi-k2.7-code' },
    msg: 'chat → agent',
  })
  assertEquals(
    run(
      'chat .provider=codex .model=gpt-5.6-sol .effort=high Why?\nGo deep',
      ctx(),
    ),
    {
      spawn: {
        prompt: 'Why?\nGo deep',
        provider: 'codex',
        model: 'gpt-5.6-sol',
        effort: 'high',
      },
      msg: 'chat → agent',
    },
  )
  assertThrows(
    () => run('chat .status=done Why?', ctx()),
    Error,
    'chat: cannot set task',
  )
  assertThrows(
    () => run('chat .persona=nobody Why?', ctx()),
    Error,
    'no entity: nobody',
  )
})

Deno.test('comment writes on the focus and reads the shell body convention', () => {
  let inline = run('comment please include the migration', ctx(T, 'sess-x'))
  assertEquals(
    inline.changes!.find((c) => c.name == 'comment')!.comp,
    { target: T },
  )
  assertEquals(
    inline.changes!.find((c) => c.name == 'doc')!.comp?.body,
    'please include the migration',
  )
  assertEquals(inline.msg, 'comment → T-4')

  let heredoc = run('comment .body=@-', {
    ...ctx(T, 'sess-x'),
    read: (p) => ({ ...p, value: 'the whole review\n' }),
  })
  assertEquals(
    heredoc.changes!.find((c) => c.name == 'doc')!.comp?.body,
    'the whole review\n',
  )
  assertThrows(() => run('comment', ctx(T)), Error, 'needs words')
  assertThrows(
    () => run('comment .title=nope', ctx(T)),
    Error,
    'cannot set doc.title',
  )
})

Deno.test('cancel: trailing words become a plain comment, same batch', () => {
  assertEquals(run('cancel', ctx(T)).changes, [
    { eid: T, name: 'completed', comp: null },
    { eid: T, name: 'cancelled', comp: {} },
  ])
  let why = run('cancel superseded by T-9', ctx(T, 'sess-x'))
  let move = why.changes!.find((c) => c.name == 'cancelled')!
  let doc = why.changes!.find((c) => c.name == 'doc')!
  let comment = why.changes!.find((c) => c.name == 'comment')!
  // the `cancelled` mark IS the status now, its optional reason on the comp
  assertEquals(move, {
    eid: T,
    name: 'cancelled',
    comp: { reason: 'superseded by T-9' },
  })
  assertEquals(doc.comp?.body, 'superseded by T-9')
  assertEquals(comment.name, 'comment')
  assertEquals(comment.comp?.target, T)
  assertEquals(comment.comp, { target: T })
  assertEquals(why.msg, 'T-4 → cancelled — superseded by T-9')
  assertThrows(() => run('cancel', ctx(B)), Error, 'B-3 is not a task')
})

Deno.test('meta: anchors on the newest message entry and tags the comment', () => {
  // Two message entries for the session, plus a bare (non-message) entry with
  // the highest seq — the anchor is the newest MESSAGE, not the newest entry.
  let e1 = 'aaaaaaaa-0000-4000-8000-0000000000e1'
  let e2 = 'aaaaaaaa-0000-4000-8000-0000000000e2'
  let e3 = 'aaaaaaaa-0000-4000-8000-0000000000e3'
  let withEntries = rows({
    changes: [
      ...snap.changes,
      { eid: e1, name: 'entry', comp: { session: S, seq: 1 } },
      { eid: e1, name: 'message', comp: { role: 'user' } },
      { eid: e2, name: 'entry', comp: { session: S, seq: 2 } },
      { eid: e2, name: 'message', comp: { role: 'assistant' } },
      { eid: e3, name: 'entry', comp: { session: S, seq: 3 } },
    ],
  })
  let out = run('meta the retry path here is a tooling gap', {
    rows: withEntries,
    session: 'sess-x',
  })
  let comment = out.changes!.find((c) => c.name == 'comment')!
  let doc = out.changes!.find((c) => c.name == 'doc')!
  let tag = out.changes!.find((c) => c.name == 'meta')!
  assertEquals(comment.comp!.target, e2) // newest MESSAGE, not e3
  assertEquals(doc.comp!.body, 'the retry path here is a tooling gap')
  assertEquals(tag.eid, comment.eid) // the tag rides the comment entity
  assertEquals(tag.comp, {})
  assertEquals(out.msg!.startsWith('meta → '), true)

  // A session with no message entry yet falls back to the session itself.
  let bare = run('meta first note', { rows: all, session: 'sess-x' })
  assertEquals(bare.changes!.find((c) => c.name == 'comment')!.comp!.target, S)

  assertThrows(() => run('meta hi', ctx()), Error, 'run under a session')
  assertThrows(() => run('meta', ctx(T, 'sess-x')), Error, 'needs words')
})

Deno.test('open: an argument navigates, none is the status move', () => {
  assertEquals(run('open T-4', ctx()).go, T) // no focus needed to navigate
  assertEquals(run('open 4', ctx()).go, T) // bare num
  assertEquals(run(`open ${T}`, ctx()).go, T) // eid
  assertEquals(run('open B-3', ctx(T)).go, B) // argument wins over the move
  assertEquals(run('open', ctx(T)).changes![0].comp, null) // retracts the mark
  assertEquals(run('open', ctx(T)).go, undefined)
  assertThrows(() => run('open T-99', ctx()), Error, 'no such entity: T-99')
  assertThrows(() => run('open T-4 extra', ctx()), Error, 'usage :open [id]')
})

Deno.test('claim: names a session, or takes the ambient one', () => {
  assertEquals(run('claim sess-x', ctx(T)).mutation, {
    mutation: 'claim_work',
    target: T,
    session: 'sess-x',
    mode: 'ready',
  })
  assertEquals(run('claim sess-new', ctx(T)).mutation?.session, 'sess-new')
  assertEquals(run('claim', ctx(T, 'sess-x')).mutation?.session, 'sess-x')
  assertThrows(() => run('claim', ctx(T)), Error, 'name a session')
  assertThrows(
    () => run('claim sess-x extra', ctx(T)),
    Error,
    'usage :claim [session]',
  )
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

// The door's value convention, not the verb's: a shell hands in inflate
// and `.body=@file` is the file — the same reading `task set` gives it.
// A door without a filesystem hands in nothing and the value is literal,
// which is what keeps an MCP caller from reading the server's disk.
Deno.test('set/new: @file rides ctx.read, and only where a door has one', () => {
  let f = Deno.makeTempFileSync()
  Deno.writeTextFileSync(f, 'the whole brief\n')
  let shell = { ...ctx(T), read: inflate }
  assertEquals(
    run(`set .body=@${f}`, shell).changes![0].comp,
    { body: 'the whole brief\n' },
  )
  // no reader: the literal path, exactly as typed
  assertEquals(run(`set .body=@${f}`, ctx(T)).changes![0].comp, {
    body: `@${f}`,
  })
  // @@ is the escape, both ways
  assertEquals(run('set .body=@@x', shell).changes![0].comp, { body: '@x' })
  // a plain value is untouched
  assertEquals(run('set .title=two words', shell).changes![0].comp, {
    title: 'two words',
  })
  // :new speaks the same convention through spec()
  assertEquals(
    run(`new Ship it .body=@${f}`, { ...ctx(B), read: inflate }).changes![0]
      .comp!.body,
    'the whole brief\n',
  )
  // a missing file is LOUD — never the literal path over the old value
  assertThrows(
    () => run('set .body=@/no/such/file', shell),
    Error,
    'no such file',
  )
  Deno.removeSync(f)
})

Deno.test('dispatch: unknown names say so, local verbs ride, empty is a no-op', () => {
  assertThrows(() => run('nope', ctx(T)), Error, 'not a command: nope')
  assertEquals(run('', ctx(T)), {})
  assertEquals(run('   ', ctx(T)), {})
  let zoom: Command = {
    args: [{ name: 'n', kind: text }],
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

Deno.test('ghost: verb remainder, then unconsumed sample args', () => {
  let g = (line: string) => ghost(line, commands)
  assertEquals(g('op'), 'en')
  assertEquals(g('open'), ' T-42') // verb stands: the sample slots appear
  assertEquals(g('open '), 'T-42')
  assertEquals(g('open T-4'), '') // the slot is being consumed
  assertEquals(g('se'), 't')
  assertEquals(g('set .status=done '), '…') // one slot down, one to go
  assertEquals(g('fix'), ' T-42 | the toolbar clips at small widths')
  assertEquals(g('fix T-4'), '') // the whole sample is ONE slot
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
          comp: { session: S },
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
  let knock = k.changes!.find((c) => c.name == 'knock')!
  let deliver = k.changes!.find((c) => c.name == 'deliver')!
  let doc = k.changes!.find((c) => c.name == 'doc')!
  let comment = k.changes!.find((c) => c.name == 'comment')!
  assertEquals(knock.comp, { target: T }) // the subject
  assertEquals(deliver.comp, { to: B }) // WHO — the shared deliver.to
  assertEquals(doc.comp?.body, 'need it today')
  assertEquals(comment.comp?.target, T)
  // no recipient word: a task asks its own project
  let p = run('knock', ctx(T))
  assertEquals(p.changes![0].comp, { target: T })
  assertEquals(p.changes![1].comp, { to: P })
  // a doc with no project and no name: nowhere to aim
  assertThrows(() => run('knock', ctx(B)), Error, 'name a recipient')
})

// T-10905: an unresolvable first word used to fall through to the project
// default AND ride into the body, so the caller got a success-looking
// receipt while their recipient was never asked and the message opened
// with a stray token. Any word given must name someone.
Deno.test('knock: an unresolvable recipient is refused, never made body', () => {
  assertThrows(
    () => run('knock definitely-not-an-actor hello', ctx(T)),
    Error,
    'no such recipient: definitely-not-an-actor',
  )
  // even alone — a lone word is still an address, not prose
  assertThrows(
    () => run('knock tasks', ctx(T)),
    Error,
    'no such recipient: tasks',
  )
  // the bare form is untouched: nothing was said, so nothing is mistaken.
  // WHO to knock rides the shared deliver.to now (D-14945).
  let bare = run('knock', ctx(T)).changes!
  assertEquals(bare[0].comp, { target: T })
  assertEquals(bare[1].comp, { to: P })
})

Deno.test('wake: who, when, and a trailing id is what to look at', () => {
  let r = run('wake B-3 in 60m T-4', ctx(P, 'sess-x'))
  let [wake, deliver] = r.changes!
  assertEquals(r.changes!.map((c) => c.name), ['wake', 'deliver'])
  assertEquals(deliver.comp?.to, B) // WHO to wake — the shared deliver.to
  assertEquals(wake.comp?.target, T) // the trailing id wins the subject
  // the phrase resolves HERE, at mint — an hour out, within the second
  let at = Date.parse(String(wake.comp?.at))
  assertEquals(Math.abs(at - (Date.now() + 3_600_000)) < 1000, true)
  // no trailing id: where you stand is what to look at
  assertEquals(
    run('wake B-3 9am tomorrow', ctx(T)).changes![0].comp?.target,
    T,
  )
  // …and standing nowhere, the wake is its own subject
  assertEquals(
    run('wake B-3 8pm', ctx()).changes![0].comp?.target,
    undefined,
  )
  assertThrows(() => run('wake', ctx(T)), Error, 'name who to wake')
  // A present-but-unresolved who is a lookup miss, not a missing argument — say
  // so, the sibling of knock's "no such recipient", instead of the generic
  // usage that sent the reader hunting for a syntax error (T-13972).
  assertThrows(
    () => run('wake tasks in 60m', ctx(T)),
    Error,
    'no such recipient: tasks',
  )
  assertThrows(() => run('wake B-3 whenever', ctx(T)), Error, 'when is')
  // A `-- note` folds a note onto the wake (like :mail's `-- body`); the head
  // before it is the ordinary who/when/target sentence.
  let n = run('wake B-3 in 60m T-4 -- mid the mail-loop port', ctx(P))
  assertEquals(n.changes![0].comp?.target, T)
  assertEquals(n.changes![0].comp?.note, 'mid the mail-loop port')
})

Deno.test('mail: to, subject, -- body — one letter, minted whole', () => {
  let r = run('mail jeff Lunch plans -- noon at the taco place?', ctx())
  let [doc, deliver, mail] = r.changes!
  assertEquals(doc.comp, {
    title: 'Lunch plans',
    body: 'noon at the taco place?',
  })
  assertEquals(deliver.comp, { to: 'jeff' }) // as given: delivery resolves
  assertEquals(mail.name, 'mail')
  assertEquals(mail.comp, {})
  assertEquals(doc.eid, mail.eid)
  assertEquals(UUID.test(doc.eid), true)
  assertEquals(r.msg, 'mail → jeff — Lunch plans')
  assertThrows(() => run('mail jeff no fold', ctx()), Error, '-- body')
  assertThrows(() => run('mail jeff -- body', ctx()), Error, '-- body')
  assertThrows(() => run('mail', ctx()), Error, '-- body')
})

Deno.test('reply: answers the named mail — or the focused one', () => {
  let r = run('reply E-7 on it — landing today', ctx())
  let [doc, deliver, mail] = r.changes!
  assertEquals(doc.comp, {
    title: 'Re: Hello there',
    body: 'on it — landing today',
  })
  // the far side: an inbound row answers its sender, threaded at authoring.
  // WHERE it goes is the shared deliver.to; the thread stays on mail.
  assertEquals(deliver.comp, { to: 'jeff@yak.sh' })
  assertEquals(mail.comp, { reply_to: M })
  assertEquals(r.msg, 'E-7 ← reply → jeff@yak.sh')
  // standing on the mail, every word is the page
  let f = run('reply on it', ctx(M))
  assertEquals(f.changes![0].comp?.body, 'on it')
  assertEquals(f.changes![2].comp?.reply_to, M)
  assertThrows(() => run('reply E-7', ctx()), Error, 'needs words')
  assertThrows(() => run('reply on it', ctx(T)), Error, 'T-4 is not a mail')
  assertThrows(() => run('reply on it', ctx()), Error, 'nothing focused')
})

// A letter's page speaks the door's @ convention wherever the door HAS a
// filesystem — the shell and the TUI hand `read` in, the web bar and MCP
// don't and stay literal (T-10461).
Deno.test('mail/reply: a lone @file is the page, only where read is given', () => {
  let f = Deno.makeTempFileSync()
  Deno.writeTextFileSync(f, 'the whole letter\n')
  let read = (
    p: { comp: string; prop: string; value: unknown },
    _io?: unknown,
    as?: string,
  ) => inflate(p, { terminal: () => true, read: () => '' }, as)
  let withDisk = { ...ctx(), read }
  assertEquals(
    run(`reply E-7 @${f}`, withDisk).changes![0].comp?.body,
    'the whole letter\n',
  )
  assertEquals(
    run(`mail jeff subject -- @${f}`, withDisk).changes![0].comp?.body,
    'the whole letter\n',
  )
  // no filesystem behind the door: the path stays the words it typed
  assertEquals(run(`reply E-7 @${f}`, ctx()).changes![0].comp?.body, `@${f}`)
  // prose is prose, quoted or not — and @@ escapes a one-word @
  assertEquals(
    run('reply E-7 @jeff thanks for the note', withDisk).changes![0].comp?.body,
    '@jeff thanks for the note',
  )
  assertEquals(
    run('reply E-7 @@handle', withDisk).changes![0].comp?.body,
    '@handle',
  )
  // the refusal names the token typed, never a `.body=` this door lacks
  assertThrows(
    () => run('reply E-7 @/no/such/file', withDisk),
    Error,
    '@/no/such/file: no such file',
  )
  Deno.removeSync(f)
})

Deno.test('scribe: summon the desk onto a session brief', () => {
  let out = run('scribe S-1', ctx())
  // the ask is a comment on the desk task…
  let comment = out.changes!.find((c) => c.name == 'comment')
  assertEquals(comment?.comp?.target, D)
  // …and the pinned desk spawn rides the same batch
  let spawn = out.changes!.find((c) => c.name == 'session' && c.comp?.provider)
  assertEquals(spawn?.comp?.model, 'haiku')
  assertEquals(spawn?.comp?.requested_task, D)
  assertEquals(out.msg, 'S-1 → scribe')
  // a focused session needs no argument
  assertEquals(run('scribe', ctx(S)).msg, 'S-1 → scribe')
  // anything that isn't a session: say so
  assertThrows(() => run('scribe', ctx(T)), Error, 'name a session')
  assertThrows(
    () => run('scribe S-1 extra', ctx()),
    Error,
    'usage :scribe [session]',
  )
})

Deno.test('scribe: a busy desk queues the ask without a second spawn', () => {
  let W = 'aaaaaaaa-0000-4000-8000-000000000007'
  let busy = rows({
    changes: [
      ...snap.changes,
      { eid: W, name: 'entity', comp: { eid: W, num: 7 } },
      {
        eid: W,
        name: 'session',
        comp: { requested_task: D, status: 'running' },
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

// The rule both ends of the vocabulary read: the effect that RUNS a
// comment's order, and the composer that completes one as it's typed.
Deno.test('only a first line that opens with a colon is an order', () => {
  assertEquals(orderIn(':done'), ':done')
  assertEquals(
    orderIn(':fix the toolbar clips\n\nand here is why'),
    ':fix the toolbar clips',
  )
  assertEquals(orderIn(' :done'), '') // a leading space escapes it
  assertEquals(orderIn('sure: done'), '')
  assertEquals(orderIn('the plan:\n:done'), '') // only the FIRST line commands
  assertEquals(orderIn(': done'), '') // a colon alone is punctuation
})

// A tiny graph where one comment (C-41) is aimed at one task (T-40): the
// single dependent the cascade would take, so the guard has something to see.
let X = 'aaaaaaaa-0000-4000-8000-0000000000a1'
let C = 'aaaaaaaa-0000-4000-8000-0000000000a2'
let aimed = rows({
  changes: [
    { eid: X, name: 'entity', comp: { eid: X, num: 40 } },
    { eid: X, name: 'doc', comp: { title: 'target', body: '' } },
    { eid: X, name: 'task', comp: {} },
    { eid: C, name: 'entity', comp: { eid: C, num: 41 } },
    { eid: C, name: 'doc', comp: { title: '', body: 'aimed at T-40' } },
    { eid: C, name: 'comment', comp: { target: X } },
  ],
})

Deno.test('cascade: the aimed closure over rows in hand, minus the target', () => {
  assertEquals(cascade(aimed, X).map((r) => r.eid), [C]) // the comment rides
  assertEquals(cascade(aimed, C), []) // a leaf takes nothing with it
})

Deno.test('delete/forget: leaf goes quietly, a target with dependents guards', () => {
  let at = (line: string, eid?: string) => run(line, { eid, rows: aimed })
  // The comment is a leaf: bare :delete tombstones it, one entity-null change.
  assertEquals(at('delete', C).changes, [{
    eid: C,
    name: 'entity',
    comp: null,
  }])
  // The task has a dependent comment — bare delete REFUSES and names it.
  assertThrows(() => at('delete', X), Error, 'C-41')
  assertThrows(() => at('delete', X), Error, '--cascade')
  // --cascade (or --force) takes it; the change is still just the target's own
  // death — apply() synthesizes the cascade victims server-side.
  assertEquals(at('delete --cascade', X).changes, [
    { eid: X, name: 'entity', comp: null },
  ])
  assertEquals(at('delete --force', X).msg, 'deleted T-40 (+1 dependent)')
  // forget is the same verb; a named human id resolves without a focus.
  assertEquals(at('forget T-40 --force').changes, [
    { eid: X, name: 'entity', comp: null },
  ])
  // A leaf named by id needs no flag and reports no collateral.
  assertEquals(at('forget C-41').msg, 'deleted C-41')
  // An unknown id teaches at the door rather than deleting nothing silently.
  assertThrows(() => at('delete T-999'), Error, 'no entity')
})
