// The builder's chat, live (T-34242): the script half of the form on a space's
// own page (pages.ts `chat`). It opens the socket at `/api/build`, draws the
// conversation the object replays, and then draws each frame of a build as it
// happens — the words, each tool as it starts and as it answers, the address
// at the end.
//
// NOTHING HERE IS REQUIRED. The form under it POSTs to the same address and is
// answered a page with the same conversation in it (build.ts `posting`), so a
// browser with no script, a socket that never opened and a socket that dropped
// all leave a working door: the submit handler below only takes the line when
// the socket is OPEN, and hands it back to the browser otherwise.
//
// The frames are build.ts's wire, and the rules are pages.ts's, kept twice on
// purpose: one row per tool, which its own result replaces; the address as a
// card; `busy` as a line; and `done` drawing nothing, because the sentence it
// carries has already arrived as a line of its own.
//
// Every write to the page is textContent, a class, or an href this file built
// from an address it matched by shape — the page never speaks HTML on the
// builder's behalf.

let chat = document.querySelector('.Chat')
let said = chat && chat.querySelector('.Chat_Said')
let ask = chat && chat.querySelector('.Chat_Ask')
let box = ask && ask.querySelector('textarea')
let go = ask && ask.querySelector('button')

let el = (tag, cls, text) => {
  let node = document.createElement(tag)
  if (cls) node.className = cls
  if (text != null) node.textContent = text
  return node
}

// A https address inside a sentence, as a link — the same shape pages.ts
// admits, and the same trailing punctuation left out of it.
let AT = /https:\/\/[^\s<>"'`]+/g
let says = (node, text) => {
  let from = 0
  for (let m of text.matchAll(AT)) {
    let url = m[0].replace(/[.,;:!?)\]]+$/, '')
    node.append(text.slice(from, m.index))
    let a = el('a', null, url)
    a.href = url
    node.append(a)
    from = m.index + url.length
  }
  node.append(text.slice(from))
}

let toolRow = (name, line, ok) => {
  let row = el('p', ok == false ? 'Chat_Tool Chat_Tool-no' : 'Chat_Tool')
  row.append(
    el('span', 'Chat_Name', `${ok == null ? '…' : ok ? '✓' : '✗'} ${name}`),
    el('span', 'Chat_Of', line),
  )
  return row
}

let built = (url) => {
  let card = el('div', 'Chat_Built')
  let at = el('p', 'Url')
  let a = el('a', null, null)
  a.href = url
  a.append(el('code', null, url))
  at.append(a)
  card.append(el('p', null, 'It is live.'), at)
  return card
}

// The row each running tool is drawn as, so its answer can replace it.
let rows = new Map()

let add = (node) => {
  said.append(node)
  node.scrollIntoView({ block: 'nearest' })
}

// Whether the builder is busy, said to whoever is typing.
let waiting = (yes) => {
  box.disabled = yes
  go.disabled = yes
  go.textContent = yes ? 'Building…' : 'Build it'
}

let draw = (f) => {
  if ('said' in f) {
    if (!f.text) return
    let p = el(
      'p',
      `Chat_Bubble Chat_Bubble-${f.said == 'person' ? 'you' : 'them'}`,
    )
    says(p, f.text)
    add(p)
  } else if ('tool' in f) {
    let row = toolRow(f.tool, f.line, null)
    rows.set(f.call, row)
    add(row)
  } else if ('ran' in f) {
    let row = toolRow(f.ran, f.line, f.ok)
    let was = rows.get(f.call)
    if (was) was.replaceWith(row)
    else add(row)
    rows.set(f.call, row)
  } else if ('built' in f) {
    add(built(f.built))
  } else if ('busy' in f) {
    add(el('p', 'Chat_Note', f.busy))
    waiting(false)
  } else if ('ready' in f) {
    waiting(!!f.building)
  } else if ('done' in f) {
    waiting(false)
  }
}

let live = null

let open = () => {
  let at = new URL('/api/build', location.href)
  at.protocol = at.protocol == 'http:' ? 'ws:' : 'wss:'
  let ws = new WebSocket(at.href)
  ws.addEventListener('open', () => {
    live = ws
    // What comes next is the whole conversation, replayed: the page's own
    // copy of it — server-drawn, or drawn by a socket that has since gone —
    // is what the replay is about to say again.
    said.replaceChildren()
    rows.clear()
  })
  ws.addEventListener('message', (e) => {
    try {
      draw(JSON.parse(e.data))
    } catch {
      // A frame we cannot read is not the person's problem.
    }
  })
  // A socket that closed leaves the plain form, which works: the next line
  // posts and the page comes back with the conversation in it.
  ws.addEventListener('close', () => {
    if (live == ws) live = null
    waiting(false)
  })
  ws.addEventListener('error', () => {
    if (live == ws) live = null
  })
}

if (chat && said && ask && box && go) {
  ask.addEventListener('submit', (e) => {
    if (!live || live.readyState != WebSocket.OPEN) return
    let text = box.value.trim()
    if (!text) return
    e.preventDefault()
    live.send(JSON.stringify({ say: text }))
    box.value = ''
    waiting(true)
  })
  open()
}
