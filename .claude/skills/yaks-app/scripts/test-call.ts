// A test call to an Operator from a number of our own, placed through Telnyx:
// the caller says each line at its second after the call is answered, our
// leg is recorded in two channels, and the call hangs up after --secs.
//
//   TELNYX_KEY="$(op read 'op://Yak Shaving LLC/telnyx API/credential')" \
//     deno run -A .claude/skills/yaks-app/scripts/test-call.ts \
//     --from <our idle number> --to <the Operator's number> \
//     [--secs 18] [--out .scratch/call.mp3] "0.3:Hello?" "8:What apps do I have?"
//
// --from is the number the `checks` account is known by (its person's
// `phone{number}` in yak/platform), so the call reaches the checks space's
// Operator and nobody else's. --to is PHONE_SENDER's number (wrangler.toml).
// The call goes out through the Call Control application "agents test
// caller", whose outbound profile spends at most $1 a day. It prints when the
// call was dialed and answered and where the recording was written; the
// recording is deleted from Telnyx once it is read.
let args: Record<string, string> & { _: string[] } = Object.assign(
  { secs: '18', out: '.scratch/call.mp3' },
  { _: [] as string[] },
)
for (let i = 0; i < Deno.args.length; i++) {
  let a = Deno.args[i]
  if (a.startsWith('--')) args[a.slice(2)] = Deno.args[++i]
  else args._.push(a)
}
let key = Deno.env.get('TELNYX_KEY')
if (!key || !args.from || !args.to) {
  console.error('TELNYX_KEY, --from and --to are required; see the header.')
  Deno.exit(2)
}
let lines = args._.map((a) => {
  let [at, ...text] = a.split(':')
  return { at: Number(at), text: text.join(':') }
})

let api = async (method: string, path: string, body?: unknown) => {
  let res = await fetch(`https://api.telnyx.com/v2${path}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) }
}
let sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let t0 = Date.now()
let at = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(5)

let apps = await api('GET', '/call_control_applications')
let app = apps.json.data?.find((a: { application_name: string }) =>
  a.application_name == 'agents test caller'
)
if (!app) {
  console.error('Telnyx has no Call Control application "agents test caller".')
  Deno.exit(1)
}
let dialed = await api('POST', '/calls', {
  connection_id: app.id,
  to: args.to,
  from: args.from,
  timeout_secs: 25,
  time_limit_secs: Number(args.secs) + 30,
})
if (!dialed.ok) {
  console.error('dial failed', dialed.status, JSON.stringify(dialed.json))
  Deno.exit(1)
}
let { call_control_id: id, call_leg_id: leg } = dialed.json.data
console.log(`${at()} dialed ${new Date().toISOString()}`)

// A command is refused until the call is answered: recording starts then.
let answered = 0
for (let i = 0; i < 150 && !answered; i++) {
  let rec = await api('POST', `/calls/${id}/actions/record_start`, {
    format: 'mp3',
    channels: 'dual',
  })
  if (rec.ok) answered = Date.now()
  else await sleep(150)
}
if (!answered) {
  console.error('the call was never answered')
  Deno.exit(1)
}
console.log(`${at()} answered ${new Date(answered).toISOString()}`)
for (let l of lines) {
  await sleep(Math.max(0, answered + l.at * 1000 - Date.now()))
  let said = await api('POST', `/calls/${id}/actions/speak`, {
    payload: l.text,
    voice: 'female',
    language: 'en-US',
  })
  console.log(`${at()} caller says "${l.text}" ${said.status}`)
}
await sleep(Math.max(0, answered + Number(args.secs) * 1000 - Date.now()))
await api('POST', `/calls/${id}/actions/hangup`, {})
console.log(`${at()} hung up`)

// The recording, once Telnyx has saved it: written here, and deleted there.
for (let i = 0; i < 20; i++) {
  await sleep(2000)
  let recs = await api('GET', `/recordings?filter[call_leg_id]=${leg}`)
  let rec = recs.json.data?.[0]
  let url = rec?.download_urls?.mp3
  if (!url) continue
  await Deno.writeFile(
    args.out,
    new Uint8Array(await (await fetch(url)).arrayBuffer()),
  )
  await api('DELETE', `/recordings/${rec.id}`)
  console.log(`${at()} recording ${args.out}, ${rec.duration_millis} ms`)
  Deno.exit(0)
}
console.error('no recording came')
Deno.exit(1)
