// yak.sh: the page's two faces over one manual. On the CRT, the manual's
// sections are disks, the shell runs the page's own yak, and the graph pane
// watches it; in reading mode the same sections are a page, and their
// examples run on panels under them. Both share one graph (load.js) and one
// manual (the `.Man` sections in #doc, the source of every page the screen
// shows).

import { arrivals, fetched, yak } from './load.js'
import { enhance, lines, module, read, source } from './examples.js'
import { terminal } from './term.js'
import { sh } from './sh.js'
import { foot, head, PHOSPHORS, tube } from './screen.js'
import { floppy } from './drive.js'
import { graphPane } from './graph.js'
import { draw } from './map.js'
import { readme } from './readme.js'
import { sound, sounding } from './sound.js'

let $ = (id) => document.getElementById(id)
let root = document.documentElement
let doc = $('doc')
let crt = () => root.dataset.mode == 'crt'

let remember = (key, value) => {
  try {
    if (value === undefined) return localStorage.getItem(`yak.sh:${key}`)
    localStorage.setItem(`yak.sh:${key}`, value)
  } catch {
    return null
  }
}

let kb = (bytes) => `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`

// The disks, read off the shelf and the manual: the number on each label, its
// title and note, and its page's man title.
let disks = Object.fromEntries(
  [...document.querySelectorAll('.Shelf .Disk')].map((d) => {
    let id = d.dataset.disk
    let page = doc.querySelector(`:scope > #${id}`)
    return [id, {
      n: Number(d.querySelector('.Disk_Head i').textContent.split('/')[0]),
      title: d.querySelector('.Disk_Title').textContent.trim(),
      note: d.querySelector('.Disk_Note').textContent.replace(/\s+/g, ' ')
        .trim(),
      man: page.dataset.man,
      page,
    }]
  }),
)

// Each section of the manual wears its disk's color and its man title.
for (let [id, d] of Object.entries(disks)) {
  d.page.style.setProperty('--disk', `var(--disk-${id})`)
  d.page.prepend(head(d.man))
}
enhance(doc)

// Which package group each package is in, from the manual's own list.
let groups = new Map(
  [...doc.querySelectorAll('.Group')].flatMap((g) =>
    [...g.querySelectorAll('[data-pkg]')].map((a) => [
      a.dataset.pkg,
      g.querySelector('h3').textContent,
    ])
  ),
)

let packages
let pkgs = () => packages ??= fetch('packages.json').then((r) => r.json())

let map = async (figure, open) => draw(figure, await pkgs(), { groups, open })

// How many modules the page has loaded, wherever the manual says so.
let loaded = () => {
  let f = fetched()
  let text = `${f.packages} @yaks packages, as ${f.modules} modules from esm.sh`
  for (let pre of document.querySelectorAll('.Loaded')) pre.textContent = text
}

// ---- reading mode -------------------------------------------------------

let sheet = async (name) => {
  let box = document.createElement('dialog')
  box.className = 'Sheet'
  let close = document.createElement('button')
  close.className = 'Sheet_Close'
  close.textContent = 'close'
  close.onclick = () => box.close()
  let wait = document.createElement('p')
  wait.className = 'Readme Readme_Meta'
  wait.textContent = `fetching packages/${name}/README.md…`
  box.append(close, wait)
  box.addEventListener('close', () => box.remove())
  document.body.append(box)
  box.showModal()
  try {
    wait.replaceWith(await readme(name))
  } catch (error) {
    wait.textContent = error.message
  }
}

let reading = false
let readMode = () => {
  if (reading) return
  reading = true
  let figure = doc.querySelector('.Map')
  new IntersectionObserver((seen, watcher) => {
    if (!seen.some((s) => s.isIntersecting)) return
    watcher.disconnect()
    map(figure, sheet)
  }, { rootMargin: '200px' }).observe(figure)
}

// ---- the CRT ------------------------------------------------------------

let els = {
  crt: $('crt'),
  screen: $('screen'),
  panes: $('panes'),
  man: $('man'),
  title: $('man-title'),
  hint: $('man-hint'),
  ghost: $('ghost'),
  bar: $('bar'),
}
let screen = tube(els)
let drive = floppy({
  drive: $('drive'),
  slot: document.querySelector('.Drive_Slot'),
  eject: $('eject'),
  fly: $('fly'),
  shelf: document.querySelector('.Shelf'),
})

let term
let showing = null

// A page of the manual on the screen: a copy of its section, headed and
// footed as man(1) does, with the map drawn into it where it has one.
let page = (id) => {
  let d = disks[id]
  let copy = d.page.cloneNode(true)
  for (let node of copy.querySelectorAll('[id]')) node.removeAttribute('id')
  copy.removeAttribute('id')
  screen.show([copy, foot(d.man)], {
    name: `man ${d.man.toLowerCase()}`,
    note: 'eject: ⏏',
    zoom: id == 'packages',
  })
  let figure = copy.querySelector('.Map')
  if (figure) map(figure, queued(opening))
  loaded()
  showing = id
}

