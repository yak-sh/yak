// The page: start a video, follow it through the workflow (seed.json), hear
// each character's auditions and choose its voice, and play the cut.
import { apply, query, subscribe } from './api/client.js'
import { idOf, progress, stage } from './model.js'

let $ = (s) => document.querySelector(s)
let esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  )
let blob = (eid) => `./api/blob/${encodeURIComponent(eid)}`

let state = { videos: [], rows: [], failed: [], steps: new Map(), open: null }

let draw = () => {
  let { videos, open } = state
  $('#videos').innerHTML = videos.map((v) =>
    `<button data-open="${v.entity.eid}" aria-current="${
      v.entity.eid == open
    }">${esc(v.doc?.title)}</button>`
  ).join('')
  let video = videos.find((v) => v.entity.eid == open)
  $('#video').innerHTML = video ? page(video) : ''
}

let page = (video) => {
  let p = progress(video.entity.eid, state.rows, state.failed)
  let problems = p.failed.map((b) =>
    `<p class="failed">${
      esc(state.steps.get(idOf(b.build.builder)) ?? 'A step')
    }: ${esc(b.failed.reason)}</p>`
  ).join('')
  return `
    <h2>${esc(video.doc?.title)}</h2>
    <p class="soft">${esc(video.doc?.body)}</p>
    <p><strong>${esc(stage(p))}</strong></p>
    ${problems}
    ${p.cut ? player() : ''}
    ${p.roles.length ? '<h2>Voices</h2>' : ''}
    ${p.roles.map(role).join('')}
    ${p.lines.length ? '<h2>Script</h2>' : ''}
    <ol>${
    p.lines.map((l) =>
      `<li class="${l.audio ? 'voiced' : ''}"><strong>${esc(l.who)}:</strong> ${
        esc(l.text)
      }</li>`
    ).join('')
  }</ol>`
}

let role = (r) => `
  <div class="role step">
    <strong>${esc(r.name)}</strong> <span class="soft">${esc(r.about)}</span>
    ${
  r.auditions.map((a) => `
      <div class="take">
        <audio controls preload="none" src="${blob(a.audition.audio)}"></audio>
        ${
    r.chosen == a.audition.name
      ? `<span class="chosen">${esc(a.audition.name)}, chosen</span>`
      : `<button data-ask="${r.ask}" data-choice="${esc(a.audition.name)}" ${
        r.ask ? '' : 'disabled'
      }>Use ${esc(a.audition.name)}</button>`
  }
      </div>`).join('')
}
  </div>`

let player = () => `
  <div class="step">
    <button data-play>Play</button>
    <p class="caption" id="caption"></p>
  </div>`

// The cut's lines one after another, each shown as it is said.
let play = async () => {
  let video = state.videos.find((v) => v.entity.eid == state.open)
  let { cut } = progress(video.entity.eid, state.rows)
  for (let clip of cut.clips) {
    $('#caption').textContent = `${clip.who}: ${clip.text}`
    let audio = new Audio(blob(clip.audio))
    await new Promise((done) => {
      audio.onended = audio.onerror = done
      audio.play().catch(done)
    })
  }
  $('#caption').textContent = ''
}

$('#start').addEventListener('submit', async (e) => {
  e.preventDefault()
  let form = new FormData(e.target)
  let { aliases } = await apply({
    entity: { eid: '$video' },
    video: {},
    doc: { title: form.get('title'), body: form.get('brief') },
  })
  e.target.reset()
  state.open = aliases.$video
  draw()
})

document.addEventListener('click', async (e) => {
  let b = e.target.closest('button')
  if (!b) return
  if (b.dataset.open) {
    state.open = b.dataset.open
    draw()
  } else if (b.dataset.ask) {
    b.disabled = true
    await apply({
      entity: { eid: b.dataset.ask },
      decided: { choice: b.dataset.choice },
    })
  } else if ('play' in b.dataset) {
    await play()
  }
})

for (let s of await query('.builder&?doc')) {
  state.steps.set(s.entity.eid, s.doc?.title)
}
subscribe('.video&?doc', (rows) => {
  state.videos = rows.toReversed()
  state.open ??= state.videos[0]?.entity.eid ?? null
  draw()
})
subscribe('.built.current=true&*', (rows) => {
  state.rows = rows
  draw()
})
subscribe('.build&.failed&?build', (rows) => {
  state.failed = rows
  draw()
})
