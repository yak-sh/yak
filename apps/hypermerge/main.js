// One doc per link (?doc=<id>), its id the root actor's key. Each editor on
// the page is an actor holding its own key; every edit it makes is one
// Automerge change, signed into its own feed and appended to the app's store.
// Every tab subscribed to the doc receives every feed's blocks as they land,
// checks them as hypercore would, and applies what it trusts.
import Automerge from 'automerge'
import { apply, me, query, subscribe } from './api/client.js'
import { checked, leafHash } from './check.js'
import { editor } from './editor.js'
import { causal, key, lanes, shuffled } from './feed.js'
import { keep, kept, mint } from './keys.js'
import { moved, splice } from './text.js'
import { short, svg } from './view.js'

let COLORS = [
  '#3b6ea5',
  '#c2553a',
  '#4c8a4c',
  '#8a5aa8',
  '#b8862b',
  '#2f8f8f',
  '#a34a6f',
  '#5c6b7a',
]
let $ = (s, el = document) => el.querySelector(s)
let esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
let status = (words) => ($('.Status').textContent = words)
let publish = (rows) => apply(rows).catch((e) => status(e.message))
let doc = new URL(location.href).searchParams.get('doc')

// An actor joins the doc's actor set with a row of its own, apart from every
// feed, and its secret key stays in this browser.
let join = async (doc, actor, n) => {
  keep(doc, actor)
  await publish({
    entity: { eid: crypto.randomUUID() },
    actor: {
      doc,
      key: actor.id,
      name: n ? `Actor ${n + 1}` : 'Root actor',
      color: COLORS[n % COLORS.length],
    },
  })
}

let start = async () => {
  $('.Start').hidden = false
  $('.Start_new').addEventListener('click', async () => {
    let root = await mint()
    await join(root.id, root, 0)
    let e = editor(root.id, root, publish)
    e.change('new doc', (d) => {
      d.title = 'Untitled'
      d.body = new Automerge.Text()
    })
    await e.sent()
    location.search = `?doc=${root.id}`
  })
  let rows = await query('.actor&?created&.order=-created.at&.limit=200')
  let roots = rows.filter((r) => r.actor.key == r.actor.doc)
  $('.Start_docs').innerHTML = roots.length
    ? roots.map((r) =>
      `<li><a href="?doc=${encodeURIComponent(r.actor.doc)}">${
        esc(short(r.actor.doc))
      }…</a> <span>${esc(new Date(r.created?.at).toLocaleString())}</span></li>`
    ).join('')
    : '<li>No docs yet.</li>'
}

