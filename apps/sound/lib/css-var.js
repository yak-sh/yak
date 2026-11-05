export let root = document.querySelector(':root')
export let style = {}
export let pending = null

export function render(styles = undefined) {
  if (styles) Object.assign(style, styles)
  if (pending) return
  pending = requestAnimationFrame(() => {
    for (let key in style) root.style.setProperty('--' + key, style[key])
    style = {}, pending = null
  })
}

export function watchAll() {
  document.querySelectorAll('[data-var]').forEach(watch)
}
export function watch(el) {
  set(el)
  el.addEventListener('input', (e) => set(e.target))
}
export function set(el) {
  style[key(el)] = el[prop(el)] + unit(el)
  render()
}

export function unit(el) {
  return el.dataset.unit || ''
}
export function key(el) {
  return el.dataset.var || el.id || el.name
}

export function prop(el) {
  return ['checkbox', 'radio', 'option'].includes(el.type) ? 'checked' : 'value'
}

export default function main() {
  watchAll()
}
