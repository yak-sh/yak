// The handout library's page: every handout on one shelf, narrowed by who it
// is for or by a search, and each one as a page to read, print or download.
// Only the owner and editors see the controls; anyone with the link reads.
import { apply, drafts, me, search, subscribe, upload } from './api/client.js'
import * as h from './handout.js'
import { esc, footer, forms, need, toaster } from './ui.js'

let PUBLISHED = 'handout-library'
let stage = document.getElementById('stage')
let foot = document.getElementById('foot')
let toast = toaster(document.getElementById('toast'))
let desk = drafts({ report: (e) => toast(e.message || String(e)) })
let { ask } = forms({ box: document.getElementById('ask'), desk, apply })
let who = { writes: false }
let rows = []
let loaded = false
let view = { audience: '', words: '', found: null }

// ── the shelf ───────────────────────────────────────────────────────────

let badge = (r) =>
  r.handout.file
    ? `<span class="badge">${esc(h.kind(r.handout.mime, r.handout.name))}${
      r.handout.bytes ? ` · ${esc(h.size(r.handout.bytes))}` : ''
    }</span>`
    : ''

let card = (r) =>
  `<li><a class="card" href="#/h/${esc(r.entity.eid)}">
    <span class="card__for">${esc(r.handout.audience || 'Everyone')}${
    r.handout.team ? ` · ${esc(r.handout.team)}` : ''
  }</span>
    <span class="card__title">${esc(r.doc?.title || 'Untitled')}</span>
    ${
    h.gist(r.doc?.body)
      ? `<span class="card__gist">${esc(h.gist(r.doc?.body))}</span>`
      : ''
  }
    <span class="card__foot">${badge(r)}<span class="card__day">${
    esc(h.day(r.updated?.at ?? r.created?.at))
  }</span></span>
  </a></li>`

let shelfHtml = () => {
  let shown = view.found ?? h.newest(h.forWhom(rows, view.audience))
  let chips = ['', ...h.AUDIENCES].map((a) =>
    `<button type="button" class="chip" data-act="for" data-for="${
      esc(a)
    }" aria-pressed="${view.audience == a && !view.found}">${
      a ? `For ${esc(a.toLowerCase())}` : 'Everything'
    }</button>`
  ).join('')
  return `<form class="find" role="search" data-find>
      <label class="vh" for="words">Search the handouts</label>
      <input class="find_Input" id="words" name="words" type="search" placeholder="Search the handouts" value="${
    esc(view.words)
  }">
      <button type="submit" class="btn btn--quiet">Search</button>
    </form>
    <div class="bar">
      <div class="chips">${chips}</div>
      ${
    who.writes
      ? '<button type="button" class="btn" data-act="new">Add a handout</button>'
      : ''
  }
    </div>
    ${
    view.found
      ? `<p class="said">${view.found.length} ${
        view.found.length == 1 ? 'handout matches' : 'handouts match'
      } “${
        esc(view.words)
      }”. <button type="button" class="link" data-act="clear">Show everything</button></p>`
      : ''
  }
    ${
    shown.length
      ? `<ul class="cards">${shown.map(card).join('')}</ul>`
      : `<p class="empty">${
        rows.length
          ? 'Nothing here yet.'
          : `No handouts yet.${
            who.writes ? ' Add one: write it here, attach a PDF, or both.' : ''
          }`
      }</p>`
  }`
}

// ── one handout ─────────────────────────────────────────────────────────

let handoutHtml = (r) => {
  let eid = esc(r.entity.eid)
  let file = r.handout.file
    ? `<p class="file">
        <a class="btn" href="./api/blob/${esc(r.handout.file)}" download="${
      esc(r.handout.name || 'handout')
    }">Download ${esc(h.kind(r.handout.mime, r.handout.name))}</a>
        <a class="link" href="./api/blob/${
      esc(r.handout.file)
    }" target="_blank" rel="noopener">Open it</a>
        <span class="file__about">${esc(r.handout.name)}${
      r.handout.bytes ? `, ${esc(h.size(r.handout.bytes))}` : ''
    }</span>
      </p>`
    : ''
  return `<a class="back" href="#/">← All handouts</a>
  <article class="sheet">
    <p class="sheet__for">${esc(r.handout.audience || 'Everyone')}${
    r.handout.team ? ` · ${esc(r.handout.team)}` : ''
  }</p>
    <h2 class="sheet__title">${esc(r.doc?.title || 'Untitled')}</h2>
    ${
    h.day(r.updated?.at ?? r.created?.at)
      ? `<p class="sheet__day">Updated ${
        esc(h.day(r.updated?.at ?? r.created?.at))
      }</p>`
      : ''
  }
    ${file}
    <div class="sheet__text">${h.page(r.doc?.body)}</div>
  </article>
  <div class="tools">
    <button type="button" class="btn btn--quiet" data-act="print">Print</button>
    <button type="button" class="btn btn--quiet" data-act="link">Copy the link</button>
    ${
    who.writes
      ? `<button type="button" class="btn btn--quiet" data-act="edit" data-id="${eid}">Edit</button>`
      : ''
  }
  </div>`
}

