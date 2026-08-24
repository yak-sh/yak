// The lifecycle hook's hot path: turn payload into the server's durable spool.
// It deliberately imports nothing and waits on no server response — a busy
// event loop cannot consume Claude's three-second hook budget.

export let turnOf = (body: Record<string, unknown>) =>
  body.hook_event_name == 'UserPromptSubmit'
    ? 'busy'
    : body.hook_event_name == 'Stop'
    ? 'idle'
    : undefined

export let report = (
  body: Record<string, unknown>,
  path = `${Deno.env.get('HOME')}/.tasks/turns.jsonl`,
) => {
  let sid = String(body.session_id ?? '')
  let turn = turnOf(body)
  if (!sid || !turn) return
  Deno.writeTextFileSync(path, `${JSON.stringify({ sid, turn })}\n`, {
    append: true,
    create: true,
  })
}

export let drain = (
  act: (turn: { sid: string; turn: string }) => void,
  path = `${Deno.env.get('HOME')}/.tasks/turns.jsonl`,
) => {
  let taken = `${path}.${crypto.randomUUID()}`
  try {
    Deno.renameSync(path, taken)
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return
    throw e
  }
  try {
    let lines = Deno.readTextFileSync(taken).split('\n').filter(Boolean)
    for (let i = 0; i < lines.length; i++) {
      try {
        act(JSON.parse(lines[i]))
      } catch (e) {
        Deno.writeTextFileSync(path, `${lines.slice(i).join('\n')}\n`, {
          append: true,
          create: true,
        })
        throw e
      }
    }
  } finally {
    Deno.removeSync(taken)
  }
}

if (import.meta.main) {
  try {
    let text = await new Response(Deno.stdin.readable).text()
    report(JSON.parse(text))
  } catch { /* a hook must never wedge its session */ }
}
