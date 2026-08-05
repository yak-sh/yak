// One input, the page you are on, and what already points at it.
//
// The input is the SAME box a board has: a plain line is a task (P1 and
// dot-params parse inside it), and a line opening with ':' is a verb —
// :fix files and starts an agent, :done closes what you are standing on.
// The server owns that grammar; this file only carries the line.
//
// Everything painted here — a page title, a task's title — is content
// somebody else wrote, so it reaches the DOM as TEXT and never as HTML.
// The popup runs on the extension's own origin, next to the graph's
// doors; a title is not allowed to speak markup any more than it is in
// the app itself.
import { file, host, refs, setHost } from './tasks.js'

let $ = (id) => document.getElementById(id)
let tab = null

let say = (text, bad) => {
  $('said').textContent = text
  $('said').classList.toggle('bad', !!bad)
}

// The capture choice is remembered per SITE (owner: sometimes the URL is
// all you want, and which is which is a property of the place).
let pref = (url) => `capture:${new URL(url).hostname}`

let filable = (url) => /^https?:/.test(url ?? '')

let show = (found) => {
  let box = $('refs')
  box.replaceChildren()
  if (!found.length) return
  let head = document.createElement('h2')
  head.textContent = `referenced by ${found.length}`
  box.append(head)
  for (let b of found) {
    let a = document.createElement('a')
    a.className = 'ref'
    a.href = `${$('host').value}/${b.from}`
    a.target = '_blank'
    let id = document.createElement('span')
    id.className = 'id'
    id.textContent = `${b.from} ${b.via}`
    let what = document.createElement('span')
    what.className = 'what'
    what.textContent = b.title || '—'
    a.append(id, what)
    box.append(a)
  }
}

let load = async () => {
  if (!filable(tab?.url)) return
  try {
    show(await refs(tab.url))
  } catch (e) {
    say(`${e.message ?? e} — is the server up?`, true)
  }
}

// The page as the tab has it: after login, after JavaScript. No refetch
// could see this, which is the whole point of capturing from here.
let grab = async () => {
  let [hit] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => document.documentElement.outerHTML,
  })
  return hit?.result
}

let submit = async () => {
  if (!filable(tab?.url)) return
  let line = $('line').value.trim()
  try {
    say('filing…')
    let html = $('capture').checked ? await grab() : undefined
    let out = await file({ url: tab.url, title: tab.title, line, html })
    $('line').value = ''
    say([out.filed.join(' '), out.msg].filter(Boolean).join(' — ') || out.page)
    chrome.runtime.sendMessage({ filed: tab.id })
    load()
  } catch (e) {
    say(String(e.message ?? e), true)
  }
}

$('line').addEventListener('keydown', (ev) => {
  if (ev.key == 'Enter' && !ev.shiftKey) {
    ev.preventDefault()
    submit()
  } else if (ev.key == 'Escape') close()
})
$('file').addEventListener('click', submit)
$('capture').addEventListener(
  'change',
  (ev) => chrome.storage.local.set({ [pref(tab.url)]: ev.target.checked }),
)
$('save').addEventListener('click', async () => {
  try {
    $('host').value = await setHost($('host').value)
    say('')
    load()
  } catch (e) {
    say(String(e.message ?? e), true)
  }
})

let boot = async () => {
  ;[tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  $('title').textContent = tab?.title ?? ''
  $('url').textContent = tab?.url ?? ''
  $('host').value = await host()
  if (!filable(tab?.url)) {
    $('line').disabled = $('file').disabled = $('capture').disabled = true
    return say('nothing to file here — this is not a web page')
  }
  let saved = await chrome.storage.local.get(pref(tab.url))
  $('capture').checked = !!saved[pref(tab.url)]
  load()
}

boot()
