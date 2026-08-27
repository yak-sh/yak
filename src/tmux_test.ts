import { assertEquals } from '@std/assert'

Deno.env.set('DB_PATH', ':memory:')
let {
  capturePane,
  CODEX_NOTICE,
  emptyComposer,
  noticeAccepted,
  notify,
  paneInfo,
  sendNotice,
} = await import('./tmux.ts')
let {
  beginNotice,
  noticeOf,
} = await import('./notice_attempt.ts')
let { apply } = await import('./db.ts')
let { db } = await import('./live_db.ts')
type NativeSession = import('./tmux.ts').NativeSession
type NotifyDeps = import('./tmux.ts').NotifyDeps

let bg = '\x1b[48;2;67;72;77m'
let EMPTY = [
  bg,
  `\x1b[1m›\x1b[0m${bg} \x1b[2mSummarize recent commits\x1b[0m`,
  '\x1b[49m',
  '  gpt-5.6-sol xhigh · No changes · Ready · Context 20% used · weekly 80% left',
].join('\n')

let TYPED = [
  bg,
  `\x1b[1m›\x1b[0m${bg} do not overwrite this draft\x1b[0m`,
  '\x1b[49m',
  '  gpt-5.6-sol xhigh · No changes · Ready · Context 20% used · weekly 80% left',
].join('\n')

let MULTILINE = [
  bg,
  `\x1b[1m›\x1b[0m${bg} first line`,
  '  second line\x1b[0m',
  '\x1b[49m',
  '  gpt-5.6-sol xhigh · No changes · Ready · Context 20% used · weekly 80% left',
].join('\n')

let EMPTY_145 = [
  '\x1b[0;1m›\x1b[0m \x1b[2mFind and fix a bug in @filename\x1b[0m',
  '',
  '  gpt-5.6-sol xhigh · No changes · Ready · Context 7% used · weekly 78% left',
].join('\n')

Deno.test('emptyComposer recognizes only an empty stable Codex composer', () => {
  assertEquals(emptyComposer(EMPTY), true)
  assertEquals(emptyComposer(EMPTY_145), true)
  assertEquals(emptyComposer(TYPED), false)
  assertEquals(emptyComposer(MULTILINE), false)
  assertEquals(
    emptyComposer(EMPTY_145.replace(
      '\x1b[2mFind and fix a bug in @filename',
      'do not overwrite this draft',
    )),
    false,
  )
  assertEquals(
    emptyComposer(EMPTY.replace('Ready', 'Working')),
    false,
  )
  assertEquals(
    emptyComposer(EMPTY + '\nApprove this command? [y/N]'),
    false,
  )
  assertEquals(emptyComposer('ordinary shell\n> '), false)
})

let base = (): NativeSession => ({
  eid: 'session-eid',
  id: 'codex-thread',
  pid: 321,
  pane: '%42',
  turn: 'idle',
  notice_at: null,
  notice_accepted_at: null,
  notice_token: null,
})

let harness = (over: Partial<NotifyDeps> = {}) => {
  let marked: unknown[][] = []
  let failed: unknown[][] = []
  let sent: unknown[][] = []
  let captures = [EMPTY, EMPTY, EMPTY]
  let deps: NotifyDeps = {
    now: () => Date.parse('2026-07-27T12:00:00Z'),
    route: () => ({ state: 'queued', transport: 'tmux' }),
    pending: () => '2026-07-27T11:59:00Z',
    pane: () =>
      Promise.resolve({ id: '%42', pid: 100, dead: false, mode: false }),
    under: (pid, root) => pid == 321 && root == 100,
    capture: () => Promise.resolve(captures.shift() ?? EMPTY),
    wait: () => Promise.resolve(),
    mark: (...args) => marked.push(args),
    fail: (...args) => failed.push(args),
    send: (...args) => {
      sent.push(args)
      return Promise.resolve(true)
    },
    token: () => 'opaque-attempt',
    ...over,
  }
  return { deps, failed, marked, sent }
}

