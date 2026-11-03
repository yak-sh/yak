// The slideshow's page: the slideshows, one slideshow's slides, and playing
// one full screen. Everything it draws comes from one subscription, so a
// slide changed from a phone shows on the screen that is playing it a moment
// later. Only the owner and editors see the controls; anyone else with the
// link watches.
import { apply, drafts, me, subscribe, upload } from './api/client.js'
import * as show from './show.js'
import { esc, footer, forms, need, toaster } from './ui.js'

let PUBLISHED = 'slideshow'
let stage = document.getElementById('stage')
let foot = document.getElementById('foot')
let deck = document.getElementById('play')
let toast = toaster(document.getElementById('toast'))
let desk = drafts({ report: (e) => toast(e.message || String(e)) })
let { ask } = forms({ box: document.getElementById('ask'), desk, apply })
let who = { writes: false }
let rows = { shows: [], slides: [] }
let loaded = false

let route = () => {
  let [, where = '', eid = '', n = ''] = location.hash.split('/')
  return { where, eid: decodeURIComponent(eid), n: Number(n) || 0 }
}
let showOf = (eid) => rows.shows.find((s) => s.entity.eid == eid)
let slidesOf = (eid) => show.ordered(rows.slides, eid)

// ── one slide, the same markup on a card and full screen ────────────────
// A slide sizes its type to its frame (container units), so a thumbnail is
// the slide itself, only smaller.

let slideHtml = (s, i = 0) => {
  let layout = show.layoutOf(s)
  let title = s.doc?.title
    ? `<h2 class="slide__title">${esc(s.doc.title)}</h2>`
    : ''
  let body = s.doc?.body
    ? `<p class="slide__body">${esc(s.doc.body).replace(/\n/g, '<br>')}</p>`
    : ''
  let photo = layout == 'words'
    ? ''
    : `<img class="slide__img" src="./api/blob/${
      esc(s.slide.photo)
    }" alt="" decoding="async"${i > 1 ? ' loading="lazy"' : ''}>`
  return `<figure class="slide slide--${layout}">${photo}<figcaption class="slide__words">${title}${body}</figcaption></figure>`
}

let blank =
  `<figure class="slide slide--words slide--blank"><figcaption class="slide__words"><p class="slide__body">No slides yet</p></figcaption></figure>`

// ── the slideshows ──────────────────────────────────────────────────────

let card = (sh) => {
  let slides = slidesOf(sh.entity.eid)
  return `<li><a class="card" href="#/s/${esc(sh.entity.eid)}">
    <span class="frame look-${show.lookOf(sh)}">${
    slides[0] ? slideHtml(slides[0]) : blank
  }</span>
    <span class="card__name">${esc(sh.doc?.title || 'Slideshow')}</span>
    <span class="card__meta">${esc(show.summary(sh, slides.length))}</span>
  </a></li>`
}

let listHtml = () => {
  let add = who.writes
    ? `<button type="button" class="btn" data-act="new-show">New slideshow</button>`
    : ''
  return `<div class="bar"><h2 class="h">Slideshows</h2>${add}</div>
    ${
    rows.shows.length
      ? `<ul class="cards">${rows.shows.map(card).join('')}</ul>`
      : `<p class="empty">No slideshows yet.${
        who.writes ? ' Start one and add your photos to it.' : ''
      }</p>`
  }`
}

// ── one slideshow ───────────────────────────────────────────────────────

let thumb = (sh, s, i, n) => {
  let eid = esc(s.entity.eid)
  let tools = who.writes
    ? `<span class="thumb__tools">
        <button type="button" class="icon" data-act="up" data-id="${eid}" ${
      i == 0 ? 'disabled' : ''
    } aria-label="Move slide ${i + 1} earlier">↑</button>
        <button type="button" class="icon" data-act="down" data-id="${eid}" ${
      i == n - 1 ? 'disabled' : ''
    } aria-label="Move slide ${i + 1} later">↓</button>
        <button type="button" class="link" data-act="edit-slide" data-id="${eid}">Edit</button>
      </span>`
    : ''
  return `<li class="thumb">
    <a class="frame look-${show.lookOf(sh)}" href="#/play/${
    esc(sh.entity.eid)
  }/${i}" aria-label="Play from slide ${i + 1}">${slideHtml(s, i)}</a>
    <div class="thumb__foot"><span class="thumb__n">${
    i + 1
  }</span>${tools}</div>
  </li>`
}

