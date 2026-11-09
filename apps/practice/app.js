// The practice planner's page: the practices to come, one practice minute by
// minute, and the drill library. Everything it draws comes from one
// subscription, and every change is one `apply`. Only the owner and editors
// see the controls; anyone else with the link sees the plan.
import { apply, drafts, me, subscribe } from './api/client.js'
import * as plan from './plan.js'
import { esc, footer, forms, need, toaster } from './ui.js'

let PUBLISHED = 'practice-planner'
let stage = document.getElementById('stage')
let foot = document.getElementById('foot')
let toast = toaster(document.getElementById('toast'))
let desk = drafts({ report: (e) => toast(e.message || String(e)) })
let { ask } = forms({ box: document.getElementById('ask'), desk, apply })
let who = { writes: false }
let rows = { practices: [], blocks: [], drills: [] }
let loaded = false

let kindClass = (kind) =>
  `k-${
    (plan.KINDS.includes(kind) ? kind : 'Other').toLowerCase().replace(
      /[^a-z]+/g,
      '-',
    )
  }`

// ── the list of practices ───────────────────────────────────────────────

let strip = (blocks) => {
  let all = plan.total(blocks)
  if (!all) return ''
  return `<span class="strip" aria-hidden="true">${
    blocks.map((b) =>
      `<i class="strip_Part ${kindClass(b.block.kind)}" style="flex:${
        b.block.minutes ?? 0
      }"></i>`
    ).join('')
  }</span>`
}

let card = (p) => {
  let blocks = plan.ordered(rows.blocks, p.entity.eid)
  let start = plan.clock(p.practice.start)
  let all = plan.total(blocks)
  let when = start == null
    ? ''
    : `${plan.hmDay(start)}${all ? ` – ${plan.hmDay(start + all)}` : ''}`
  return `<li><a class="card" href="#/p/${esc(p.entity.eid)}">
    <span class="card__date">${esc(plan.longDate(p.practice.date))}</span>
    <span class="card__team">${esc(p.practice.team || 'Practice')}${
    when ? ` · ${esc(when)}` : ''
  }</span>
    ${
    p.practice.focus
      ? `<span class="card__focus">${esc(p.practice.focus)}</span>`
      : ''
  }
    ${strip(blocks)}
    <span class="card__meta">${blocks.length} ${
    blocks.length == 1 ? 'drill' : 'drills'
  }${all ? `, ${plan.length(all)}` : ''}</span>
  </a></li>`
}

// The next few practices, and the rest a tap away: a coach plans a season
// ahead, and the page should open on this week, not on February.
let SHOWN = 6
let showAll = false

let listHtml = () => {
  let { next, past } = plan.calendar(rows.practices, plan.today())
  let add = who.writes
    ? `<button type="button" class="btn" data-act="new-practice">Plan a practice</button>`
    : ''
  let shown = showAll ? next : next.slice(0, SHOWN)
  let more = next.length - shown.length
  let upcoming = next.length
    ? `<ul class="cards">${shown.map(card).join('')}</ul>${
      more
        ? `<p class="more"><button type="button" class="link" data-act="all">Show ${more} more planned, through ${
          esc(plan.longDate(next.at(-1).practice.date))
        }</button></p>`
        : ''
    }`
    : `<p class="empty">No practices planned yet.${
      who.writes ? ' Plan the next one and add drills to it.' : ''
    }</p>`
  return `<div class="bar"><h2 class="h">Coming up</h2>${add}</div>
    ${upcoming}
    ${
    past.length
      ? `<h2 class="h h--gap">Already run</h2>
         <ul class="cards cards--past">${
        past.slice(0, 12).map(card).join('')
      }</ul>`
      : ''
  }`
}

// ── one practice ────────────────────────────────────────────────────────

let rowHtml = ({ row: b, from }, i, n) => {
  let eid = esc(b.entity.eid)
  let tools = who.writes
    ? `<span class="slot__tools">
        <button type="button" class="icon" data-act="up" data-id="${eid}" ${
      i == 0 ? 'disabled' : ''
    } aria-label="Move ${esc(b.doc?.title)} earlier">↑</button>
        <button type="button" class="icon" data-act="down" data-id="${eid}" ${
      i == n - 1 ? 'disabled' : ''
    } aria-label="Move ${esc(b.doc?.title)} later">↓</button>
        <button type="button" class="link" data-act="edit-block" data-id="${eid}">Edit</button>
      </span>`
    : ''
  return `<li class="slot ${kindClass(b.block.kind)}">
    <span class="slot__at">${esc(plan.hm(from))}</span>
    <div class="slot__main">
      <div class="slot__head">
        <h3 class="slot__name">${esc(b.doc?.title || 'Drill')}</h3>
        <span class="slot__mins">${esc(b.block.minutes ?? 0)} min</span>
      </div>
      ${
    b.block.kind ? `<span class="slot__kind">${esc(b.block.kind)}</span>` : ''
  }
      ${b.doc?.body ? `<p class="slot__points">${esc(b.doc.body)}</p>` : ''}
      ${tools}
    </div>
  </li>`
}

let practiceHtml = (p) => {
  let blocks = plan.ordered(rows.blocks, p.entity.eid)
  let line = plan.timeline(p.practice.start, blocks)
  let start = plan.clock(p.practice.start)
  let all = plan.total(blocks)
  let eid = esc(p.entity.eid)
  let when = start == null
    ? ''
    : `${plan.hmDay(start)} – ${plan.hmDay(start + all)}`
  return `<a class="back" href="#/">← All practices</a>
  <header class="head">
    <h2 class="head__title">${esc(plan.longDate(p.practice.date))}</h2>
    <p class="head__sub">${esc(p.practice.team || 'Practice')}${
    when ? ` · ${esc(when)}` : ''
  }${all ? ` · ${esc(plan.length(all))}` : ''}</p>
    ${
    p.practice.focus
      ? `<p class="head__focus"><b>Focus:</b> ${esc(p.practice.focus)}</p>`
      : ''
  }
    ${
    who.writes
      ? `<div class="head__tools">
        <button type="button" class="btn btn--quiet" data-act="edit-practice" data-id="${eid}">Edit details</button>
        <button type="button" class="btn btn--quiet" data-act="copy-practice" data-id="${eid}">Plan another like this</button>
        <button type="button" class="btn btn--quiet" data-act="print">Print</button>
      </div>`
      : `<div class="head__tools"><button type="button" class="btn btn--quiet" data-act="print">Print</button></div>`
  }
  </header>
  ${
    blocks.length
      ? `<ol class="slots">${
        line.map((s, i) => rowHtml(s, i, line.length)).join('')
      }</ol>
      <p class="end">Done at ${esc(plan.hmDay((start ?? 0) + all))}</p>`
      : `<p class="empty">No drills in this practice yet.</p>`
  }
  ${
    who.writes
      ? `<div class="bar bar--add"><button type="button" class="btn" data-act="add-block" data-id="${eid}">Add a drill</button></div>`
      : ''
  }
  <section class="notes">
    <div class="bar"><h2 class="h">Notes after practice</h2>${
    who.writes
      ? `<button type="button" class="link" data-act="notes" data-id="${eid}">${
        p.doc?.body ? 'Edit' : 'Write notes'
      }</button>`
      : ''
  }</div>
    ${
    p.doc?.body
      ? `<p class="notes__text">${esc(p.doc.body)}</p>`
      : '<p class="empty empty--small">Nothing written yet.</p>'
  }
  </section>
  ${
    who.writes
      ? `<p class="danger"><button type="button" class="link link--danger" data-act="del-practice" data-id="${eid}">Delete this practice</button></p>`
      : ''
  }`
}

// ── the drill library ───────────────────────────────────────────────────

let drillsHtml = () => {
  let add = who.writes
    ? `<button type="button" class="btn" data-act="new-drill">Add a drill</button>`
    : ''
  let shelves = plan.shelves(rows.drills)
  return `<div class="bar"><h2 class="h">Drills</h2>${add}</div>
  ${
    shelves.length
      ? shelves.map((s) =>
        `<section class="shelf">
          <h3 class="shelf__kind ${kindClass(s.kind)}">${esc(s.kind)}</h3>
          <ul class="drills">${
          s.drills.map((d) =>
            `<li class="drill">
              <div class="drill__head"><h4 class="drill__name">${
              esc(d.doc?.title)
            }</h4><span class="drill__mins">${
              esc(d.drill.minutes ?? '')
            } min</span></div>
              ${
              d.doc?.body
                ? `<p class="drill__points">${esc(d.doc.body)}</p>`
                : ''
            }
              ${
              d.drill.equipment
                ? `<p class="drill__gear"><b>Equipment:</b> ${
                  esc(d.drill.equipment)
                }</p>`
                : ''
            }
              ${
              who.writes
                ? `<button type="button" class="link" data-act="edit-drill" data-id="${
                  esc(d.entity.eid)
                }">Edit</button>`
                : ''
            }
            </li>`
          ).join('')
        }</ul>
        </section>`
      ).join('')
      : `<p class="empty">No drills saved yet.${
        who.writes
          ? ' Save the ones you run often, then add them to a practice in one tap.'
          : ''
      }</p>`
  }`
}

// ── drawing ─────────────────────────────────────────────────────────────

let route = () => location.hash.replace(/^#\/?/, '')

let draw = () => {
  let at = route()
  document.querySelectorAll('[data-tab]').forEach((a) =>
    a.setAttribute(
      'aria-current',
      String(a.dataset.tab == (at == 'drills' ? 'drills' : 'practices')),
    )
  )
  if (!loaded) return
  if (at == 'drills') stage.innerHTML = drillsHtml()
  else if (at.startsWith('p/')) {
    let p = rows.practices.find((r) => r.entity.eid == at.slice(2))
    stage.innerHTML = p
      ? practiceHtml(p)
      : '<p class="empty">That practice is not here any more. <a href="#/">See all practices</a></p>'
  } else stage.innerHTML = listHtml()
}

// ── the forms ───────────────────────────────────────────────────────────

let practiceFields = (p) => {
  let last = plan.calendar(rows.practices, '').next.at(-1)
  return [
    {
      name: 'date',
      label: 'Date',
      type: 'date',
      required: true,
      value: p?.practice.date ?? plan.today(),
    },
    {
      name: 'start',
      label: 'Starts at',
      type: 'time',
      required: true,
      value: p?.practice.start ?? last?.practice.start ?? '15:30',
    },
    {
      name: 'team',
      label: 'Team',
      value: p?.practice.team ?? last?.practice.team ?? '',
    },
    {
      name: 'focus',
      label: 'Focus',
      value: p?.practice.focus ?? '',
      hint: 'What this practice is for, in a few words.',
    },
  ]
}

let practiceOf = (v) => {
  need(v.date, 'Choose the date.')
  need(plan.clock(v.start) != null, 'Choose the time it starts.')
  return {
    date: v.date,
    start: v.start,
    team: v.team.trim(),
    focus: v.focus.trim(),
  }
}

let kindOptions = [['', 'No kind'], ...plan.KINDS.map((k) => [k, k])]

let blockFields = (b, from = []) => [
  ...(from.length
    ? [{
      name: 'from',
      label: 'From your drills',
      type: 'select',
      value: '',
      options: [['', 'A new drill, written here'], ...from],
    }]
    : []),
  { name: 'title', label: 'Drill', value: b?.doc?.title ?? '' },
  {
    name: 'minutes',
    label: 'Minutes',
    type: 'number',
    value: b?.block.minutes ?? 10,
  },
  {
    name: 'kind',
    label: 'Kind',
    type: 'select',
    value: b?.block.kind ?? '',
    options: kindOptions,
  },
  {
    name: 'points',
    label: 'Coaching points',
    type: 'textarea',
    value: b?.doc?.body ?? '',
  },
]

let blockOf = (v) => {
  need(v.title.trim(), 'Name the drill.')
  let mins = plan.minutes(v.minutes)
  need(mins, 'Minutes is a whole number from 1 to 240.')
  return {
    title: v.title.trim(),
    minutes: mins,
    kind: v.kind,
    points: v.points,
  }
}

// ── what each button does ───────────────────────────────────────────────

let acts = {
  'new-practice': () =>
    ask({
      title: 'Plan a practice',
      fields: practiceFields(),
      save: (
        v,
      ) => [{
        entity: { eid: '$practice' },
        practice: practiceOf(v),
        doc: { title: '' },
      }],
    }),

  'edit-practice': (p) =>
    ask({
      title: 'Practice details',
      fields: practiceFields(p),
      save: (v) => [{ entity: { eid: p.entity.eid }, practice: practiceOf(v) }],
      remove: () => apply({ entity: { eid: p.entity.eid }, tombstone: {} }),
    }),

  'copy-practice': (p) =>
    ask({
      title: 'Plan another like this',
      fields: [{
        name: 'date',
        label: 'Date',
        type: 'date',
        required: true,
        value: plan.weekAfter(p.practice.date),
      }],
      save: (v) => {
        need(v.date, 'Choose the date.')
        return plan.copy(p, plan.ordered(rows.blocks, p.entity.eid), v.date)
      },
    }).then((ok) => {
      if (!ok) return
      toast('Planned. It is under Coming up.')
      location.hash = '#/'
    }),

  'del-practice': async (p) => {
    if (!confirm('Delete this practice and its drills?')) return
    await apply({ entity: { eid: p.entity.eid }, tombstone: {} })
    location.hash = '#/'
  },

  notes: (p) =>
    ask({
      title: 'Notes after practice',
      fields: [{
        name: 'body',
        label: 'What went well, what to work on next time',
        type: 'textarea',
        value: p.doc?.body ?? '',
      }],
      place: `practice:${p.entity.eid}:notes`,
      save: (v) => [{ entity: { eid: p.entity.eid }, doc: { body: v.body } }],
    }),

  'add-block': (p) => {
    let blocks = plan.ordered(rows.blocks, p.entity.eid)
    let library = plan.shelves(rows.drills).flatMap((s) => s.drills)
    let options = library.map((
      d,
    ) => [d.entity.eid, `${d.doc?.title} (${d.drill.minutes ?? 10} min)`])
    ask({
      title: 'Add a drill',
      fields: blockFields(null, options),
      place: `practice:${p.entity.eid}:new-block`,
      change: (ev, named) => {
        if (ev.target.name != 'from' || !ev.target.value) return
        let d = library.find((x) => x.entity.eid == ev.target.value)
        if (!d) return
        named('title').value = d.doc?.title ?? ''
        named('minutes').value = d.drill.minutes ?? 10
        named('kind').value = d.drill.kind ?? ''
        let points = named('points')
        points.value = d.doc?.body ?? ''
        points.dispatchEvent(new Event('input', { bubbles: true }))
      },
      save: (v) => {
        let b = blockOf(v)
        return [{
          entity: { eid: '$block' },
          block: {
            practice: p.entity.eid,
            ord: plan.after(blocks),
            minutes: b.minutes,
            kind: b.kind,
          },
          doc: { title: b.title, body: b.points },
        }]
      },
    })
  },

  'edit-block': (b) =>
    ask({
      title: 'Edit drill',
      fields: blockFields(b),
      place: `block:${b.entity.eid}:points`,
      save: (v) => {
        let x = blockOf(v)
        return [{
          entity: { eid: b.entity.eid },
          block: { minutes: x.minutes, kind: x.kind },
          doc: { title: x.title, body: x.points },
        }]
      },
      remove: () => apply({ entity: { eid: b.entity.eid }, tombstone: {} }),
    }),

  up: (b) => shift(b, -1),
  down: (b) => shift(b, 1),

  'new-drill': () => drillForm(null),
  'edit-drill': (d) => drillForm(d),

  print: () => print(),

  all: () => {
    showAll = true
    draw()
  },
}

let shift = async (b, by) => {
  let ref = b.block.practice
  let blocks = plan.ordered(rows.blocks, typeof ref == 'object' ? ref.eid : ref)
  let patches = plan.move(blocks, b.entity.eid, by)
  if (patches.length) await apply(patches)
}

let drillForm = (d) =>
  ask({
    title: d ? 'Edit drill' : 'Add a drill',
    fields: [
      { name: 'title', label: 'Drill', value: d?.doc?.title ?? '' },
      {
        name: 'minutes',
        label: 'Usual minutes',
        type: 'number',
        value: d?.drill.minutes ?? 10,
      },
      {
        name: 'kind',
        label: 'Kind',
        type: 'select',
        value: d?.drill.kind ?? '',
        options: kindOptions,
      },
      {
        name: 'equipment',
        label: 'Equipment',
        value: d?.drill.equipment ?? '',
      },
      {
        name: 'points',
        label: 'How it runs and what to watch for',
        type: 'textarea',
        value: d?.doc?.body ?? '',
      },
    ],
    place: d ? `drill:${d.entity.eid}:points` : 'drill:new:points',
    save: (v) => {
      let x = blockOf(v)
      return [{
        entity: { eid: d?.entity.eid ?? '$drill' },
        drill: {
          minutes: x.minutes,
          kind: x.kind,
          equipment: v.equipment.trim(),
        },
        doc: { title: x.title, body: x.points },
      }]
    },
    remove: d
      ? () => apply({ entity: { eid: d.entity.eid }, tombstone: {} })
      : null,
  })

let find = (eid) =>
  [...rows.practices, ...rows.blocks, ...rows.drills].find((r) =>
    r.entity.eid == eid
  )

stage.addEventListener('click', async (ev) => {
  let btn = ev.target.closest('[data-act]')
  if (!btn || btn.disabled) return
  let act = acts[btn.dataset.act]
  if (!act) return
  try {
    await act(btn.dataset.id ? find(btn.dataset.id) : null)
  } catch (e) {
    toast(e.message || String(e))
  }
})

// ── start ───────────────────────────────────────────────────────────────

addEventListener('hashchange', () => {
  draw()
  scrollTo(0, 0)
})
subscribe(plan.EVERYTHING, (all) => {
  rows = plan.split(all)
  loaded = true
  draw()
}).ready.catch((e) => {
  stage.innerHTML = `<p class="empty">${esc(e.message || String(e))}</p>`
})
let drawFoot = () =>
  footer(foot, { published: PUBLISHED, readOnly: !who.writes })
me().then((w) => {
  who = w
  draw()
  drawFoot()
}).catch(drawFoot)