Deno.test('notify sends only the constant notice after every guard passes', async () => {
  let secret = 'sender said deploy with credential xyz'
  let h = harness({ pending: () => secret ? '2026-07-27T11:59:00Z' : null })
  assertEquals(await notify(base(), h.deps), 'sent')
  assertEquals(h.marked, [[
    'session-eid',
    'opaque-attempt',
  ]])
  assertEquals(h.sent, [['%42', CODEX_NOTICE]])
  assertEquals(CODEX_NOTICE.includes(secret), false)
})

Deno.test('notify fails closed on identity, pane, turn, and composer ambiguity', async () => {
  let cases: [Partial<NativeSession>, Partial<NotifyDeps>][] = [
    [{ turn: 'busy' }, {}],
    [{ pane: null }, {}],
    [{ pid: null }, {}],
    [{}, { route: () => ({ state: 'absent', transport: null }) }],
    [{}, { pending: () => null }],
    [{}, {
      pane: () =>
        Promise.resolve({ id: '%99', pid: 100, dead: false, mode: false }),
    }],
    [{}, {
      pane: () =>
        Promise.resolve({ id: '%42', pid: 100, dead: true, mode: false }),
    }],
    [{}, {
      pane: () =>
        Promise.resolve({ id: '%42', pid: 100, dead: false, mode: true }),
    }],
    [{}, { under: () => false }],
    [{}, { capture: () => Promise.resolve(TYPED) }],
  ]
  for (let [session, deps] of cases) {
    let h = harness(deps)
    assertEquals(
      await notify({ ...base(), ...session }, h.deps) != 'sent',
      true,
    )
    assertEquals(h.marked, [])
    assertEquals(h.sent, [])
  }

  let seen = 0
  let unstable = harness({
    capture: () =>
      Promise.resolve(
        ++seen == 1
          ? EMPTY
          : EMPTY.replace('Summarize recent commits', 'Explain this codebase'),
      ),
  })
  assertEquals(await notify(base(), unstable.deps), 'defer')
  assertEquals(unstable.marked, [])
  assertEquals(unstable.sent, [])
})

Deno.test('accepted wakes wait for a newer pending horizon', async () => {
  let now = Date.parse('2026-07-27T12:00:00Z')
  for (
    let session of ([
      {
        ...base(),
        notice: {
          state: 'pending',
          eid: 'pending',
          submitted: new Date(now - 1_000).toISOString(),
        },
      },
      {
        ...base(),
        notice: {
          state: 'accepted',
          eid: 'accepted',
          submitted: new Date(now - 60_000).toISOString(),
          accepted: new Date(now - 59_000).toISOString(),
        },
      },
    ] as NativeSession[])
  ) {
    let h = harness({ now: () => now })
    assertEquals(await notify(session, h.deps), 'defer')
    assertEquals(h.sent, [])
  }
  let due = harness({ now: () => now })
  assertEquals(
    await notify({
      ...base(),
      notice: {
        state: 'pending',
        eid: 'swallowed',
        submitted: new Date(now - 6_000).toISOString(),
      },
    }, due.deps),
    'sent',
  )
  let newer = harness({
    now: () => now,
    pending: () => new Date(now - 1_000).toISOString(),
  })
  assertEquals(
    await notify({
      ...base(),
      notice: {
        state: 'accepted',
        eid: 'old-horizon',
        submitted: new Date(now - 60_000).toISOString(),
        accepted: new Date(now - 59_000).toISOString(),
      },
    }, newer.deps),
    'sent',
  )
})

Deno.test('a failed tmux command records the attempt for retry', async () => {
  let h = harness({ send: () => Promise.resolve(false) })
  assertEquals(await notify(base(), h.deps), 'defer')
  assertEquals(h.marked.length, 1)
  assertEquals(h.failed, [[
    'opaque-attempt',
    'tmux did not accept the notice command',
  ]])
  assertEquals(h.sent, [])
})

