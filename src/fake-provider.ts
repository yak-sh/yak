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
//
// Run: deno run --quiet fake-provider.ts --session S --model M [--effort E] "…"
let arg = (flag: string) => {
  let i = Deno.args.indexOf(flag)
  return i < 0 ? undefined : Deno.args[i + 1]
}
let instruction = Deno.args.filter((a) => !a.startsWith('--'))
  .filter((a) =>
    ![arg('--session'), arg('--model'), arg('--effort')].includes(a)
  )
  .join(' ')

let says = (d: string) => instruction.includes(d)
let num = (d: string, fallback: number) =>
  Number(instruction.match(new RegExp(`${d}:(\\d+)`))?.[1] ?? fallback)

let delay = num('delay', 0)
let beat = () => delay ? new Promise((go) => setTimeout(go, delay)) : undefined
let say = (e: unknown) => console.log(JSON.stringify(e))

// init first, always: `delay:N` is how a test keeps a session RUNNING, so
// it must announce itself before it dawdles.
say({
  type: 'init',
  session_id: arg('--session'),
  model: arg('--model'),
  effort: arg('--effort') ?? null,
})
await beat()
say({ type: 'message', role: 'assistant', text: `working: ${instruction}` })
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
    usage: { input_tokens: 12, output_tokens: 34 },
  })
}
Deno.exit(num('fail', 0))