let showHtml = (sh) => {
  let eid = esc(sh.entity.eid)
  let slides = slidesOf(sh.entity.eid)
  let tools = who.writes
    ? `<button type="button" class="btn btn--quiet" data-act="add-slide" data-id="${eid}">Add a slide</button>
       <button type="button" class="link" data-act="edit-show" data-id="${eid}">Edit slideshow</button>`
    : ''
  let tip = who.writes && slides.length
    ? `<p class="tip">Open this page on the screen where it will show, and press Play. Slides you add or change from your phone appear there a moment later.</p>`
    : ''
  return `<a class="back" href="#/">← All slideshows</a>
    <div class="head">
      <h2 class="head__title">${esc(sh.doc?.title || 'Slideshow')}</h2>
      <p class="head__meta">${esc(show.summary(sh, slides.length))}</p>
    </div>
    <div class="row">
      ${
    slides.length
      ? `<a class="btn btn--play" href="#/play/${eid}">▶ Play</a>`
      : ''
  }${tools}
    </div>
    ${tip}
    ${
    slides.length
      ? `<ol class="thumbs">${
        slides.map((s, i) => thumb(sh, s, i, slides.length)).join('')
      }</ol>`
      : `<p class="empty">No slides yet.${
        who.writes ? ' Add a photo, a few words, or both.' : ''
      }</p>`
  }`
}

// ── playing ─────────────────────────────────────────────────────────────
// Every slide sits in the deck at once, so the next photo is already there,
// and the one on screen fades over the last. A slide stays up for the show's
// seconds, or until a tap, a swipe or an arrow key moves it on.

let playing = null // {eid, i, paused, timer, idle, lock}

// Drawn, not typed: a symbol font on a screen at a stall may lack the glyphs.
let ICONS = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  on: '<path d="M9 5l7 7-7 7"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M7 5l12 7-12 7z" fill="currentColor"/>',
  full: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
}
let icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`

let tools = (paused) =>
  `<button type="button" data-go="-1" aria-label="Previous slide">${
    icon('back')
  }</button>
   <button type="button" data-go="pause" aria-label="${
    paused ? 'Play' : 'Pause'
  }">${icon(paused ? 'play' : 'pause')}</button>
   <button type="button" data-go="1" aria-label="Next slide">${
    icon('on')
  }</button>
   <span class="play__gap"></span>
   <button type="button" data-go="full" aria-label="Full screen">${
    icon('full')
  }</button>
   <button type="button" data-go="close" aria-label="Close">${
    icon('close')
  }</button>`

let drawDeck = () => {
  let sh = showOf(playing.eid)
  let slides = slidesOf(playing.eid)
  if (!sh || !slides.length) return stop()
  playing.i = show.keep(slides, playing.at, playing.i)
  deck.className = `play look-${show.lookOf(sh)}`
  deck.innerHTML = `<div class="play__deck">${
    slides.map((s, i) =>
      `<div class="frame frame--full">${slideHtml(s, i)}</div>`
    )
      .join('')
  }</div>
    <div class="play__bar"><i></i></div>
    <p class="play__count" aria-live="polite"></p>
    <nav class="play__tools" aria-label="Slideshow controls">${
    tools(playing.paused)
  }</nav>`
  turn(0)
}

let turn = (by) => {
  let sh = showOf(playing.eid)
  let slides = slidesOf(playing.eid)
  if (!slides.length) return
  playing.i = show.step(playing.i, slides.length, by)
  playing.at = slides[playing.i].entity.eid
  deck.querySelectorAll('.frame--full').forEach((f, i) =>
    f.classList.toggle('is-on', i == playing.i)
  )
  deck.querySelector('.play__count').textContent = `${
    playing.i + 1
  } of ${slides.length}`
  let pace = show.paceOf(sh)
  let bar = deck.querySelector('.play__bar')
  bar.innerHTML = pace ? `<i style="animation-duration:${pace}s"></i>` : ''
  bar.classList.toggle('is-paused', playing.paused)
  clearTimeout(playing.timer)
  if (pace && !playing.paused && slides.length > 1) {
    playing.timer = setTimeout(() => turn(1), pace * 1000)
  }
}

let wake = () => {
  if (!playing) return
  deck.classList.add('is-awake')
  clearTimeout(playing.idle)
  playing.idle = setTimeout(() => deck.classList.remove('is-awake'), 2600)
}

// A screen left playing at a stall should not go dark between customers.
let hold = async () => {
  try {
    playing.lock = await navigator.wakeLock?.request('screen')
  } catch { /* the browser said no; the show still plays */ }
}

let start = (eid, n) => {
  let slides = slidesOf(eid)
  if (!playing || playing.eid != eid) {
    playing = { eid, i: 0, paused: false, at: slides[n]?.entity.eid }
    hold()
  }
  playing.i = Math.min(n, Math.max(0, slides.length - 1))
  playing.at = slides[playing.i]?.entity.eid
  document.body.classList.add('is-playing')
  deck.hidden = false
  drawDeck()
  deck.focus()
  wake()
}

let stop = () => {
  if (!playing) return
  clearTimeout(playing.timer)
  clearTimeout(playing.idle)
  playing.lock?.release?.().catch(() => {})
  let eid = playing.eid
  playing = null
  deck.hidden = true
  deck.innerHTML = ''
  document.body.classList.remove('is-playing')
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  if (route().where == 'play') location.hash = `#/s/${encodeURIComponent(eid)}`
}

