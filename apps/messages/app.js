// The page: reads the store, draws the screen the address names, and turns
// what the person does into writes.
import { apply, drafts, me, subscribe } from './api/client.js'
import { count, frame, screen } from './views.js'
import {
  broadcastBundles,
  conversations,
  doneBundles,
  FILTERS,
  gather,
  helpBundles,
  joinBundles,
  replyBundles,
  resendBundles,
} from './model.js'
import { theme } from './theme.js'

let answers = Object.fromEntries(Object.keys(FILTERS).map((k) => [k, []]))
let m = gather([])
let who = { writes: false }
let ui = { words: null, group: null, confirm: null, body: '' }
let desk = drafts({ report: (e) => toast(e.message || String(e)) })
let bound = []
let base = new URL(document.baseURI)
let main = document.getElementById('main')

let toast = (text) => {
  let t = document.getElementById('toast')
  t.textContent = text
  t.hidden = false
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => (t.hidden = true), 4000)
}
let act = (fn) => async (...args) => {
  try {
    await fn(...args)
  } catch (error) {
    toast(error.message || String(error))
    if (!error.status) globalThis.reportError?.(error)
  }
}

let path = () =>
  decodeURI(location.pathname.slice(base.pathname.length)).replace(/\/$/, '')
let go = (to) => {
  history.pushState(null, '', new URL(to, base))
  ui = { ...ui, words: null, confirm: null }
  draw(true)
}

// The draft a field keeps, so nothing typed is lost to a reload or a phone
// put down halfway through.
let places = {
  'broadcast-text': () => 'broadcast',
  'reply-text': () => `reply:${path().split('/')[1]}`,
}

let draw = (moved = false) => {
  let focus = document.activeElement?.id,
    sel = [
      document.activeElement?.selectionStart,
      document.activeElement?.selectionEnd,
    ]
  for (let off of bound) off()
  bound = []
  let waiting = conversations(m).reduce((n, c) => n + (c.waiting ? 1 : 0), 0)
  let { tab, body } = screen(m, path(), who, { ...ui, now: new Date() })
  let { top, bottom } = frame(m, tab, waiting)
  document.getElementById('top').innerHTML = top
  document.getElementById('bottom').innerHTML = bottom
  main.innerHTML = body
  document.title = `${tab[0].toUpperCase()}${tab.slice(1)} · ${
    m.church?.name || 'Messages'
  }`
  for (let [id, place] of Object.entries(places)) {
    let field = document.getElementById(id)
    if (field && who.person) bound.push(desk.bind(field, place()))
  }
  let field = focus && document.getElementById(focus)
  if (field && !moved) {
    field.focus()
    if (sel[0] != null) field.setSelectionRange?.(...sel)
  }
  if (moved) scrollTo(0, 0)
  document.body.classList.remove('loading')
}

let rows = () => Object.values(answers).flat()
let helping = false
let refresh = () => {
  m = gather(rows())
  theme(m.church)
  draw()
  // The office number the platform gives in its answer to HELP follows the
  // directory's.
  let help = who.writes && !helping ? helpBundles(m) : []
  if (help.length) {
    helping = true
    act(() => apply(help))().finally(() => (helping = false))
  }
}

let send = act(async () => {
  let eid = crypto.randomUUID()
  let ok = await desk.spend(
    'broadcast',
    broadcastBundles(m, ui.confirm, ui.body, eid),
  )
  if (!ok) {
    return toast('Not sent yet: the message is kept. Try again in a moment.')
  }
  ui = { ...ui, confirm: null, body: '' }
  toast('Sending now.')
  go(`sent/${eid}`)
})

let reply = act(async (number, body) => {
  let c = conversations(m).find((c) => c.number == number)
  if (!c || !body.trim()) return
  let ok = await desk.spend(`reply:${number}`, replyBundles(m, c, body))
  toast(
    ok
      ? 'Reply sent.'
      : 'Not sent yet: your reply is kept. Try again in a moment.',
  )
})

let acts = {
  done: act(async (number) => {
    let c = conversations(m).find((c) => c.number == number)
    if (c) await apply(doneBundles(c))
  }),
  again: act(async (eid) => {
    await apply(resendBundles(m, eid))
    toast('Sending again.')
  }),
  pick: (_, el) => {
    ui.group = el.value
  },
  send,
  cancel: () => {
    ui.confirm = null
    draw()
  },
  join: act(async (eid) => {
    let group = path().split('/')[1]
    await apply(joinBundles(m, group, [eid]))
  }),
  leave: act(async (eid) => {
    let g = m.groups.get(path().split('/')[1])
    let ms = g?.members.find((x) => x.person.eid == eid)
    if (ms) await apply({ entity: { eid: ms.eid }, tombstone: {} })
  }),
  drop: act(async (eid) => {
    let g = m.groups.get(eid)
    if (
      !g ||
      !confirm(
        `Delete the ${g.name} list? Nobody is taken out of the directory, and messages already sent stay.`,
      )
    ) return
    await apply({ entity: { eid }, tombstone: {} })
    go('lists')
  }),
}

let forms = {
  broadcast: (form) => {
    let body = form.body.value
    if (!body.trim()) return
    ui = { ...ui, body, confirm: form.group.value || null }
    draw()
  },
  reply: (form) => reply(form.dataset.id, form.body.value),
  group: act(async (form) => {
    let name = form.elements.list.value.trim()
    if (!name) return
    let saved = await apply({
      entity: { eid: '$list' },
      group: {},
      doc: { title: name },
    })
    go(`lists/${saved.aliases.$list}`)
  }),
}

document.addEventListener('click', (e) => {
  let a = e.target.closest('a[href]')
  if (
    a && !e.metaKey && !e.ctrlKey && a.origin == location.origin &&
    a.pathname.startsWith(base.pathname)
  ) {
    e.preventDefault()
    return go(a.getAttribute('href'))
  }
  let b = e.target.closest('[data-act]')
  if (b && b.tagName != 'INPUT') acts[b.dataset.act]?.(b.dataset.id, b)
})
document.addEventListener('change', (e) => {
  let b = e.target.closest('input[data-act=pick]')
  if (b) acts.pick(null, b)
})
document.addEventListener('input', (e) => {
  if (e.target.id == 'broadcast-text') {
    document.getElementById('broadcast-count').textContent = count(
      m,
      e.target.value,
    )
  }
  if (e.target.dataset.act == 'find') {
    ui.words = e.target.value
    draw()
  }
})
document.addEventListener('submit', (e) => {
  let form = e.target.closest('[data-form]')
  if (!form) return
  e.preventDefault()
  forms[form.dataset.form]?.(form)
})
addEventListener('popstate', () => draw(true))

for (let [k, filter] of Object.entries(FILTERS)) {
  subscribe(filter, (got) => {
    answers[k] = got
    refresh()
  })
}
me().then((got) => {
  who = got
  refresh()
})
