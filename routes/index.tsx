import { Head } from 'fresh/runtime'
import { define } from '../utils.ts'
import { deps, open, type Task, tasks } from '../db.ts'

// One handle for the server's lifetime — the graph is the memory substrate.
let db = open()

// How each edge type reads when drawn from a task out to its target.
let arrow = { blocks: 'blocks', subtask: 'subtask of', informs: 'informs' }

export default define.page(function Home() {
  let rows = tasks(db)
  let edges = deps(db)
  let title = new Map(rows.map((t: Task) => [t.eid, t.title]))
  let out = (eid: number) => edges.filter((d) => d.src == eid)

  return (
    <div class='wrap'>
      <Head>
        <title>Tasks v2</title>
        <style>{css}</style>
      </Head>
      <h1>
        Tasks v2 <span class='sub'>· the fleet entity graph</span>
      </h1>
      <ul class='tasks'>
        {rows.map((t: Task) => (
          <li key={t.eid} class='task'>
            <div class='head'>
              <span class={`dot ${t.status}`} />
              <span class='ttl'>{t.title}</span>
              <span class='eid'>T-{t.eid}</span>
            </div>
            {t.body && <p class='body'>{t.body}</p>}
            {out(t.eid).map((d) => (
              <span key={d.dst} class='edge'>
                {arrow[d.type]} → {title.get(d.dst) ?? `#${d.dst}`}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </div>
  )
})

let css = `
  :root { color-scheme: light dark; --gap: 1rem }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0 }
  .wrap { max-width: 44rem; margin: 3rem auto; padding: 0 var(--gap) }
  h1 { font-size: 1.6rem; margin-bottom: var(--gap) }
  .sub { font-weight: 400; opacity: .5 }
  .tasks { list-style: none; padding: 0; display: grid; gap: var(--gap) }
  .task { border: 1px solid color-mix(in srgb, currentColor 15%, transparent);
    border-radius: 8px; padding: var(--gap) }
  .head { display: flex; align-items: center; gap: .5rem }
  .ttl { font-weight: 600 }
  .eid { margin-left: auto; opacity: .4; font: 12px monospace }
  .dot { width: .6rem; height: .6rem; border-radius: 50%; background: gray }
  .dot.wip { background: orange }
  .dot.open { background: dodgerblue }
  .dot.done { background: seagreen }
  .body { margin: .5rem 0; opacity: .75 }
  .edge { display: inline-block; margin-right: .75rem; font-size: 13px;
    opacity: .7 }
`
