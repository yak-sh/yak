import { act, initial, reserve, summary } from './demo-state.js'
const key = 'yaks-homepage-equipment-demo-v1'
let state = initial()
let answer = false
let persistent = true
try {
  const saved = JSON.parse(localStorage.getItem(key))
  if (
    saved?.version === 1 && Array.isArray(saved.items) &&
    Array.isArray(saved.reservations)
  ) state = saved
} catch {
  persistent = false
}
const el = (tag, text, cls) => {
  const node = document.createElement(tag)
  node.textContent = text
  if (cls) node.className = cls
  return node
}
function render() {
  const items = document.querySelector('#items')
  items.replaceChildren()
  for (const item of state.items) {
    const row = el('article', '', 'equipment')
    row.append(el('span', item.mark, 'equipment-mark'))
    const body = el('div', '', 'equipment-body')
    body.append(el('h2', item.name), el('p', item.note))
    const booking = state.reservations.find((r) => r.item === item.id)
    body.append(
      el(
        'p',
        booking ? `Saturday · ${booking.person}` : 'Saturday · Available',
        booking ? 'badge reserved' : 'badge',
      ),
    )
    if (item.id === 'projector' && state.checklist) {
      const checks = el('fieldset', '', 'return-checklist')
      checks.append(el('legend', 'Before returning the projector'))
      for (const part of ['Cable', 'Remote', 'Bag']) {
        const label = el('label', '')
        const input = document.createElement('input')
        input.type = 'checkbox'
        input.checked = state.receipts.includes(part)
        input.addEventListener('change', () => {
          state.receipts = input.checked
            ? [...state.receipts.filter((p) => p !== part), part]
            : state.receipts.filter((p) => p !== part)
          save()
        })
        label.append(input, document.createTextNode(part))
        checks.append(label)
      }
      body.append(checks)
    }
    row.append(body)
    items.append(row)
  }
  document.querySelector('#answer').hidden = !answer
  document.querySelector('#answer-text').textContent = summary(state)
  document.querySelector('#save-state').textContent = persistent
    ? 'Saved only in this browser'
    : 'Temporary example · browser storage unavailable'
  if (parent !== globalThis) {
    parent.postMessage({
      type: 'yaks-demo-state',
      reservations: state.reservations.length,
      published: state.published,
      checklist: state.checklist,
    }, location.origin)
  }
}
function save() {
  try {
    localStorage.setItem(key, JSON.stringify(state))
  } catch {
    persistent = false
  }
  render()
}
document.querySelector('#booking').addEventListener('submit', (event) => {
  event.preventDefault()
  const data = new FormData(event.currentTarget)
  const next = reserve(
    state,
    String(data.get('item')),
    String(data.get('person')),
  )
  state = next.state
  save()
  document.querySelector('#feedback').textContent = next.message
})
document.querySelector('#reset').addEventListener('click', () => {
  state = initial()
  answer = false
  save()
  document.querySelector('#feedback').textContent = 'Example reset.'
})
globalThis.addEventListener('message', (event) => {
  if (
    event.origin !== location.origin || event.source !== parent ||
    event.data?.type !== 'yaks-demo-action'
  ) return
  const action = event.data.action
  if (!['publish', 'neighbor', 'checklist', 'answer'].includes(action)) return
  if (action === 'answer') answer = true
  state = act(state, action)
  save()
})
globalThis.addEventListener('storage', (event) => {
  if (event.key !== key || !event.newValue) return
  try {
    const next = JSON.parse(event.newValue)
    if (next.version === 1) {
      state = next
      render()
    }
  } catch { /* Ignore invalid demo data. */ }
})
render()
