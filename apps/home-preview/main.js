// A transparent, guided agent demonstration over live published app data.
// View changes are local; the original recipe app is never written to.
import { categories, escapeHTML as esc, ingredients } from './model.js'
const $ = (q) => document.querySelector(q)
let rows = [], mode = 'cards', selected = new Set(), category = '', busy = false
const reduced = matchMedia('(prefers-reduced-motion: reduce)')
const view = $('#app-view')
function card(row, index) {
  return `<article class="recipe-card colour-${
    index % 4
  }" style="view-transition-name:recipe-${index}"><div class="card-rule"><span>${
    esc(row.recipe.category || 'Recipe')
  }</span><span aria-hidden="true">${
    ['◒', '✳', '◔', '❋'][index % 4]
  }</span></div><h4>${esc(row.doc.title || 'Untitled recipe')}</h4><p>${
    esc(row.recipe.duration || 'Take your time')
  }</p><details><summary>Look inside <span>＋</span></summary><p class="recipe-ingredients">${
    esc(row.recipe.ingredients)
  }</p></details><div class="card-foot">${
    row.recipe.serves ? `Serves ${esc(row.recipe.serves)}` : 'From the demo box'
  }<span aria-hidden="true">↗</span></div></article>`
}
function render() {
  const groups = categories(rows)
  $('#recipe-count').textContent = `${rows.length} live recipes`
  $('#view-label').textContent = ({
    cards: 'A place for every recipe',
    categories: 'A little order, your way',
    ingredients: 'From recipe cards to something useful',
  })[mode]
  if (mode === 'ingredients') {
    const list = ingredients(rows, selected)
    view.innerHTML =
      `<div class="ingredient-work"><p class="view-intro">Pick recipes. Their actual ingredient lists come with them.</p><div class="recipe-picks">${
        rows.map((r) =>
          `<label><input type="checkbox" data-pick="${esc(r.entity.eid)}" ${
            selected.has(r.entity.eid) ? 'checked' : ''
          }><span>${esc(r.doc.title)}</span></label>`
        ).join('')
      }</div><div class="list-paper"><div class="list-title"><h4>The ingredient list</h4><span>${
        list.reduce((n, r) => n + r.lines.length, 0)
      } lines · ${list.length} recipes</span></div>${
        list.length
          ? list.map((r) =>
            `<section><h5>${esc(r.title)}</h5>${
              r.lines.map((line) =>
                `<label class="ingredient-line"><input type="checkbox"><span>${
                  esc(line)
                }</span></label>`
              ).join('')
            }</section>`
          ).join('')
          : '<p>Choose a recipe above to see what’s inside.</p>'
      }<p class="list-note">Read from the live cards. Quantities kept exactly as written.</p></div></div>`
  } else if (mode === 'categories') {
    view.innerHTML =
      `<div class="category-tabs" role="group" aria-label="Recipe category"><button data-category="" aria-pressed="${!category}">All <span>${rows.length}</span></button>${
        groups.map((g) =>
          `<button data-category="${esc(g)}" aria-pressed="${category === g}">${
            esc(g)
          } <span>${
            rows.filter((r) => r.recipe.category === g).length
          }</span></button>`
        ).join('')
      }</div><div class="category-board">${
        groups.filter((g) => !category || g === category).map((g) =>
          `<section><h4 class="category-heading"><span class="seed"></span>${
            esc(g)
          }<span>${
            rows.filter((r) => (r.recipe.category || 'Unsorted') === g).length
          }</span></h4><div class="category-rows">${
            rows.map((r, i) => ({ r, i })).filter(({ r }) =>
              (r.recipe.category || 'Unsorted') === g
            ).map(({ r, i }) =>
              `<article class="recipe-row" style="view-transition-name:recipe-${i}"><span class="row-number">${
                String(i + 1).padStart(2, '0')
              }</span><div><h5>${esc(r.doc.title)}</h5><p>${
                esc(r.recipe.duration)
              }</p></div><details><summary>Ingredients ＋</summary><p class="recipe-ingredients">${
                esc(r.recipe.ingredients)
              }</p></details></article>`
            ).join('')
          }</div></section>`
        ).join('')
      }</div>`
  } else {view.innerHTML = `<div class="recipe-grid">${
      rows.map(card).join('')
    }</div>`}
  view.setAttribute('aria-busy', 'false')
}
async function change(next, animate = true) {
  if (!rows.length || busy) return
  busy = true
  mode = next
  category = ''
  document.querySelectorAll('[data-action]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.action === mode))
  )
  const replies = {
    cards:
      `Here are ${rows.length} cards, with room for the details. Open one: the ingredients are from the live app, not sample text.`,
    categories: `I read the category on each recipe and made ${
      categories(rows).length
    } groups. Same recipes, a different way in. Try a category.`,
    ingredients:
      'I can work with the data, too. Pick a few recipe cards and I’ll pull their ingredients into one list. Nothing is changed in the original app.',
  }
  $('#reply').textContent = replies[mode]
  if (animate && document.startViewTransition && !reduced.matches) {
    const transition = document.startViewTransition(render)
    try {
      await transition.finished
    } catch { /* A newer browser paint may skip the animation. */ }
  } else render()
  busy = false
}
document.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')
  if (action) change(action.dataset.action)
  const tab = event.target.closest('[data-category]')
  if (tab) {
    category = tab.dataset.category
    render()
  }
})
view.addEventListener('change', (event) => {
  const id = event.target.dataset.pick
  if (!id) return
  event.target.checked ? selected.add(id) : selected.delete(id)
  render()
  const replacement = view.querySelector(`[data-pick="${CSS.escape(id)}"]`)
  replacement?.focus({ preventScroll: true })
  $('#reply').textContent = `I read ${selected.size} selected recipe${
    selected.size === 1 ? '' : 's'
  } and brought their ingredients together. Tick things off here; the original cards stay as they are.`
})
$('#reset').addEventListener('click', () => {
  selected.clear()
  change('cards')
})
async function load() {
  try {
    const response = await fetch('./demo-recipes')
    if (!response.ok) throw new Error('unavailable')
    rows = await response.json()
    if (!Array.isArray(rows) || !rows.length) throw new Error('empty')
    $('#connection').textContent = 'Live data'
    $('#connection').classList.add('connected')
    await change('cards', false)
  } catch {
    $('#connection').textContent = 'Not connected'
    $('#reply').textContent =
      'The live demo is taking a moment. You can retry, or open the original recipe box.'
    view.setAttribute('aria-busy', 'false')
    view.innerHTML =
      '<div class="empty"><p>We couldn’t reach the live recipe box.</p><button id="retry">Try again ↺</button><a href="https://yourname.yaks.app/recipes/">Open the recipe box ↗</a></div>'
    $('#retry').addEventListener('click', load)
  }
}
load()
const bench = $('.studio')
bench.addEventListener('pointermove', (event) => {
  if (reduced.matches || event.pointerType !== 'mouse') return
  const rect = bench.getBoundingClientRect()
  bench.style.setProperty(
    '--pointer-x',
    `${(event.clientX - rect.left) / rect.width * 100}%`,
  )
  bench.style.setProperty(
    '--pointer-y',
    `${(event.clientY - rect.top) / rect.height * 100}%`,
  )
})