let motd = () => {
  let copy = $('motd').cloneNode(true)
  copy.removeAttribute('id')
  screen.show([copy], { name: 'motd', note: '' })
  showing = null
}

// A README in the manual pane, fetched as it is asked for.
let opening = async (name) => {
  await term.print(
    `man @yaks/${name}: packages/${name}/README.md, from github`,
    'sys',
  )
  let title = `@YAKS/${name.toUpperCase()}(3)`
  let wait = document.createElement('p')
  wait.textContent = 'fetching…'
  screen.show([head(title), wait], {
    name: `readme @yaks/${name}`,
    note: 'esc: back',
  })
  try {
    let box = await readme(name)
    screen.show([head(title), box, foot(title)], {
      name: `readme @yaks/${name}`,
      note: 'esc: back',
    })
    showing = { readme: name }
  } catch (error) {
    await term.print(error.message, 'note')
  }
}

let back = () => {
  if (!showing?.readme) return
  let id = drive.inside()
  id ? page(id) : motd()
}

let current = (id) => {
  for (let a of document.querySelectorAll('.Top_Disks a')) {
    a.toggleAttribute('aria-current', a.dataset.disk == id)
  }
}

let sectors = (id) => new Blob([disks[id].page.textContent]).size

// Slide a disk in and show its page, printing what the drive does. It
// prints, so it runs in the terminal's turn: the shell's own words call it
// from a line already running, and everything else through `queued`.
let load = async (id, { fast = false, push = true } = {}) => {
  let d = disks[id]
  if (!d) return
  if (drive.inside() == id) {
    if (showing != id) page(id)
    return
  }
  let was = drive.inside()
  if (was) await term.print(`fd0: eject "${disks[was].title}"`, 'sys')
  current(id)
  if (push) history.pushState(null, '', `#${id}`)
  await drive.insert(id, { fast })
  await term.print(`fd0: disk ${d.n}/6 in the drive, "${d.title}"`, 'sys')
  let size = sectors(id)
  let line = term.status('fd0: reading')
  let reading = drive.read(fast ? 300 : 950)
  let steps = 24
  for (let i = 1; i <= steps; i++) {
    line.set(
      `fd0: reading ${'▮'.repeat(i)}${'▯'.repeat(steps - i)} ` +
        `${Math.round((size * i) / steps / 512)} sectors`,
    )
    await new Promise((r) => setTimeout(r, (fast ? 300 : 950) / steps))
  }
  await reading
  line.set(`fd0: read ${kb(size)}, ${Math.ceil(size / 512)} sectors`)
  await term.print(`man ${d.man.toLowerCase()}`, 'sys')
  page(id)
  screen.status({ disk: d.title })
}

let unload = async ({ push = true } = {}) => {
  let id = drive.inside()
  if (!id) return term.print('fd0: the drive is empty', 'note')
  current(null)
  if (push) history.pushState(null, '', location.pathname + location.search)
  await term.print(`fd0: eject "${disks[id].title}"`, 'sys')
  motd()
  screen.status({ disk: '' })
  await drive.eject()
}

/** `f`, run in the terminal's turn, after whatever it is printing: for what
 * a click or the address asks, which may arrive mid-line. */
let queued = (f) => (...args) => term.run(() => f(...args))

let route = queued((opts) => {
  let id = location.hash.slice(1)
  if (disks[id]) return load(id, { ...opts, push: false })
  if (!id && drive.inside()) return unload({ push: false })
})

let setSound = (on) => {
  sound(on)
  remember('sound', on ? 'on' : 'off')
  $('sound').setAttribute('aria-pressed', String(on))
  $('sound').querySelector('b').textContent = on ? 'on' : 'off'
}

let setPower = (on) => {
  $('power').setAttribute('aria-pressed', String(on))
  return screen.power(on)
}

let setPhosphor = (name) => {
  let next = screen.phosphor(name)
  remember('phosphor', next)
  return next
}

let running = (ex, done) => {
  ex.dataset.running = ''
  done.finally(() => delete ex.dataset.running)
}

let run = (ex) => {
  if (ex.dataset.run == 'js') {
    return running(
      ex,
      term.run(async () => {
        await term.print(
          '» the example above, run as a module in this page',
          'sys',
        )
        await module(source(ex), (line) => term.print(line))
      }),
    )
  }
  let done
  for (let line of lines(ex)) done = term.type(line)
  running(ex, done)
}