let go = (what) => {
  if (!playing) return
  if (what == 'close') return stop()
  if (what == 'full') {
    return document.fullscreenElement
      ? document.exitFullscreen()
      : deck.requestFullscreen?.().catch(() => {})
  }
  if (what == 'pause') {
    playing.paused = !playing.paused
    deck.querySelector('.play__tools').innerHTML = tools(playing.paused)
    return turn(0)
  }
  turn(Number(what))
}

deck.tabIndex = -1
deck.addEventListener('pointermove', wake)
let down = null
let swiped = false
deck.addEventListener('click', (ev) => {
  if (swiped) return (swiped = false)
  let b = ev.target.closest('[data-go]')
  if (b) return go(b.dataset.go)
  // A tap on the left third goes back, anywhere else goes on.
  go(ev.clientX < innerWidth / 3 ? '-1' : '1')
  wake()
})
deck.addEventListener('pointerdown', (ev) => (down = ev.clientX))
deck.addEventListener('pointerup', (ev) => {
  let dx = down == null ? 0 : ev.clientX - down
  down = null
  if (Math.abs(dx) > 50) {
    swiped = true
    go(dx < 0 ? '1' : '-1')
  }
})
addEventListener('keydown', (ev) => {
  if (!playing || ev.target.closest?.('dialog')) return
  let what = {
    ArrowRight: '1',
    ArrowDown: '1',
    PageDown: '1',
    ' ': '1',
    ArrowLeft: '-1',
    ArrowUp: '-1',
    PageUp: '-1',
    f: 'full',
    k: 'pause',
    p: 'pause',
    Escape: document.fullscreenElement ? null : 'close',
  }[ev.key]
  if (!what) return
  ev.preventDefault()
  go(what)
  wake()
})
document.addEventListener('visibilitychange', () => {
  if (playing && document.visibilityState == 'visible') hold()
})

// ── drawing ─────────────────────────────────────────────────────────────

let draw = () => {
  let r = route()
  if (!loaded) return
  if (r.where == 'play' && showOf(r.eid)) return start(r.eid, r.n)
  if (playing) stop()
  let sh = r.where == 's' ? showOf(r.eid) : null
  stage.innerHTML = sh
    ? showHtml(sh)
    : r.where == 's' || r.where == 'play'
    ? `<p class="empty">That slideshow isn't here any more. <a href="#/">See all slideshows</a>.</p>`
    : listHtml()
}

// ── forms ───────────────────────────────────────────────────────────────

let showFields = (sh) => [
  { name: 'title', label: 'Name', value: sh?.doc?.title ?? '', required: true },
  {
    name: 'seconds',
    label: 'Each slide stays up for',
    type: 'select',
    value: show.paceOf(sh),
    options: show.PACES,
  },
  {
    name: 'look',
    label: 'Look',
    type: 'select',
    value: show.lookOf(sh),
    options: show.LOOKS,
  },
]

