// A provider that isn't one: prints the JSONL an agent would print, then
// exits. It exists so the whole managed-session machine — spawn, worktree,
// detach, tail, derive, stop, recover — can be exercised end to end
// without a model, a key, or a network.
//
// It does what it's TOLD: the instruction doubles as the script. Words in
// it steer the run (that's the fake's whole nature — a real provider reads
// the instruction as work, this one reads it as stage directions):
//
//   delay:200   ms between events (default 0)
//   noise       write a line to stderr
//   malformed   emit a line that isn't JSON
//   oversize    emit a line past the tailer's 1MB ceiling
//   quiet       skip the terminal event (an agent that just stops talking)
//   fail:3      exit 3 instead of 0
//   refuse      terminally declare a known provider refusal
//   signal-ready install explicit INT/TERM handlers and announce readiness
//
// --resume marks a continuation of an existing thread: the session is
// already known, so it skips the init and just narrates on — the same
// script a resume argv drives (see adapters.ts).
//
// Run: deno run --quiet fake-provider.ts --session S --model M [--effort E] -- "…"
let arg = (flag: string) => {
  let i = Deno.args.indexOf(flag)
  return i < 0 ? undefined : Deno.args[i + 1]
}
// The instruction rides after -- (the end-of-options separator every adapter
// uses so dash-leading content can't parse as a flag). Everything before it
// is flags; everything after is the prompt, verbatim.
let end = Deno.args.indexOf('--')
let instruction = (end < 0 ? [] : Deno.args.slice(end + 1)).join(' ')

let says = (d: string) => instruction.includes(d)
let num = (d: string, fallback: number) =>
  Number(instruction.match(new RegExp(`${d}:(\\d+)`))?.[1] ?? fallback)

let delay = num('delay', 0)
let beat = () => delay ? new Promise((go) => setTimeout(go, delay)) : undefined
let say = (e: unknown) => console.log(JSON.stringify(e))

// init first (unless resuming — the thread already exists): `delay:N` is how
// a test keeps a session RUNNING, so it must announce itself before it dawdles.
if (!Deno.args.includes('--resume')) {
  say({
    type: 'init',
    session_id: arg('--session'),
    model: arg('--model'),
    effort: arg('--effort') ?? null,
  })
}
if (says('signal-ready')) {
  // The readiness line is emitted only after both handlers exist. Lifecycle
  // tests can therefore cancel on an observed provider boundary rather than
  // guessing that a freshly exec'd runtime has reached signal dispatch.
  Deno.addSignalListener('SIGINT', () => Deno.exit(130))
  Deno.addSignalListener('SIGTERM', () => Deno.exit(143))
  say({ type: 'message', role: 'assistant', text: 'signal-ready' })
}
await beat()
say({ type: 'message', role: 'assistant', text: `working: ${instruction}` })
if (says('report-role-env')) {
  say({
    type: 'message',
    role: 'assistant',
    text: `role:${Deno.env.get('TASKS_ROLE') ?? ''}`,
  })
}
if (says('noise')) console.error('fake: stderr noise')
await beat()
say({ type: 'tool', name: 'read', input: { path: 'README.md' } })
if (says('malformed')) console.log('{"type":"message", this is not json')
if (says('oversize')) say({ type: 'message', text: 'x'.repeat(1_100_000) })
await beat()
if (!says('quiet')) {
  say({
    type: 'result',
    final_text: `done: ${instruction}`,
    ...(says('refuse') ? { error: 'provider refused' } : {}),
    usage: { input_tokens: 12, output_tokens: 34 },
  })
}
Deno.exit(num('fail', 0))
