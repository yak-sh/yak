export function each(fn) {
  document.querySelectorAll('[data-store]').forEach(fn)
}

export function loadAll() {
  each(load)
}
export function storeAll() {
  each(store)
}
export function watchAll() {
  each(watch)
}
export function patchAll() {
  each(patch)
}

export function watch(el) {
  el.addEventListener('input', () => store(el))
}

export function patch(el) {
  switch (el.type) {
    case 'form':
    case 'fieldset':
      Object.values(el.elements).forEach((input) => {
        input.set = (value) => (input[prop(input)] = value, store(el))
      })
      break
    default:
      el.set = (value) => (el[prop(el)] = value, store(el))
  }
}

export function load(el) {
  let name = key(el)
  if (name in localStorage) {
    setValue(el, JSON.parse(localStorage[name]))
  }
}

export function store(el) {
  let name = key(el)
  localStorage[name] = JSON.stringify(value(el))
}

export function setValue(el, value) {
  switch (el.type) {
    case 'form':
    case 'fieldset':
      return Object.entries(value).forEach(([name, v]) =>
        setValue(el.elements[name], v)
      )
    default:
      el[prop(el)] = value
      el.dispatchEvent(new Event('set'))
      ;(function () {
        eval(this.getAttribute('onset') || '')
      }).call(el)
  }
}

export function value(el) {
  switch (el.type) {
    case 'form':
    case 'fieldset':
      return Object.fromEntries(
        [...el.elements].map((el) => [el.name, value(el)]),
      )
    default:
      return el[prop(el)]
  }
}

export function prop(el) {
  return ['checkbox', 'radio', 'option'].includes(el.type) ? 'checked' : 'value'
}

export function key(el) {
  return el.dataset.store || `${location.pathname}#${el.id}`
}

export default function main() {
  patchAll()
  loadAll()
  watchAll()
}
