// The TUI entry point: same cache, same sync, same view registry as the
// browser — a different document and a different painter. Run against a
// live server:
//   deno task tui                     (TASKS_HOST=host:port to point away)
// Edits made elsewhere appear live; this is another client on the same ws.
import { onPaint, root } from './dom.ts' // installs globalThis.document — first
import { render } from 'preact'
import { effect } from '@preact/signals'
import { boot, config } from '../live.ts'
import { extend } from '../components/View.tsx'
import { App, key, overrides, quit, sel, trail } from './App.tsx'
import { paint } from './paint.ts'

let enc = new TextEncoder()
let out = (s: string) => Deno.stdout.writeSync(enc.encode(s))

// Exit 42 asks the deno.json wrapper loop to run us again — that's the
// whole hot-reload mechanism, and it can never spam sockets: there is one
// process, holding one socket, replaced whole. (deno's own --watch can't
// do this: the old isolate's pending stdin read starves the new one.)
let bye = (code = 0) => {
  out('\x1b[?25h\x1b[?1049l')
  Deno.stdin.setRaw(false)
  Deno.exit(code)
}

config.host = Deno.env.get('TASKS_HOST') ?? '127.0.0.1:5173'
// The server says 'reload' on any src change; a dead socket ends up here
// too (live.ts polls until the server is back, then reloads). Both mean
// the same thing to a terminal process: be reborn.
config.reload = () => bye(42)

// Hot reload is lossless the same way the web's is: the browsing state
// lives outside the process. Restore before first render, save on change.
let stateFile = `${Deno.env.get('HOME')}/.tasks/tui.json`
try {
  let s = JSON.parse(Deno.readTextFileSync(stateFile))
  sel.value = s.sel ?? sel.value
  trail.value = s.trail ?? trail.value
} catch { /* first run */ }
effect(() => {
  Deno.writeTextFile(
    stateFile,
    JSON.stringify({ sel: sel.value, trail: trail.value }),
  )
})

extend(overrides)
await boot()

Deno.stdin.setRaw(true)
out('\x1b[?1049h\x1b[?25l') // alt screen, cursor hidden

effect(() => {
  if (quit.value) bye()
})

onPaint(() => paint(root))
render(<App />, root as unknown as Parameters<typeof render>[1])

// The key loop: raw bytes → key(). Multi-byte escape sequences (arrows,
// function keys) arrive as one chunk — skipped for now, vim keys only.
let buf = new Uint8Array(64)
let dec = new TextDecoder()
while (!quit.value) {
  let n = await Deno.stdin.read(buf)
  if (n == null) break
  let s = dec.decode(buf.subarray(0, n))
  if (s.length > 1 && s.startsWith('\x1b')) continue
  for (let ch of s) key(ch)
}
bye()
