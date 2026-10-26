import { concepts } from './concepts.js'

let params = new URLSearchParams(location.search)
let pick = (key, fallback) =>
  concepts.find((c) => c.id === params.get(key)) || concepts[fallback]
let panes = [pick('a', 0), pick('b', 1)]
document.querySelector('#frames').innerHTML = panes.map((c, i) =>
  `<section class="ComparePane"><div class="PaneHead"><select aria-label="${
    i ? 'Second' : 'First'
  } concept">${
    concepts.map((item) =>
      `<option value="${item.id}" ${
        item.id === c.id ? 'selected' : ''
      }>${item.name}</option>`
    ).join('')
  }</select><a href="${c.id}.html" target="_blank" rel="noopener">Open full page ↗</a></div><iframe src="${c.id}.html?compare=1" title="${c.name}"></iframe></section>`
).join('')
document.querySelectorAll('.ComparePane').forEach((pane, i) => {
  pane.querySelector('select').addEventListener('change', (event) => {
    let concept = concepts.find((c) => c.id === event.target.value)
    pane.querySelector('iframe').src = `${concept.id}.html?compare=1`
    pane.querySelector('iframe').title = concept.name
    pane.querySelector('a').href = `${concept.id}.html`
    params.set(i ? 'b' : 'a', concept.id)
    history.replaceState(null, '', `?${params}`)
  })
})
