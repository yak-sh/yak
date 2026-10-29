// Hypermerge, explained. One doc per link (?doc=<id>), its id the root
// actor's key. Each editor on the page is an actor holding its own key; each
// edit is one Automerge change, signed into the actor's log and appended to
// the app's store. Every page subscribed to the doc receives every log's
// blocks as they land, checks them as hypercore would, and applies what it
// trusts. An actor joins the doc with its first edit, so a reader adds
// nothing. Rewinding shows the same doc at an earlier point, and an edit
// made there forks onto a new actor that saw only that much; back at the
// present, Automerge merges it with what came after. The story beside the
// picture says what each part is, and the chapter being read lights its part
// up.
import Automerge from 'automerge'
import { apply, me, query, subscribe } from './api/client.js'
import { checked, leafHash } from './check.js'
import { detail } from './detail.js'
import { editor } from './editor.js'
import { lanes, shuffled } from './feed.js'
import { forget, keep, kept, mint } from './keys.js'
import { fresh, look } from './names.js'
import { at, needs } from './time.js'
import { ago } from './when.js'
import { moved, splice } from './text.js'
import { heads, logs } from './view.js'

let $ = (s, el = document) => el.querySelector(s)
let $$ = (s, el = document) => [...el.querySelectorAll(s)]
let esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
let doc = new URL(location.href).searchParams.get('doc')

let toast = (words) => {
  let t = $('.Toast')
  t.textContent = words
  t.classList.add('Toast-on')
  clearTimeout(toast.wait)
  toast.wait = setTimeout(() => t.classList.remove('Toast-on'), 2600)
}
let publish = (rows) => apply(rows).catch((e) => toast(e.message))
let share = () =>
  navigator.clipboard.writeText(location.href).then(
    () => toast('Link copied. Anyone with it can write.'),
    () => toast(location.href),
  )
let text = (s) => (s?.body ? s.body.join('') : '')

// An actor joins the doc's actor set with a row of its own, kept apart from
// every log, and its secret key stays in this browser.
let join = (doc, actor, color) => {
  keep(doc, actor)
  return publish({
    entity: { eid: crypto.randomUUID() },
    actor: { doc, key: actor.id, name: look(actor.id, color).name, color },
  })
}

let home = async () => {
  $('.Home').hidden = false
  $('.Home_new').addEventListener('click', async (ev) => {
    ev.currentTarget.disabled = true
    let root = await mint(), color = fresh([])
    await join(root.id, root, color)
    let e = editor(root.id, root, publish)
    e.change('new doc', (d) => {
      d.title = ''
      d.body = new Automerge.Text()
    })
    await e.sent()
    location.search = `?doc=${root.id}`
  })

  let docs = new Map()
  for (let r of await query('.actor&?created&.order=-created.at&.limit=300')) {
    let d = docs.get(r.actor.doc) ??
      docs.set(r.actor.doc, { id: r.actor.doc, at: r.created?.at, who: [] })
        .get(r.actor.doc)
    d.who.push(look(r.actor.key, r.actor.color).color)
  }
  let recent = [...docs.values()].slice(0, 8)
  if (!recent.length) return
  $('.Recent').hidden = false
  let list = $('.Recent_list')
  list.innerHTML = recent.map((d) =>
    `<li><a href="?doc=${encodeURIComponent(d.id)}">
      <span class="Recent_who">${
      d.who.slice(0, 5).map((c) => `<i style="--c:${c}"></i>`).join('')
    }</span>
      <b data-doc="${esc(d.id)}">Untitled</b>
      <span>${d.who.length} writer${d.who.length == 1 ? '' : 's'} · ${
      esc(ago(d.at))
    }</span>
    </a></li>`
  ).join('')
  // Each title is the doc rebuilt from its logs, as any reader rebuilds it.
  for (let d of recent) {
    query(`.block.doc=${d.id}&.limit=2000`).then((rows) => {
      let s = Automerge.applyChanges(
        Automerge.init(),
        rows.map((r) => r.block.change),
      )
      let b = list.querySelector(`[data-doc="${CSS.escape(d.id)}"]`)
      if (b && s.title) b.textContent = s.title
    })
  }
}

