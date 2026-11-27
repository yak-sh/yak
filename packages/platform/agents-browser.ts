/**
 * The Agents and New app pages in the browser (D-475 step 5). Each is drawn
 * from the person's agents' row (./agents-view.ts), and here it is drawn
 * again from the tab's page graph as the row moves: an agent connected or
 * disconnected in another tab or by the agent itself. Disconnect writes
 * `disconnectAgent` through the graph; the agent leaves the list at once, and
 * comes back with the refusal said under the list if the door refuses it.
 * Each copy button puts its words on the clipboard, the tab of the app a
 * person connects is kept in the address, and a website dropped on New app
 * names itself from its file.
 *
 * The view is `[data-view="agents"]`, saying what it draws for in
 * `data-agents-view` (`AgentsView`).
 *
 * @module
 */
import { createElement as h, Fragment, type ReactNode } from 'react'
import { renderToString } from 'preact-render-to-string'
import type { Client } from '@yaks/client'
import { mint } from '@yaks/graph'
import { copying, shown } from '@yaks/ui/copy-browser'
import { leaving, morph, PAGE } from '@yaks/ui/navigate'
import { refusal } from './account-browser.ts'
import { AGENTS, agentsOf, agentsWords } from './agents.ts'
import { type AgentsView, agentsView, type Pressed } from './agents-view.ts'
import { pageGraph } from './page-graph.ts'
import { nameFrom } from './page-parts.ts'

/** The Agents and New app view. */
export let VIEW = '[data-view="agents"]'

let made = (doc: Document, node: ReactNode) => {
  let t = doc.createElement('template')
  t.innerHTML = renderToString(h(Fragment, null, node))
  return t.content
}

// The rows the page carried for its first paint stay as they are.
let KEPT = { leave: (n: Node) => (n as Element).localName == 'script' }

// The radios of the app a person connects, by the name the guide gives them
// (./agent-guide.ts `doors`).
let TAB = 'input[type=radio][name=agent]'

/** Keep the view `root` drawn from `graph`, and write through it. The answer
 * lets go of it all. */
export let bindAgents = (
  root: HTMLElement,
  graph: Pick<Client, 'watch' | 'mutate'>,
  win: Pick<Window, 'location' | 'history' | 'addEventListener'> = globalThis,
): () => void => {
  let view = JSON.parse(root.dataset.agentsView!) as AgentsView
  let agents = graph.watch(AGENTS)
  // The agents being disconnected, and what came of the last press.
  let going = new Set<string>()
  let said: Pressed['said']
  let draw = () => {
    if (!agents.ready) return
    let next = root.cloneNode(false) as HTMLElement
    next.append(made(
      root.ownerDocument,
      agentsView(view, agentsOf(agents.value), { leaving: going, said }),
    ))
    morph(root, next, KEPT)
    shown(root)
  }
  let disconnect = async (agent: string) => {
    going.add(agent)
    said = undefined
    draw()
    try {
      let [done] = await graph.mutate([{
        entity: { eid: mint() },
        disconnectAgent: { agent },
      }])
      let words = (done?.disconnectAgent as { said?: string } | undefined)
        ?.said
      said = { words: words ?? 'Disconnected.' }
    } catch (error) {
      said = {
        words: refusal(error, 'That did not go through. Try again.'),
        refused: true,
      }
    }
    going.delete(agent)
    draw()
  }
  let click = (e: Event) => {
    let go = (e.target as Element).closest<HTMLElement>('[data-disconnect]')
    if (go) void disconnect(go.dataset.disconnect!)
  }
  // The tab the address names is the one open; picking another names it.
  let pick = () => {
    let want = decodeURIComponent(win.location.hash.slice(1))
    for (let tab of root.querySelectorAll<HTMLInputElement>(TAB)) {
      if (tab.value == want) tab.checked = true
    }
  }
  let change = (e: Event) => {
    let field = e.target as HTMLInputElement
    if (field.matches(TAB)) {
      win.history.replaceState(win.history.state, '', `#${field.value}`)
    }
    // What to call a website, from what its file is called, never over a
    // name already typed.
    let form = field.closest('.Deploy')
    if (field.type != 'file' || !form) return
    let slug = form.querySelector<HTMLInputElement>('input[name=slug]')
    let file = field.files?.[0]
    if (slug && file && !slug.value) slug.value = nameFrom(file.name)
  }
  let off = agents.subscribe(draw)
  let uncopy = copying(root)
  let gone = new AbortController()
  root.addEventListener('click', click)
  root.addEventListener('change', change)
  win.addEventListener('hashchange', pick, { signal: gone.signal })
  draw()
  pick()
  return () => {
    root.removeEventListener('click', click)
    root.removeEventListener('change', change)
    gone.abort()
    uncopy()
    off()
    agents.close()
  }
}

let start = (doc: Document = document) => {
  let bound = new Set<Element>()
  let each = () => {
    for (let root of doc.querySelectorAll<HTMLElement>(VIEW)) {
      if (bound.has(root)) continue
      bound.add(root)
      let { person } = JSON.parse(root.dataset.agentsView!) as AgentsView
      let stop = bindAgents(root, pageGraph([agentsWords], person))
      leaving(doc).addEventListener('abort', () => {
        bound.delete(root)
        stop()
      }, { once: true })
    }
  }
  each()
  doc.addEventListener(PAGE, each)
}

if (typeof document != 'undefined') start()
