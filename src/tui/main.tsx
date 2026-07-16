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
import { App, key, overrides, quit } from './App.tsx'
import { paint } from './paint.ts'

config.host = Deno.env.get('TASKS_HOST') ?? '127.0.0.1:5173'
config.reload = () => {} // code reloads don't reach a terminal process

extend(overrides)
await boot()

let enc = new TextEncoder()
let out = (s: string) => Deno.stdout.writeSync(enc.encode(s))

Deno.stdin.setRaw(true)
out('\x1b[?1049h\x1b[?25l') // alt screen, cursor hidden

let bye = () => {
  out('\x1b[?25h\x1b[?1049l')
  Deno.stdin.setRaw(false)
  Deno.exit(0)
}

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
