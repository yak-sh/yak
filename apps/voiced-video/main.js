// The page: start a video from an idea, follow it through the workflow
// (seed.json), change any step's output in place (the idea, a line, a
// shot), choose each voice, and watch the finished file. A change reruns
// only the steps that read it.
import { apply, morph, subscribe } from './api/client.js'
import { progress, stage } from './model.js'

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
let secs = (ms) => `${(ms / 1000).toFixed(1)} s`

let state = { videos: [], rows: [], refused: [], open: null }

let draw = () => {
  // A field being typed in keeps its words until it is left.
  if (document.activeElement?.matches('[data-edit]')) return
  let { videos, open } = state
  morph(
    $('#videos'),
    videos.map((v) =>
      `<button data-open="${v.entity.eid}" aria-current="${
        v.entity.eid == open
      }">${esc(v.doc?.title)}</button>`
    ).join(''),
  )
  let video = videos.find((v) => v.entity.eid == open)
  morph($('#video'), video ? page(video) : '')
}

let edit = (eid, path, value, rows = 2) =>
  `<textarea data-edit="${eid}" data-path="${path}" rows="${rows}">${
    esc(value)
  }</textarea>`

let page = (video) => {
  let p = progress(video.entity.eid, state.rows)
  let problems = state.refused.slice(-3).map((r) =>
    `<p class="failed">${esc(r.content?.body)}</p>`
  ).join('')
  return `
    <h2>${esc(video.doc?.title)}</h2>
    <p><strong>${esc(stage(p))}</strong></p>
    ${problems}
    ${
    p.film
      ? `<video controls src="${blob(p.film.file)}"></video>
         <p class="soft"><a href="${
        blob(p.film.file)
      }" download>Download the MP4</a>, ${secs(p.film.ms ?? 0)}</p>`
      : ''
  }
    <h3>Idea</h3>
    ${edit(video.entity.eid, 'doc.body', video.doc?.body, 4)}
    ${p.roles.length ? '<h3>Casting</h3>' : ''}
    ${p.roles.map(role).join('')}
    ${p.lines.length ? '<h3>Script</h3>' : ''}
    <ol class="lines">${
    p.lines.map((l) =>
      `<li class="${l.audio ? 'voiced' : ''}"><strong>${esc(l.who)}</strong>
        <span class="soft">shot ${l.shot ?? '?'}</span>
        ${edit(l.eid, 'doc.body', l.text)}
        ${
        l.audio
          ? `<audio controls preload="none" src="${blob(l.audio)}"></audio>`
          : ''
      }</li>`
    ).join('')
  }</ol>
    ${p.shots.length ? '<h3>Storyboard</h3>' : ''}
    ${p.shots.map(shot).join('')}`
}

let take = (r, a) => `
  <div class="take">
    ${
  a.audio
    ? `<audio class="take-audio" controls preload="none" src="${
      blob(a.audio)
    }"></audio>`
    : ''
}
    ${
  r.chosen == a.name
    ? `<span class="chosen">${esc(a.name)}, chosen</span>`
    : `<button data-ask="${r.ask}" data-choice="${esc(a.name)}" ${
      r.ask ? '' : 'disabled'
    }>Use ${esc(a.name)}</button>`
}
    <span class="soft">${esc(a.provider)}</span>
  </div>`

let role = (r) => {
  let voices = r.auditions.map((a) => a.audition)
  let shown = (a) => a.audio || r.chosen == a.name
  let more = voices.filter((a) => !shown(a))
  return `
    <div class="role step">
      <strong>${esc(r.name)}</strong> <span class="soft">${esc(r.about)}</span>
      ${voices.filter(shown).map((a) => take(r, a)).join('')}
      ${
    more.length
      ? `<details><summary>More ElevenLabs voices</summary>${
        more.map((a) => take(r, a)).join('')
      }</details>`
      : ''
  }
    </div>`
}

let shot = (s) => `
  <div class="step shot">
    <strong>${s.n}. ${esc(s.title)}</strong>
    <span class="soft">${esc(s.page)} as ${esc(s.as)}</span>
    ${
  s.film
    ? `<video controls preload="none" muted src="${blob(s.film)}"></video>`
    : '<p class="soft">Waiting to be filmed.</p>'
}
    <details><summary>Steps</summary>
      ${edit(s.eid, 'shot.steps', JSON.stringify(s.steps ?? [], null, 1), 6)}
    </details>
  </div>`

// What a field's words write: the path's component and property.
let patch = (path, text) => {
  let [comp, prop] = path.split('.')
  let value = prop == 'steps' ? JSON.parse(text) : text
  return { [comp]: { [prop]: value } }
}

document.addEventListener('change', async (e) => {
  let f = e.target.closest('[data-edit]')
  if (!f) return
  try {
    await apply({
      entity: { eid: f.dataset.edit },
      ...patch(f.dataset.path, f.value),
    })
    f.classList.remove('bad')
  } catch {
    f.classList.add('bad')
  }
})
document.addEventListener('focusout', () => setTimeout(draw))

$('#start').addEventListener('submit', async (e) => {
  e.preventDefault()
  let form = new FormData(e.target)
  let { aliases } = await apply({
    entity: { eid: '$video' },
    video: { seconds: Number(form.get('seconds')) || 45 },
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
  }
})

subscribe('.video&?doc&?video', (rows) => {
  state.videos = rows.toReversed()
  state.open ??= state.videos[0]?.entity.eid ?? null
  draw()
})
subscribe(
  '(.role|.line|.panel|.audition|.cast|.voicing|.take|.cut|.film)&*',
  (rows) => {
    state.rows = rows
    draw()
  },
)
subscribe('.refusal&?content', (rows) => {
  state.refused = rows
  draw()
})