let open = async () => {
  $('.Doc').hidden = false
  $('.Bar_doc').hidden = false
  for (let b of $$('.Bar_share, .Story_share')) {
    b.addEventListener('click', share)
  }

  let stage = $('.Stage'), scroll = $('.Logs_scroll'), card = $('.Detail')
  let rows = [], now = { lanes: [], checks: [] }, panes = []
  let selected = null, seen = new Set()
  // Where the doc is shown in its history: k is null at the present, or how
  // many blocks of the order are delivered; forks are the writers that began
  // while rewound, and `past` is what that point rebuilds.
  let time = {
    order: 'arrival',
    shuffle: [],
    k: null,
    forks: new Set(),
    timer: null,
    past: null,
    built: { eids: [], state: Automerge.init() },
  }
  let rewound = () => time.k != null

  let member = (a) => now.lanes.find((l) => l.actor == a)?.member
  // The colour a writer here takes when it joins: the first no member wears.
  let planned = (a) =>
    fresh(
      now.lanes.filter((l) => l.member && l.actor != a)
        .map((l) => look(l.actor, l.member.color).color),
    )
  let looks = (a) =>
    member(a)
      ? look(a, member(a).color)
      : look(a, panes.some((p) => p.actor.id == a) ? planned(a) : null)
  let name = (a) => looks(a).name
  let arrival = () => {
    let ok = new Set(now.checks.flatMap((c) => c.trusted.map((b) => b.eid)))
    return rows.filter((r) => r.block && ok.has(r.entity.eid))
      .map((r) => ({ ...r.block, eid: r.entity.eid }))
  }
  let order = () => time.order == 'shuffled' ? time.shuffle : arrival()

  // A pane is one writer in this browser: its title, its text and its online
  // switch. A writer with no log yet makes one, and joins, on its first edit.
  // Rewound, a pane shows the doc at that point, and its first edit there
  // moves the pane onto a new writer, a fork, that has seen only that much.
  let pane = (actor, joined) => {
    let el = $('#pane').content.firstElementChild.cloneNode(true)
    let p = { actor, joined, el, fork: false, forking: null }
    let send = async (out) => {
      if (!p.joined) {
        p.joined = true
        await join(doc, p.actor, planned(p.actor.id))
      }
      return publish(out)
    }
    let title = $('.Pane_title', el), body = $('.Pane_body', el)
    let wait = null
    p.shown = () => rewound() && !p.fork ? time.past.state : p.e.state
    p.fork_ = async () => {
      let fork = await mint()
      let e = editor(doc, fork, send)
      e.receive(time.past.applied)
      if (!p.e.online) e.go(false)
      if (p.joined) forget(doc, p.actor)
      Object.assign(p, { actor: fork, e, joined: false, fork: rewound() })
      if (rewound()) time.forks.add(fork.id)
    }
    p.flush = () => {
      clearTimeout(wait)
      wait = null
      if (p.forking) return
      let s = p.shown()
      if (!s.body) return
      let cut = splice(text(s), body.value)
      let retitled = title.value != (s.title ?? '')
      if (!retitled && !cut.cut && !cut.put) return
      if (rewound() && !p.fork) {
        p.forking = p.fork_().then(() => {
          p.forking = null
          p.flush()
        })
        return
      }
      p.e.change(
        [
          retitled && 'title',
          cut.cut && `delete ${cut.cut}`,
          cut.put && `insert ${JSON.stringify(cut.put.slice(0, 16))}`,
        ].filter(Boolean).join(', '),
        (d) => {
          if (d.title != title.value) d.title = title.value
          if (cut.cut) d.body.deleteAt(cut.at, cut.cut)
          if (cut.put) d.body.insertAt(cut.at, ...cut.put)
        },
      )
      p.e.sent().then(draw)
    }
    let later = () => {
      clearTimeout(wait)
      wait = setTimeout(p.flush, 600)
    }
    let put = (field, value) => {
      if (field.value == value) return
      let sp = splice(field.value, value)
      let [a, z] = [field.selectionStart, field.selectionEnd]
      field.value = value
      if (document.activeElement == field) {
        field.setSelectionRange(moved(a, sp), moved(z, sp))
      }
    }
    p.paint = () => {
      let s = p.shown(), e = p.e
      if (wait == null && !p.forking) {
        put(body, text(s))
        put(title, s.title ?? '')
      }
      body.disabled = title.disabled = !s.body
      if (p == panes[0] && s.body && !rewound()) {
        document.title = `${s.title || 'Untitled'} · Hypermerge, explained`
      }
      let lost = Object.entries(Automerge.getConflicts(s, 'title') ?? {})
      let note = $('.Pane_conflict', el)
      note.hidden = !lost.length
      note.innerHTML = lost.map(([a, v]) =>
        `<b>${esc(name(a))}</b> set the title to “${
          esc(v)
        }” at the same time. Automerge kept this one everywhere, because the higher actor id wins.`
      ).join(' ')
      let held = e.held.length
      $('.Pane_foot', el).textContent = rewound() && !p.fork
        ? `Rewound to ${time.k} of ${order().length} blocks. Type to fork: your edit starts a new writer that has seen only this much.`
        : rewound()
        ? `Forked as ${
          name(p.actor.id)
        }. Its changes have seen only the past; go back to now and Automerge merges them with what came after.`
        : !e.online
        ? held
          ? `Offline. ${held} block${
            held == 1 ? '' : 's'
          } held in this browser, not shared yet.`
          : 'Offline. Your edits stay in this browser until you go back online.'
        : !p.joined
        ? 'You are reading. Your log starts with your first edit.'
        : e.seq
        ? `Your change ${e.seq} is block ${e.seq - 1} of your log.`
        : 'Your log is in the doc.'
      el.classList.toggle('Pane-offline', !e.online)
      el.classList.toggle('Pane-past', rewound() && !p.fork)
      el.classList.toggle('Pane-fork', rewound() && p.fork)
    }
    p.label = () => {
      let { name, color } = looks(p.actor.id)
      el.style.setProperty('--c', color)
      $('.Who_name', el).textContent = name
      $('.Who_note', el).textContent = p.fork && rewound()
        ? 'fork'
        : p.joined
        ? 'this browser'
        : 'not in the doc yet'
    }
    title.addEventListener('input', later)
    body.addEventListener('input', later)
    title.addEventListener('blur', p.flush)
    body.addEventListener('blur', p.flush)
    $('.Pane_online', el).addEventListener('change', async (ev) => {
      p.flush()
      $('.Switch_label', el).textContent = ev.target.checked
        ? 'Online'
        : 'Offline'
      await p.e.go(ev.target.checked)
      p.paint()
      pass()
    })
    $('.Pane_drop', el).hidden = !panes.length
    $('.Pane_drop', el).addEventListener('click', () => {
      p.flush()
      forget(doc, p.actor)
      panes.splice(panes.indexOf(p), 1)
      el.remove()
      layout()
      draw()
    })
    p.e = editor(doc, actor, send)
    panes.push(p)
    $('.Editors_list').append(el)
    layout()
    p.label()
    p.paint()
    return p
  }
  let layout = () => {
    $('.Editors_list').dataset.n = panes.length
    $('.Merge_add').disabled = panes.length >= 3
  }

  let details = () => {
    let lane = now.lanes.find((l) => l.blocks.some((b) => b.eid == selected))
    let held = panes.flatMap((p) => p.e.held).find((r) =>
      r.entity.eid == selected
    )
    let block = lane?.blocks.find((b) => b.eid == selected) ??
      (held && { ...held.block, eid: held.entity.eid })
    card.hidden = !block
    if (!block) return
    card.innerHTML = detail({
      block,
      looks,
      status: lane
        ? now.checks[now.lanes.indexOf(lane)].status.get(block.eid)
        : 'held',
      leaf: leafHash(block),
    })
  }

  // The doc at the rewound point. Stepping forward in one order only adds
  // changes, so the Automerge doc built last grows by them; any other move
  // rebuilds it from nothing.
  let rebuild = (applied) => {
    let was = time.built.eids
    let grows = was.length <= applied.length &&
      was.every((eid, i) => applied[i].eid == eid)
    let state = Automerge.applyChanges(
      grows ? time.built.state : Automerge.init(),
      applied.slice(grows ? was.length : 0).map((b) => b.change),
    )
    time.built = { eids: applied.map((b) => b.eid), state }
    return state
  }
  let chip = (a, s) =>
    `<span class="Chip" style="--c:${looks(a).color}"><i></i>${
      esc(name(a))
    } block ${s - 1}</span>`
  let step = () => {
    let all = order(), n = all.length, range = $('.Time_range')
    range.max = n
    $('.Time_now').hidden = !rewound()
    stage.classList.toggle('Stage-past', rewound())
    if (!rewound()) {
      time.past = null
      range.value = n
      $('.Time_at').innerHTML = `<b>Now</b> · ${n} block${
        n == 1 ? '' : 's'
      } in ${
        now.checks.filter((c) => c.trusted.length).length
      } logs. Drag to rewind.`
      $('.Time_queue').innerHTML = ''
      return null
    }
    let k = Math.min(time.k, n)
    range.value = k
    let t = at(all, k, time.forks)
    time.past = { ...t, state: rebuild(t.applied) }
    $('.Time_at').innerHTML =
      `<b>Rewound</b> to ${k} of ${n} blocks · ${t.applied.length} applied${
        t.waiting.length
          ? ` · <span class="Wait">${t.waiting.length} waiting</span>`
          : ''
      }`
    $('.Time_queue').innerHTML =
      t.waiting.slice(0, 3).map((c) =>
        `<li>${chip(c.actor, c.seq)} waits for ${
          needs(c, t.clock).map(([a, s]) => chip(a, s)).join(' ')
        }</li>`
      ).join('') + (t.waiting.length > 3
        ? `<li>and ${t.waiting.length - 3} more</li>`
        : '')
    return t.phase
  }
  let icon = (playing) =>
    $('.Time_icon').setAttribute(
      'd',
      playing ? 'M5.5 4.5h3v11h-3zM11.5 4.5h3v11h-3z' : 'M6 4.5v11l9-5.5z',
    )
  let stop = () => {
    clearInterval(time.timer)
    time.timer = null
    icon(false)
  }
  // Back at the present every writer hears everything again, so a fork's
  // changes merge with all that came after the point it began from.
  // A pane showing the past is repainted from the present before anything
  // flushes it, or its old text would read as an edit.
  let present = () => {
    stop()
    for (let p of panes) p.flush()
    time.k = null
    time.forks.clear()
    for (let p of panes) (p.fork = false, p.paint())
    pass()
  }
  let go = (k) => {
    for (let p of panes) p.flush()
    if (k >= order().length) return present()
    time.k = k
    draw()
  }
  let play = () => {
    if (time.timer) return stop()
    if (!rewound() || time.k >= order().length) go(0)
    icon(true)
    time.timer = setInterval(() => {
      if (time.k + 1 >= order().length) return present()
      go(time.k + 1)
    }, Math.max(80, Math.min(420, 7000 / Math.max(order().length, 1))))
  }

  let draw = () => {
    let phase = step()
    let held = Object.fromEntries(
      panes.filter((p) => p.e.held.length).map((p) => [p.actor.id, p.e.held]),
    )
    let shown = now.lanes.map((l, i) => [l, now.checks[i]])
      .filter(([l, c]) => c.trusted.length || held[l.actor])
    let view = {
      doc,
      lanes: shown.map(([l]) => l),
      checks: shown.map(([, c]) => c),
      looks,
      mine: new Set(panes.filter((p) => p.joined).map((p) => p.actor.id)),
      held,
      selected,
      phase,
      seen,
    }
    let end = scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 48
    let before = scroll.scrollHeight
    $('.Logs_heads').innerHTML = heads(view)
    $('.Logs_view').innerHTML = logs(view)
    for (let g of $$('.Block', $('.Logs_view'))) seen.add(g.dataset.eid)
    if (end && scroll.scrollHeight > before) {
      scroll.scrollTo({ top: scroll.scrollHeight, behavior: 'smooth' })
    }
    for (let p of panes) (p.label(), p.paint())
    details()
  }

  // Each pass checks every log and hands each writer what it trusts; a fork
  // hears nothing while the doc is rewound. Passes run one at a time; rows
  // that land during one run another after it.
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
        let known = new Set(time.shuffle.map((b) => b.eid))
        let kept = new Set(trusted.map((b) => b.eid))
        time.shuffle = [
          ...time.shuffle.filter((b) => kept.has(b.eid)),
          ...trusted.filter((b) => !known.has(b.eid)),
        ]
        for (let p of panes) {
          p.flush()
          if (!(rewound() && p.fork)) p.e.receive(trusted)
        }
        draw()
      } while (again)
      running = null
    })()
    return running
  }

  let pick = (ev) => {
    let g = ev.target.closest('[data-eid]')
    selected = g && g.dataset.eid != selected ? g.dataset.eid : null
    draw()
  }
  $('.Logs_view').addEventListener('click', pick)
  $('.Logs_view').addEventListener('keydown', (ev) => {
    if (ev.key == 'Enter' || ev.key == ' ') (ev.preventDefault(), pick(ev))
  })
  card.addEventListener('click', (ev) => {
    if (ev.target.closest('.Detail_close')) (selected = null, draw())
  })
  addEventListener('keydown', (ev) => {
    if (ev.key == 'Escape' && selected) (selected = null, draw())
  })

  $('.Time_play').addEventListener('click', play)
  $('.Time_now').addEventListener('click', present)
  $('.Time_range').addEventListener('input', (ev) => {
    stop()
    go(Number(ev.target.value))
  })
  for (let b of $$('.Seg_b')) {
    b.addEventListener('click', () => {
      stop()
      time.order = b.dataset.order
      if (time.order == 'shuffled') time.shuffle = shuffled(arrival())
      for (let o of $$('.Seg_b')) o.classList.toggle('Seg_b-on', o == b)
      go(0)
      play()
    })
  }

  // The chapter being read sets what the picture shows: on a wide screen the
  // one across the middle of the window, on a narrow one the card in view.
  let chapters = $$('.Chapter')
  let read = (el) => {
    for (let c of chapters) c.classList.toggle('Chapter-on', c == el)
    stage.dataset.focus = el.dataset.focus
  }
  let watching = null
  let watch = () => {
    watching?.disconnect()
    let narrow = matchMedia('(max-width: 959px)').matches
    watching = new IntersectionObserver(
      (es) => es.filter((e) => e.isIntersecting).forEach((e) => read(e.target)),
      narrow
        ? { root: $('.Story'), threshold: 0.6 }
        : { rootMargin: '-45% 0px -50% 0px' },
    )
    chapters.forEach((c) => watching.observe(c))
  }
  watch()
  matchMedia('(max-width: 959px)').addEventListener('change', watch)
  for (let c of chapters) {
    c.addEventListener('click', (ev) => {
      if (!ev.target.closest('a, button, input')) read(c)
    })
  }

  let live = subscribe(`(.block.doc=${doc}|.actor.doc=${doc})`, (all) => {
    rows = all
    pass()
  })
  let [who] = await Promise.all([
    me(),
    live.ready,
    kept(doc).then((held) => held.forEach((a) => pane(a, true))),
  ])
  if (who.writes && !panes.length) pane(await mint(), false)
  await pass()
  if (!now.checks[0]?.trusted.length) {
    $('.Story').hidden = stage.hidden = true
    $('.Missing').hidden = false
    return
  }
  if (!who.writes) toast('You can read this doc; only its members write.')
  $('.Merge_add').hidden = !who.writes
  $('.Merge_add').addEventListener('click', async () => {
    if (rewound()) present()
    let p = pane(await mint(), false)
    p.e.receive(arrival())
    p.paint()
    $('.Pane_body', p.el).focus()
    draw()
  })
}

if (typeof document != 'undefined') doc ? open() : home()