// ── drawing ─────────────────────────────────────────────────────────────

let route = () => location.hash.replace(/^#\/?/, '')

let draw = () => {
  if (!loaded) return
  let at = route()
  if (at.startsWith('h/')) {
    let r = rows.find((x) => x.entity.eid == at.slice(2))
    stage.innerHTML = r
      ? handoutHtml(r)
      : '<p class="empty">That handout is not here any more. <a href="#/">See all handouts</a></p>'
    document.title = r ? `${r.doc?.title} · Handout library` : 'Handout library'
  } else {
    stage.innerHTML = shelfHtml()
    document.title = 'Handout library'
  }
}

// ── the form ────────────────────────────────────────────────────────────

let edit = (r) =>
  ask({
    title: r ? 'Edit handout' : 'Add a handout',
    place: r ? `handout:${r.entity.eid}:text` : 'handout:new:text',
    fields: [
      { name: 'title', label: 'Title', value: r?.doc?.title ?? '' },
      {
        name: 'audience',
        label: 'Who it is for',
        type: 'select',
        value: r?.handout.audience ?? h.AUDIENCES[0],
        options: h.AUDIENCES.map((a) => [a, a]),
      },
      {
        name: 'team',
        label: 'Team',
        value: r?.handout.team ?? '',
        hint: 'Leave it empty for every team.',
      },
      {
        name: 'body',
        label: 'Text',
        type: 'textarea',
        value: r?.doc?.body ?? '',
        hint: 'A blank line starts a paragraph, “## ” a heading, “- ” a list.',
      },
      {
        name: 'file',
        label: r?.handout.file ? `Replace ${r.handout.name}` : 'Attach a file',
        type: 'file',
        hint: 'A PDF, a picture or any document, up to 25 MB.',
      },
    ],
    save: async (v) => {
      need(v.title.trim(), 'Give the handout a title.')
      let picked = v.file instanceof Blob && v.file.size ? v.file : null
      need(
        picked || v.body.trim() || r?.handout.file,
        'Write the handout or attach a file.',
      )
      let file = picked ? await upload(picked) : null
      return [{
        entity: { eid: r?.entity.eid ?? '$handout' },
        handout: {
          audience: v.audience,
          team: v.team.trim(),
          ...(file
            ? {
              file: file.eid,
              name: picked.name,
              mime: file.mime,
              bytes: file.bytes,
            }
            : {}),
        },
        doc: { title: v.title.trim(), body: v.body },
      }]
    },
    remove: r
      ? async () => {
        await apply({ entity: { eid: r.entity.eid }, tombstone: {} })
        location.hash = '#/'
      }
      : null,
  })

// ── what each button does ───────────────────────────────────────────────

let acts = {
  new: () => edit(null),
  edit: (r) => edit(r),
  print: () => print(),
  link: async () => {
    try {
      await navigator.clipboard.writeText(location.href)
      toast('Link copied. Paste it into an email or a team chat.')
    } catch {
      toast(location.href)
    }
  },
  for: (_, btn) => {
    view = { audience: btn.dataset.for, words: '', found: null }
    draw()
  },
  clear: () => {
    view = { audience: '', words: '', found: null }
    draw()
  },
}

stage.addEventListener('click', async (ev) => {
  let btn = ev.target.closest('[data-act]')
  if (!btn) return
  let r = btn.dataset.id
    ? rows.find((x) => x.entity.eid == btn.dataset.id)
    : null
  try {
    await acts[btn.dataset.act]?.(r, btn)
  } catch (e) {
    toast(e.message || String(e))
  }
})

stage.addEventListener('submit', async (ev) => {
  if (!ev.target.matches('[data-find]')) return
  ev.preventDefault()
  let words = new FormData(ev.target).get('words').trim()
  if (!words) return acts.clear()
  try {
    let hits = await search(words, '.handout&?doc&?created&?updated')
    view = { audience: '', words, found: hits.filter((x) => x.handout) }
    draw()
  } catch (e) {
    toast(e.message || String(e))
  }
})

// ── start ───────────────────────────────────────────────────────────────

addEventListener('hashchange', () => {
  draw()
  scrollTo(0, 0)
})
subscribe(h.EVERYTHING, (all) => {
  rows = all
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