let open = async () => {
  $('.Doc').hidden = false
  $('.Doc_id').textContent = doc
  $('.Doc_copy').addEventListener(
    'click',
    () =>
      navigator.clipboard.writeText(location.href).then(() =>
        status('Link copied.')
      ),
  )

  let rows = [], now = { lanes: [], checks: [] }, panes = []
  let selected = null
  let replay = { order: 'arrival', shuffle: [], k: null }
  let colors = () =>
    Object.fromEntries(now.lanes.map((l, i) => [
      l.actor,
      l.member?.color ?? COLORS[i % COLORS.length],
    ]))
  let arrival = () => {
    let ok = new Set(now.checks.flatMap((c) => c.trusted.map((b) => b.eid)))
    return rows.filter((r) => r.block && ok.has(r.entity.eid))
      .map((r) => ({ ...r.block, eid: r.entity.eid }))
  }

  // A pane is one local editor: its title, its text and its online switch.
  let pane = (actor) => {
    let el = $('#pane').content.firstElementChild.cloneNode(true)
    let e = editor(doc, actor, publish)
    let title = $('.Pane_title', el), body = $('.Pane_body', el)
    let wait = null
    let flush = () => {
      clearTimeout(wait)
      wait = null
      let s = e.state
      if (!s.body) return
      let cut = splice(s.body.join(''), body.value)
      let said = [
        title.value != s.title && 'title',
        cut.cut && `delete ${cut.cut}`,
        cut.put && `insert ${JSON.stringify(cut.put.slice(0, 16))}`,
      ].filter(Boolean).join(', ')
      if (!said) return
      e.change(said, (d) => {
        if (d.title != title.value) d.title = title.value
        if (cut.cut) d.body.deleteAt(cut.at, cut.cut)
        if (cut.put) d.body.insertAt(cut.at, ...cut.put)
      })
      paint()
      draw()
    }
    let later = () => {
      clearTimeout(wait)
      wait = setTimeout(flush, 400)
    }
    let paint = () => {
      let s = e.state, text = s.body ? s.body.join('') : ''
      if (body.value != text) {
        let sp = splice(body.value, text)
        let [a, z] = [body.selectionStart, body.selectionEnd]
        body.value = text
        if (document.activeElement == body) {
          body.setSelectionRange(moved(a, sp), moved(z, sp))
        }
      }
      if (title.value != (s.title ?? '')) title.value = s.title ?? ''
      body.disabled = title.disabled = !s.body
      let lost = Automerge.getConflicts(s, 'title') ?? {}
      $('.Pane_conflict', el).textContent = Object.entries(lost).map((
        [a, v],
      ) =>
        `${short(a)} also wrote “${v}”, which lost: the higher actor id wins`
      )
        .join('; ')
      $('.Pane_held', el).textContent = e.held.length
        ? `${e.held.length} block${e.held.length == 1 ? '' : 's'} held`
        : ''
    }
    let member = () => now.lanes.find((l) => l.actor == actor.id)?.member
    let label = () => {
      let m = member(), c = colors()[actor.id] ?? '#888'
      $('.Pane_who', el).innerHTML = `<i style="background:${esc(c)}"></i>${
        esc(m?.name ?? 'Actor')
      } <code title="${esc(actor.id)}">${esc(short(actor.id))}…</code>`
    }
    title.addEventListener('input', later)
    body.addEventListener('input', later)
    $('.Pane_online', el).addEventListener('change', async (ev) => {
      flush()
      await e.go(ev.target.checked)
      paint()
      pass()
    })
    $('.Editors_list').append(el)
    let p = { e, flush, paint, label }
    panes.push(p)
    paint()
    return p
  }

  let details = () => {
    let b = now.lanes.flatMap((l) => l.blocks).find((b) => b.eid == selected)
    if (!b) return ($('.Detail').hidden = true)
    $('.Detail').hidden = false
    let i = now.lanes.findIndex((l) => l.actor == b.actor)
    let lane = now.lanes[i], check = now.checks[i]
    let ops = b.change?.ops ?? []
    $('.Detail_body').innerHTML = `<dl>
      <dt>feed</dt><dd>${esc(lane.member?.name ?? 'actor')} <code>${
      esc(b.actor)
    }</code></dd>
      <dt>block</dt><dd>#${b.index} · seq ${esc(b.change?.seq)} · ${
      esc(check.status.get(b.eid))
    }</dd>
      <dt>message</dt><dd>${esc(b.change?.message ?? '')}</dd>
      <dt>deps</dt><dd><code>${esc(JSON.stringify(b.change?.deps ?? {}))}</code>
        and, implicitly, its own seq ${esc((b.change?.seq ?? 1) - 1)}</dd>
      <dt>eid</dt><dd><code>${esc(b.eid)}</code> (SHA-256 of the block)</dd>
      <dt>leaf hash</dt><dd><code>${esc(leafHash(b))}</code> (BLAKE2b-256)</dd>
      <dt>signature</dt><dd><code>${esc(b.sig)}</code></dd>
    </dl>
    <table><tr><th>action</th><th>obj</th><th>key</th><th>elem</th><th>value</th></tr>${
      ops.map((o) =>
        `<tr><td>${esc(o.action)}</td><td><code>${
          esc(short(o.obj))
        }</code></td><td><code>${esc(o.key ?? '')}</code></td><td>${
          esc(o.elem ?? '')
        }</td><td>${
          esc(o.value === undefined ? '' : JSON.stringify(o.value))
        }</td></tr>`
      ).join('')
    }</table>`
  }

  let step = () => {
    let order = replay.order == 'shuffled' ? replay.shuffle : arrival()
    let n = order.length, k = replay.k ?? n
    let range = $('.Replay_range')
    range.max = n
    range.value = k
    $('.Replay_at').textContent = `${k} of ${n} blocks delivered`
    let delivered = order.slice(0, k)
    let s = Automerge.applyChanges(
      Automerge.init(),
      delivered.map((b) => b.change),
    )
    let { waiting } = causal(delivered.map((b) => b.change))
    let held = new Set(waiting.map(key))
    $('.Replay_title').textContent = s.title ?? '—'
    $('.Replay_text').textContent = s.body ? s.body.join('') : ''
    let missing = Automerge.getMissingDeps(s)
    $('.Replay_queue').innerHTML = waiting.length
      ? waiting.map((c) =>
        `<li><code>${esc(short(c.actor))}</code> seq ${c.seq} waits for <code>${
          esc(JSON.stringify(
            Object.fromEntries(
              Object.entries({ ...c.deps, [c.actor]: c.seq - 1 })
                .map(([a, q]) => [short(a), q]),
            ),
          ))
        }</code></li>`
      ).join('') +
        `<li>getMissingDeps: <code>${esc(JSON.stringify(missing))}</code></li>`
      : '<li>Nothing waiting: every delivered change is applied.</li>'
    return k < n
      ? new Map(order.map((b, i) => [
        b.eid,
        i >= k ? 'pending' : held.has(key(b.change)) ? 'waiting' : 'applied',
      ]))
      : null
  }

  let actors = () => {
    let mine = new Set(panes.map((p) => p.e.actor.id))
    $('.Actors_rows').innerHTML = now.lanes.map((l, i) => {
      let c = now.checks[i],
        bad = [...c.status.values()].filter((s) => s != 'ok').length
      return `<tr><td><i style="background:${esc(colors()[l.actor])}"></i>${
        esc(l.member?.name ?? '(not in the actor set)')
      }</td>
        <td><code title="${esc(l.actor)}">${esc(short(l.actor))}…</code>${
        l.actor == doc ? ' root' : ''
      }</td>
        <td>${c.trusted.length}</td><td>${bad || ''}</td>
        <td>${mine.has(l.actor) ? 'this browser' : ''}</td></tr>`
    }).join('')
  }

  let draw = () => {
    let phase = step()
    let held = Object.fromEntries(
      panes.filter((p) => p.e.held.length).map((p) => [p.e.actor.id, p.e.held]),
    )
    $('.Feeds_view').innerHTML = svg({
      doc,
      lanes: now.lanes,
      checks: now.checks,
      colors: colors(),
      held,
      selected,
      phase,
    })
    for (let p of panes) p.label()
    actors()
    details()
  }

  // Each pass checks every feed and hands each editor what it trusts. Passes
  // run one at a time; rows that land during one run another after it.
  let running = null, again = false
  let pass = () => {
    if (running) return (again = true, running)
    running = (async () => {
      do {
        again = false
        let ls = lanes(doc, rows)
        let cs = await Promise.all(ls.map((l) => checked(doc, l)))
        now = { lanes: ls, checks: cs }
        let trusted = arrival()
        let known = new Set(trusted.map((b) => b.eid))
        replay.shuffle = [
          ...replay.shuffle.filter((b) => known.has(b.eid)),
          ...trusted.filter((b) => !replay.shuffle.some((s) => s.eid == b.eid)),
        ]
        for (let p of panes) {
          p.flush()
          if (p.e.receive(trusted)) p.paint()
        }
        draw()
      } while (again)
      running = null
    })()
    return running
  }

  $('.Feeds_view').addEventListener('click', (ev) => {
    let g = ev.target.closest('[data-eid]')
    if (!g) return
    selected = g.dataset.eid
    draw()
  })
  $('.Replay_range').addEventListener('input', (ev) => {
    let k = Number(ev.target.value)
    replay.k = k >= Number(ev.target.max) ? null : k
    draw()
  })
  $('.Replay_order').addEventListener('change', (ev) => {
    replay.order = ev.target.value
    replay.k = 0
    draw()
  })
  $('.Replay_shuffle').addEventListener('click', () => {
    replay.order = $('.Replay_order').value = 'shuffled'
    replay.shuffle = shuffled(arrival())
    replay.k = 0
    draw()
  })

  let live = subscribe(
    `(.block.doc=${doc}|.actor.doc=${doc})`,
    (all) => {
      rows = all
      pass()
    },
  )
  let [who] = await Promise.all([
    me(),
    live.ready,
    kept(doc).then((held) => held.forEach(pane)),
  ])
  await pass()
  if (!who.writes) {
    $('.Editors_add').hidden = true
    if (!panes.length) status('You can read this doc; only its members write.')
    return
  }
  let add = async () => {
    let actor = await mint()
    await join(doc, actor, now.lanes.length)
    pane(actor)
    pass()
  }
  $('.Editors_add').addEventListener('click', add)
  if (!panes.length && now.checks[0]?.trusted.length) await add()
  if (!now.checks[0]?.trusted.length) status('No doc has this id yet.')
}

doc ? open() : start()