let booted = false
let boot = async () => {
  if (booted) return
  booted = true
  let saved = remember('phosphor')
  if (PHOSPHORS.includes(saved) && saved != 'green') setPhosphor(saved)
  motd()
  let said = {}
  term = terminal(
    {
      shell: $('shell'),
      log: $('log'),
      typed: $('typed'),
      cursor: $('cursor'),
      after: $('after'),
      input: $('input'),
    },
    said,
  )
  Object.assign(
    said,
    sh(term, {
      yak,
      disks,
      insert: (id) => load(id),
      eject: () => unload(),
      man: (name) => opening(name),
      phosphor: (name) => term.print(`phosphor: ${setPhosphor(name)}`, 'sys'),
      degauss: () => screen.degauss(),
      sound: (
        on,
      ) => (setSound(on), term.print(`sound: ${on ? 'on' : 'off'}`, 'sys')),
      status: (code) => screen.status({ code }),
    }),
  )
  await Promise.race([
    document.fonts.ready,
    new Promise((r) => setTimeout(r, 900)),
  ])
  setPower(true)
  let t0 = performance.now()
  term.print('yak.sh: the yaks toolkit, in a terminal in this page', 'sys')
  term.print('loading yak from jsr.io, through esm.sh', 'sys')
  let stop = arrivals(
    ({ name, ms }) =>
      term.print(
        `  ${name.padEnd(30, '.')} ${String(ms).padStart(5)} ms`,
        'dim',
      ),
    t0,
  )
  try {
    let y = await yak()
    stop()
    let f = fetched()
    let now = new Map(y.everything().map((b) => [b.entity.eid, b]))
    let name = (eid) => now.has(eid) ? y.id(now.get(eid)) : y.short(eid)
    let seed = y.seeded.map((b) => {
      let e = now.get(b.entity.eid) ?? b
      let rel = Object.keys(e).find((k) =>
        !['entity', 'edge', 'created', 'updated'].includes(k)
      )
      return e.edge
        ? `${y.id(e)} ${name(e.edge.from)} ${rel} ${name(e.edge.to)}`
        : `${y.id(e)} ${e.doc?.title}`
    })
    await term.print(
      `  ${f.packages} packages, ${f.modules} modules, in ` +
        `${Math.round(performance.now() - t0)} ms`,
      'sys',
    )
    await term.print(
      `graph  @yaks/graph over @yaks/ram: ${y.vocab.all.length} components, ` +
        `${y.spoken.length} tools`,
      'sys',
    )
    await term.print(`seed   ${seed.join(' · ')}`, 'sys')
    graphPane($('graph'), $('graph-count'), y)
    loaded()
    await term.print('fd0    empty: slide a disk in, or type help', 'sys')
  } catch (error) {
    stop()
    await term.print(`yak did not load: ${error.message}`, 'note')
    await term.print('the manual still reads; reload to try again', 'note')
  }
  route({ fast: true })
  term.focus()
}

// ---- both ---------------------------------------------------------------

let face = (mode) => {
  root.dataset.mode = mode
  remember('mode', mode)
  if (mode == 'crt') boot()
  else {
    readMode()
    let id = drive.inside()
    if (id) disks[id].page.scrollIntoView()
  }
}

$('mode').addEventListener('click', () => face(crt() ? 'read' : 'crt'))
$('sound').addEventListener('click', () => setSound(!sounding()))
$('power').addEventListener('click', () => {
  let on = !screen.lit()
  setPower(on).then(() => on && term?.focus())
})
$('phosphor').addEventListener('click', () => setPhosphor())
$('degauss').addEventListener('click', () => screen.degauss())
$('eject').addEventListener('click', () => queued(unload)())

document.addEventListener('click', (e) => {
  let t = e.target
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) {
    return
  }
  let go = t.closest('.Ex_Go')
  if (go) {
    let ex = go.closest('.Ex')
    return crt() ? run(ex) : read(ex, yak)
  }
  if (!crt()) return
  let disk = t.closest('[data-disk]')
  if (disk?.matches('a')) {
    e.preventDefault()
    return queued(load)(disk.dataset.disk)
  }
  let pkg = t.closest('#man a[data-pkg]')
  if (pkg) {
    e.preventDefault()
    return queued(opening)(pkg.dataset.pkg)
  }
  let anchor = t.closest('#man a[href^="#r-"]')
  if (anchor) {
    e.preventDefault()
    return $('man').querySelector(anchor.getAttribute('href'))?.scrollIntoView({
      block: 'start',
    })
  }
  if (
    t.closest('#screen') && !t.closest('a, button, .Map') &&
    getSelection().isCollapsed
  ) {
    term?.focus()
  }
})

// On the CRT, Esc leaves a README, and a key typed anywhere is typed at the
// shell.
document.addEventListener('keydown', (e) => {
  if (!crt() || !term || e.metaKey || e.ctrlKey || e.altKey) return
  if (e.key == 'Escape') return back()
  let at = document.activeElement
  if (at?.matches('input, textarea, button, a, [contenteditable]')) return
  if (e.key.length == 1 || e.key == 'Enter') term.focus()
})

addEventListener('popstate', () => crt() ? term && route({}) : null)

setSound(remember('sound') == 'on')
if (crt()) boot()
else readMode()
