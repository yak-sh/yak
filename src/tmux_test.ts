import { assertEquals } from '@std/assert'

Deno.env.set('DB_PATH', ':memory:')
let {
  capturePane,
  CODEX_NOTICE,
  emptyComposer,
  notify,
  paneInfo,
  sendNotice,
} = await import('./tmux.ts')
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

Deno.test('emptyComposer recognizes only an empty stable Codex composer', () => {
  assertEquals(emptyComposer(EMPTY), true)
  assertEquals(emptyComposer(TYPED), false)
  assertEquals(emptyComposer(MULTILINE), false)
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
})

let harness = (over: Partial<NotifyDeps> = {}) => {
  let marked: unknown[][] = []
  let sent: unknown[][] = []
  let captures = [EMPTY, EMPTY, EMPTY]
  let deps: NotifyDeps = {
    now: () => Date.parse('2026-07-27T12:00:00Z'),
    route: () => ({ state: 'queued', transport: 'tmux' }),
    pending: () => true,
    pane: () =>
      Promise.resolve({ id: '%42', pid: 100, dead: false, mode: false }),
    under: (pid, root) => pid == 321 && root == 100,
    capture: () => Promise.resolve(captures.shift() ?? EMPTY),
    wait: () => Promise.resolve(),
    mark: (...args) => marked.push(args),
    send: (...args) => {
      sent.push(args)
      return Promise.resolve(true)
    },
    token: () => 'opaque-attempt',
    ...over,
  }
  return { deps, marked, sent }
}

Deno.test('notify sends only the constant notice after every guard passes', async () => {
  let secret = 'sender said deploy with credential xyz'
  let h = harness({ pending: () => !!secret })
  assertEquals(await notify(base(), h.deps), 'sent')
  assertEquals(h.marked, [[
    'session-eid',
    '2026-07-27T12:00:00.000Z',
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
    [{}, { pending: () => false }],
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

Deno.test('submitted and accepted attempts use bounded retry windows', async () => {
  let now = Date.parse('2026-07-27T12:00:00Z')
  for (
    let session of [
      {
        ...base(),
        notice_at: new Date(now - 1_000).toISOString(),
      },
      {
        ...base(),
        notice_at: new Date(now - 60_000).toISOString(),
        notice_accepted_at: new Date(now - 59_000).toISOString(),
      },
    ]
  ) {
    let h = harness({ now: () => now })
    assertEquals(await notify(session, h.deps), 'defer')
    assertEquals(h.sent, [])
  }
  let due = harness({ now: () => now })
  assertEquals(
    await notify({
      ...base(),
      notice_at: new Date(now - 6_000).toISOString(),
    }, due.deps),
    'sent',
  )
})

Deno.test('a failed tmux command keeps the opaque submitted attempt for retry', async () => {
  let h = harness({ send: () => Promise.resolve(false) })
  assertEquals(await notify(base(), h.deps), 'defer')
  assertEquals(h.marked.length, 1)
  assertEquals(h.sent, [])
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
    'send-keys',
    '-t',
    '%42',
    'Enter',
  ])
  assertEquals(calls.flat().some((arg) => /C-u|C-U/.test(arg)), false)
})
