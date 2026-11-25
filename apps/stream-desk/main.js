// The page: every phone presses shots and zoom steps, which are cues in the
// store; the one page connected to OBS (desk.js) plays them and tells every
// page what is on air.
import { apply, query, subscribe } from './api/client.js'
import { connect } from './obs.js'
import { desk } from './desk.js'
import { DESK, idOf, onAir, present, shots, STALE } from './model.js'
import { listen } from './ear.js'
import { LOOK, look } from './watch.js'

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

let state = {
  shots: [],
  cues: [],
  desk: null,
  mine: null,
  trouble: '',
  looked: '',
}
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
  let offer = offered(state.cues, Date.now())
  $('#suggest').innerHTML = offer
    ? `<p>The Operator suggests <strong>${
      esc(named.get(idOf(offer.cue.shot)))
    }</strong>${offer.suggested.why ? `: ${esc(offer.suggested.why)}` : ''}</p>
      <button data-take="${offer.entity.eid}">Take</button>`
    : ''
  $('#looked').textContent = mine ? state.looked : ''
  let newest = state.cues.filter((c) => !c.suggested).toSorted((a, b) =>
    b.created.at.localeCompare(a.created.at)
  )
  $('#log').innerHTML = newest.slice(0, 8).map((c) => {
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

// The Operator's newest suggestion, while it is fresh enough to take.
let offered = (cues, now) =>
  cues.filter((c) =>
    c.suggested && !c.aired && !c.missed &&
    now - Date.parse(c.created.at) < STALE - 5000
  ).at(-1) ?? null

document.addEventListener('click', (e) => {
  let take = e.target.closest('button[data-take]')
  if (take) {
    return apply({ entity: { eid: take.dataset.take }, suggested: null })
  }
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

// The model call one look makes, spent from the space's budget.
let see = async (request) => {
  let res = await fetch('./api/ai/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  })
  let said = await res.json()
  if (!res.ok) throw new Error(said.error?.message ?? `${res.status}`)
  return said
}

// While the desk runs: hear the sound input if asked, and look every LOOK.
let attend = async (obs, d, { watch, listen: hear }) => {
  let turns = []
  let ear = null
  if (hear) {
    try {
      let stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })
      ear = await listen(stream, (t) => turns = [...turns.slice(-200), t])
    } catch (e) {
      state.looked = `Not listening: ${e.message}`
    }
  }
  let busy = false
  let once = async () => {
    if (busy || !watch) return
    busy = true
    try {
      let all = state.shots
      let { usage, next } = await look({
        obs,
        see,
        apply,
        shots: all,
        lit: onAir(state.cues, all, d.scene()),
        turns,
        suggested: state.cues.filter((c) =>
          c.suggested && !c.aired && !c.missed
        ),
        now: ear?.at() ?? 0,
      })
      let named = all.find((s) => s.entity.eid == next?.shot)?.doc?.title
      state.looked = `The Operator looked at ${time(new Date().toISOString())}${
        usage
          ? `: ${usage.prompt_tokens} tokens in, ${usage.completion_tokens} out`
          : ''
      }, ${named ? `and suggests ${named}` : 'and suggests no change'}.${
        ear ? '' : ' Not listening.'
      }`
    } catch (e) {
      state.looked = `The Operator could not look: ${e.message}`
    }
    busy = false
    draw()
  }
  let timer = watch ? setInterval(once, LOOK) : null
  if (watch) once()
  return () => {
    clearInterval(timer)
    ear?.stop()
  }
}

let run = async ({ url, password, ...asked }) => {
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
    let leave = await attend(obs, d, asked)
    let why = await obs.closed
    leave()
    d.stop()
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
  let saved = {
    url: f.get('url'),
    password: f.get('password'),
    watch: !!f.get('watch'),
    listen: !!f.get('listen'),
  }
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
subscribe('.cue&?aired&?missed&?suggested&?created&limit=50', (rows) => {
  state.cues = rows
  kick?.()
  draw()
})
// A desk that stopped writing is away; the status is read again each beat.
let deskRows = []
let recheck = () => {
  state.desk = present(deskRows, Date.now())
  draw()
}
subscribe('.desk', (rows) => {
  deskRows = rows
  recheck()
})
setInterval(recheck, 15_000)
let saved = JSON.parse(localStorage.getItem(SAVED) ?? 'null')
if (saved) run(saved)
draw()