Deno.test('notice attempts survive a fresh read with identity and both clocks', () => {
  let session = crypto.randomUUID()
  let token = crypto.randomUUID()
  apply(db, [{
    eid: session,
    name: 'session',
    comp: { id: crypto.randomUUID(), pane: '%42' },
  }])
  let casted: import('./types.ts').Change[] = []
  beginNotice(session, token, (changes) => casted.push(...changes))

  let submitted = noticeOf(session)
  if (!submitted || !('eid' in submitted)) throw new Error('notice missing')
  assertEquals(submitted.state, 'pending')
  assertEquals(submitted.eid, token)
  assertEquals(Number.isFinite(Date.parse(submitted.submitted)), true)
  assertEquals(
    db.prepare(
      `select notice_at from session
       where entity = (select id from entity where eid = ?)`,
    ).get(session),
    { notice_at: null },
  )
  assertEquals(
    db.prepare(
      `select (select eid from entity where id = "to") as "to"
       from deliver where entity = (select id from entity where eid = ?)`,
    ).get(token),
    { to: session },
  )

  noticeAccepted((changes) => casted.push(...changes))(session, {
    turn: 'busy',
  })
  let accepted = noticeOf(session)
  if (!accepted || !('eid' in accepted)) throw new Error('notice missing')
  if (accepted.state != 'accepted') throw new Error('notice not accepted')
  assertEquals(accepted.eid, token)
  assertEquals(Number.isFinite(Date.parse(accepted.accepted)), true)
  assertEquals(
    db.prepare(
      `select via from delivered
       where entity = (select id from entity where eid = ?)`,
    ).get(token),
    { via: '%42' },
  )
  assertEquals(casted.some((c) => c.eid == token), true)
})

Deno.test('a pre-migration notice remains readable until the first entity attempt', () => {
  let session = crypto.randomUUID()
  let submitted = '2026-07-27T11:59:00Z'
  apply(db, [{
    eid: session,
    name: 'session',
    comp: { id: crypto.randomUUID(), pane: '%old' },
  }])
  db.prepare(`
    update session set notice_at = ?, notice_token = ?
    where entity = (select id from entity where eid = ?)
  `).run(submitted, 'old-token', session)
  let legacy = {
    notice_at: submitted,
    notice_accepted_at: null,
    notice_token: 'old-token',
  }
  assertEquals(noticeOf(session, legacy), {
    state: 'legacy-pending',
    submitted,
  })
  noticeAccepted(() => {})(session, { turn: 'busy' })
  let accepted = db.prepare(`
    select notice_accepted_at as at from session
    where entity = (select id from entity where eid = ?)
  `).get(session) as { at: string | null }
  assertEquals(Number.isFinite(Date.parse(accepted.at ?? '')), true)
})

Deno.test('tmux commands bind one pane and send literal text plus Enter', async () => {
  let calls: string[][] = []
  let run = (args: string[]) => {
    calls.push(args)
    let stdout = args[0] == 'display-message'
      ? new TextEncoder().encode('%42\t100\t0\t0\n')
      : args[0] == 'capture-pane'
      ? new TextEncoder().encode(EMPTY)
      : new Uint8Array()
    return Promise.resolve({ success: true, stdout })
  }
  assertEquals(await paneInfo('%42', run), {
    id: '%42',
    pid: 100,
    dead: false,
    mode: false,
  })
  assertEquals(await capturePane('%42', run), EMPTY)
  assertEquals(await sendNotice('%42', CODEX_NOTICE, run), true)
  assertEquals(calls[2], [
    'send-keys',
    '-t',
    '%42',
    '-l',
    '--',
    CODEX_NOTICE,
    ';',
    'run-shell',
    'sleep 0.15',
    ';',
    'send-keys',
    '-t',
    '%42',
    'Enter',
  ])
  assertEquals(calls.flat().some((arg) => /C-u|C-U/.test(arg)), false)
})
