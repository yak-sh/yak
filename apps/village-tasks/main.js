// The village task page reads its own rows and Vale's villager and hero rows
// through the two documented page stores. A completion is about the hero Vale
// selected in this tab; the page does not own or copy Vale's game state.
// The platform serves the client beside the page (deno.json maps it to the
// repo's copy for the type check). A static import, so the browser fetches it
// beside state.js rather than after it.
import { apply, me, query, store, subscribe } from './api/client.js'
import { completed, completionEid } from './state.js'

let vale = store('/vale/api/')
let list = document.querySelector('.Tasks')
let esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
let player = (() => {
  try {
    return sessionStorage.getItem('mossvale.hero')
  } catch {
    return null
  }
})()
let tasks = []
let people = new Map()
let done = new Set()
let sent = new Set()
let busy = new Set()
let writable = false
let error = ''

let draw = () => {
  if (!player) {
    list.innerHTML =
      '<p class=Status>Enter Mossvale and choose a hero first. ' +
      '<a href=/vale/>Go to Mossvale</a></p>'
    return
  }
  if (!tasks.length) {
    list.innerHTML = '<p class=Status>The village list is empty.</p>'
    return
  }
  list.innerHTML = tasks.map((r) => {
    let t = r.village_task
    let name = people.get(t.villager)?.doc?.title ?? 'Pip'
    let doneHere = done.has(r.entity.eid) || sent.has(r.entity.eid)
    let disabled = doneHere || busy.has(r.entity.eid) || !writable
    return `<article class=Task>
      <p class=Task_Who>From ${esc(name)}</p>
      <h2>${esc(t.title)}</h2>
      <p>${esc(t.body)}</p>
      <button data-task="${esc(r.entity.eid)}" ${disabled ? 'disabled' : ''}>
        ${
      doneHere
        ? 'Done for this hero'
        : busy.has(r.entity.eid)
        ? 'Saving…'
        : 'Mark done'
    }</button>
    </article>`
  }).join('') + (error ? `<p class=Status role=alert>${esc(error)}</p>` : '') +
    (!writable ? '<p class=Status>This list is read-only for you.</p>' : '')
}

let finish = async (eid) => {
  if (!player || !writable || done.has(eid) || sent.has(eid) || busy.has(eid)) {
    return
  }
  busy.add(eid)
  error = ''
  draw()
  try {
    await apply({
      entity: { eid: await completionEid(eid, player) },
      village_done: { task: eid, player, at: Date.now() },
    })
    sent.add(eid)
  } catch (e) {
    // A second tab may have written the same completion. Read the store again
    // before deciding whether there was an error to show.
    try {
      done = completed(await query(`.village_done.player=${player}`), player)
    } catch { /* the first refusal is the one to show */ }
    if (!done.has(eid)) {
      error = e.message ?? String(e)
    }
  } finally {
    busy.delete(eid)
    draw()
  }
}

list.addEventListener('click', (e) => {
  let button = e.target.closest('button[data-task]')
  if (button) void finish(button.dataset.task)
})

let start = async () => {
  // Everything the page draws is asked for at once, so it loads in one round:
  // the hero's completions are a subscription whose first rows the page waits
  // for, rather than a query and then the same line again.
  let drawn = false
  let live = player &&
    subscribe(`.village_done.player=${player}`, (rows) => {
      done = completed(rows, player)
      if (drawn) draw()
    })
  let [who, rows, villagers, heroes, looks] = await Promise.all([
    me(),
    query('.village_task'),
    vale.query('.villager&?doc'),
    player ? vale.query(`id=${player}&.player`) : [],
    player ? vale.query(`.look.player=${player}`) : [],
    live?.ready,
  ])
  writable = who.writes
  tasks = rows
  people = new Map(villagers.map((r) => [r.entity.eid, r]))
  if (player && !heroes.length) {
    live()
    player = null
  }
  if (player) {
    let look = looks.sort((a, b) => (b.look?.at ?? 0) - (a.look?.at ?? 0))[0]
    document.querySelector('.Hero').textContent = `For ${
      look?.look?.name ?? 'your selected hero'
    }`
  }
  drawn = true
  draw()
}

start().catch((e) => {
  list.innerHTML = `<p class=Status role=alert>${esc(e.message ?? e)}</p>`
})
