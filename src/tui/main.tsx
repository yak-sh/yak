// The TUI entry point: same cache, same sync, same view registry as the
// browser — a different document and a different painter. Run against a
// live server:
//   deno task tui                     (TASKS_HOST=host:port to point away)
// Edits made elsewhere appear live; this is another client on the same ws.
import { onPaint, root, touch } from './dom.ts' // installs document — first
import { render } from 'preact'
import { effect } from '@preact/signals'
import { boot, config } from '../live.ts'
import { extend } from '../components/registry.ts'
import { onMarkdown } from '../components/Markdown.tsx'
import { Md } from './md.tsx'
import {
  App,
  fit,
  key,
  overrides,
  quit,
  sel,
  spot,
  spots,
  trail,
  views,
} from './App.tsx'
import { paint } from './paint.ts'
import { decode } from './input.ts'

let enc = new TextEncoder()
let out = (s: string) => Deno.stdout.writeSync(enc.encode(s))

// Exit 42 asks the deno.json wrapper loop to run us again — that's the
// whole hot-reload mechanism, and it can never spam sockets: there is one
// process, holding one socket, replaced whole. (deno's own --watch can't
// do this: the old isolate's pending stdin read starves the new one.)
// ESC[<u pops the kitty keyboard flags we pushed at startup, so the terminal
// is left exactly as we found it.
let bye = (code = 0) => {
  out('\x1b[<u\x1b[?25h\x1b[?1049l')
  Deno.stdin.setRaw(false)
  Deno.exit(code)
}

config.host = Deno.env.get('TASKS_HOST') ?? '127.0.0.1:5173'
config.agreement = Deno.env.get('TASKS_SUBS_PROBE') == '1'
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
  views.value = s.views ?? views.value
  spots.value = s.spots ?? spots.value
} catch { /* first run */ }
effect(() => {
  Deno.writeTextFile(
    stateFile,
    JSON.stringify({
      sel: sel.value,
      trail: trail.value,
      views: views.value,
      spots: spots.value,
    }),
  )
})

// The shared Markdown door injects HTML the fake DOM can't honor, so a Session
// say (and every other body) came out blank. Give the door the terminal
// painter — the same registry the web uses now reads in the terminal too.
onMarkdown((text, repo, inline) => (
  <Md text={text} repo={repo ?? undefined} inline={inline} />
))
extend(overrides)
await boot()

Deno.stdin.setRaw(true)
// Alt screen, cursor hidden, and push the kitty keyboard protocol (disambiguate
// flag) so a modified key like Shift+Enter is reported at all — without it the
// terminal collapses ⇧⏎ to a bare CR. Terminals that don't speak it ignore the
// private sequence; input.decode() turns whatever they do send back into the
// legacy tokens key() reads.
out('\x1b[?1049h\x1b[?25l\x1b[>1u')

effect(() => {
  if (quit.value) bye()
})

// The painter is the only thing that measures, so the cursor goes down and
// the content's height comes back — a resize is a repaint like any other,
// and the clamp rides it.
onPaint(() => fit(paint(root, spot())))
Deno.addSignalListener('SIGWINCH', touch)
render(<App />, root as unknown as Parameters<typeof render>[1])

// The key loop: raw bytes → decode() → key(). A multi-byte escape sequence
// (an arrow, a function key, or a kitty CSI-u report like ⇧⏎) arrives as one
// chunk; decode() turns each chunk into the tokens key() reads — legacy bytes
// for the keys the app binds, nothing for the ones it doesn't — so their
// `[`, `Z`, … never leak into the command line.
let buf = new Uint8Array(64)
let dec = new TextDecoder()
while (!quit.value) {
  let n = await Deno.stdin.read(buf)
  if (n == null) break
  for (let k of decode(dec.decode(buf.subarray(0, n)))) key(k)
}
bye()
