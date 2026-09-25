// The TUI entry point. Run against a live server:
//   deno task tui                     (TASKS_HOST=host:port to point away)
// The shared web modules read the vocabulary as they load, so the terminal
// learns the one its host serves (the page's /web/vocab.json) before any of
// them is imported; run.tsx is the terminal itself.
import './dom.ts' // installs document — first
import { learn } from '../../packages/web/types.ts'

let host = Deno.env.get('TASKS_HOST') ?? '127.0.0.1:5173'
learn(await (await fetch(`http://${host}/web/vocab.json`)).json())
await import('./run.tsx')
