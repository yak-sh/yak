// The page: every phone presses shots and zoom steps, which are cues in the
// store; the one page connected to OBS (desk.js) plays them and tells every
// page what is on air.
import { apply, query, subscribe } from './api/client.js'
import { connect } from './obs.js'
import { desk } from './desk.js'
import { DESK, idOf, onAir, shots } from './model.js'

let $ = (s) => document.querySelector(s)
let esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  )
let time = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

let state = { shots: [], cues: [], desk: null, mine: null, trouble: '' }
let SAVED = 'stream-desk obs'

let draw = () => {
  let { desk: d, mine, trouble } = state
  $('#status').textContent = trouble ||
    (d
      ? `On air: ${d.scene}${mine ? ' (this computer is the desk)' : ''}`
      : 'No desk is connected. Open this page on the computer running OBS and connect it below.')
  let lit = d ? onAir(state.cues, state.shots, d.scene) : null
  $('#shots').innerHTML = state.shots.map((s) =>
    `<button data-shot="${s.entity.eid}" aria-pressed="${
      s.entity.eid == lit
    }">${esc(s.doc?.title)}<small>${
      esc(
        [s.shot.scene, s.shot.preset && `preset ${s.shot.preset}`]
          .filter(Boolean).join(', '),
      )
    }</small></button>`
  ).join('')
  let named = new Map(state.shots.map((s) => [s.entity.eid, s.doc?.title]))
  $('#log').innerHTML = state.cues.toReversed().slice(0, 8).map((c) => {
    let what = c.cue.zoom
      ? (c.cue.zoom > 0 ? 'Zoom in' : 'Zoom out')
      : named.get(idOf(c.cue.shot)) ?? 'A shot'
    let how = c.missed
      ? `<span class="missed">missed: ${esc(c.missed.reason)}</span>`
      : c.aired
      ? `<span class="soft">${time(c.aired.at)}</span>`
      : '<span class="soft">waiting for the desk</span>'
    return `<li>${esc(what)} ${how}</li>`
  }).join('')
  $('#scenes').innerHTML = (d?.scenes ?? []).map((s) =>
    `<option value="${esc(s)}">`
  ).join('')
  $('#leave').hidden = !mine
}

let press = (cue) => apply({ entity: { eid: '$cue' }, cue })

document.addEventListener('click', (e) => {
  let b = e.target.closest('button[data-shot], button[data-zoom]')
  if (!b) return
  press(b.dataset.shot ? { shot: b.dataset.shot } : { zoom: +b.dataset.zoom })
})

$('#shot').addEventListener('submit', async (e) => {
  e.preventDefault()
  let f = new FormData(e.target)
  let shot = { n: state.shots.length + 1 }
  for (let k of ['scene', 'preset']) if (f.get(k)) shot[k] = f.get(k)
  await apply({
    entity: { eid: '$shot' },
    doc: { title: f.get('title') },
    shot,
  })
  e.target.reset()
})

// Being the desk: connect to OBS, relay what it shows, play every cue, and
// connect again when OBS goes away, until this page is told to stop.
let kick = null
let run = async ({ url, password }) => {
  try {
    let obs = await connect(url, password)
    let d = await desk({
      query,
      apply,
      obs,
      relay: (seen) => apply({ entity: { eid: DESK }, desk: seen }),
    })
    state.mine = obs
    state.trouble = ''
    kick = d.kick
    kick()
    draw()
    let why = await obs.closed
    kick = null
    if (state.mine == obs) state.trouble = `${why}. Connecting again…`
  } catch (e) {
    let refused = e.message == 'OBS refused the password'
    if (refused) localStorage.removeItem(SAVED)
    state.trouble = refused ? `${e.message}.` : `${e.message}. Trying again…`
  }
  draw()
  let saved = JSON.parse(localStorage.getItem(SAVED) ?? 'null')
  if (saved) setTimeout(() => run(saved), 5000)
}

$('#connect').addEventListener('submit', (e) => {
  e.preventDefault()
  let f = new FormData(e.target)
  let saved = { url: f.get('url'), password: f.get('password') }
  localStorage.setItem(SAVED, JSON.stringify(saved))
  run(saved)
})
$('#leave').addEventListener('click', () => {
  localStorage.removeItem(SAVED)
  let obs = state.mine
  state.mine = null
  state.trouble = ''
  obs?.close()
  apply({ entity: { eid: DESK }, desk: null })
  draw()
})

subscribe('.shot&?doc', (rows) => {
  state.shots = shots(rows)
  draw()
})
subscribe('.cue&?aired&?missed&?created&limit=50', (rows) => {
  state.cues = rows
  kick?.()
  draw()
})
subscribe(`.desk`, (rows) => {
  state.desk = rows.find((r) => r.entity.eid == DESK)?.desk ?? null
  draw()
})
let saved = JSON.parse(localStorage.getItem(SAVED) ?? 'null')
if (saved) run(saved)
draw()
