import { concepts } from './concepts.js'

let chosen = new Set()
let grid = document.querySelector('#grid')
grid.innerHTML = concepts.map((c, i) =>
  `<article class="Study" style="--swatch:${c.color}"><div class="Preview"><iframe loading="lazy" src="${c.id}.html?preview=1" tabindex="-1" aria-hidden="true" title="Preview of ${c.name}"></iframe><a class="Preview_Link" href="${c.id}.html" aria-label="Explore ${c.name}"><span>Explore this world ↗</span></a></div><div class="Study_Detail"><div><h3><a href="${c.id}.html"><small>${
    String(i + 1).padStart(2, '0')
  }</small>${c.name}</a></h3><p>${c.mood}</p></div><button class="Pick" type="button" data-id="${c.id}" aria-pressed="false" aria-label="Select ${c.name} to compare">+ Compare</button></div></article>`
).join('')

let update = () => {
  document.querySelector('#compare-bar').hidden = chosen.size === 0
  document.querySelector('#selection').textContent =
    `${chosen.size} of 2 selected`
  let link = document.querySelector('#compare-link')
  link.setAttribute('aria-disabled', String(chosen.size !== 2))
  link.tabIndex = chosen.size === 2 ? 0 : -1
  link.href = `compare.html?a=${[...chosen][0] || ''}&b=${[...chosen][1] || ''}`
  document.querySelectorAll('.Pick').forEach((button) => {
    let active = chosen.has(button.dataset.id)
    button.setAttribute('aria-pressed', String(active))
    button.textContent = active ? '✓ Selected' : '+ Compare'
    button.disabled = chosen.size === 2 && !active
  })
}
grid.addEventListener('click', (event) => {
  let button = event.target.closest('.Pick')
  if (!button) return
  let id = button.dataset.id
  if (chosen.has(id)) chosen.delete(id)
  else if (chosen.size < 2) chosen.add(id)
  update()
})
document.querySelector('#clear').addEventListener('click', () => {
  chosen.clear()
  update()
})
let resize = new ResizeObserver((entries) =>
  entries.forEach(({ target, contentRect }) => {
    target.querySelector('iframe').style.transform = `scale(${
      contentRect.width / 1440
    })`
  })
)
document.querySelectorAll('.Preview').forEach((node) => resize.observe(node))