let showOfForm = (v) => {
  need(v.title.trim(), 'Give the slideshow a name.')
  return { seconds: Number(v.seconds), look: v.look }
}

// A photo from a phone is often 4,000 pixels across and several megabytes; a
// screen shows 2,048 at most, so it is made that size before it is sent.
let shrink = async (file) => {
  try {
    let bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    let [w, h] = show.fit(bmp.width, bmp.height)
    if (w == bmp.width && file.size < 1_500_000) return file
    let canvas = new OffscreenCanvas(w, h)
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h)
    let blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.86 })
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', {
      type: 'image/jpeg',
    })
  } catch {
    return file
  }
}

let slideForm = (sh, s) =>
  ask({
    title: s ? 'Edit slide' : 'Add a slide',
    fields: [
      {
        name: 'photo',
        label: 'Photo',
        type: 'file',
        accept: 'image/*',
        hint: s?.slide.photo
          ? 'Leave this empty to keep the photo the slide has.'
          : 'A photo from your phone or computer, or none for words only.',
      },
      { name: 'title', label: 'Heading', value: s?.doc?.title ?? '' },
      {
        name: 'body',
        label: 'Words',
        type: 'textarea',
        value: s?.doc?.body ?? '',
      },
      {
        name: 'layout',
        label: 'Layout',
        type: 'select',
        value: s?.slide.layout ?? 'photo',
        options: show.LAYOUTS,
      },
    ],
    place: s ? `slide:${s.entity.eid}:body` : `slide:new:${sh.entity.eid}:body`,
    save: async (v) => {
      let picked = v.photo instanceof Blob && v.photo.size ? v.photo : null
      need(
        picked || v.title.trim() || v.body.trim() || s?.slide.photo,
        'Add a photo, a heading or some words.',
      )
      let photo = picked ? (await upload(await shrink(picked))).eid : null
      return [{
        entity: { eid: s?.entity.eid ?? '$slide' },
        slide: {
          ...(s ? {} : {
            show: sh.entity.eid,
            ord: show.nextOrd(slidesOf(sh.entity.eid)),
          }),
          ...(photo ? { photo } : {}),
          layout: v.layout,
        },
        doc: { title: v.title.trim(), body: v.body.trim() },
      }]
    },
    remove: s
      ? () => apply({ entity: { eid: s.entity.eid }, tombstone: {} })
      : null,
  })

let acts = {
  'new-show': async () => {
    let eid = crypto.randomUUID()
    let made = await ask({
      title: 'New slideshow',
      fields: showFields(),
      save: (v) => [{
        entity: { eid },
        show: showOfForm(v),
        doc: { title: v.title.trim() },
      }],
    })
    if (made) location.hash = `#/s/${eid}`
  },
  'edit-show': (sh) =>
    ask({
      title: 'Slideshow',
      fields: showFields(sh),
      save: (v) => [{
        entity: { eid: sh.entity.eid },
        show: showOfForm(v),
        doc: { title: v.title.trim() },
      }],
      remove: () => apply({ entity: { eid: sh.entity.eid }, tombstone: {} }),
    }),
  'add-slide': (sh) => slideForm(sh),
  'edit-slide': (s) => slideForm(showOf(s.slide.show), s),
  up: (s) => shift(s, -1),
  down: (s) => shift(s, 1),
}

let shift = async (s, by) => {
  let patches = show.move(slidesOf(s.slide.show), s.entity.eid, by)
  if (patches.length) await apply(patches)
}

let find = (eid) =>
  [...rows.shows, ...rows.slides].find((r) => r.entity.eid == eid)

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
  if (!playing) scrollTo(0, 0)
})
subscribe(show.EVERYTHING, (all) => {
  rows = show.split(all)
  loaded = true
  if (playing && route().where == 'play') drawDeck()
  else draw()
}).ready.catch((e) => {
  stage.innerHTML = `<p class="empty">${esc(e.message || String(e))}</p>`
})
let drawFoot = () =>
  footer(foot, { published: PUBLISHED, readOnly: !who.writes })
me().then((w) => {
  who = w
  if (!playing) draw()
  drawFoot()
}).catch(drawFoot)
