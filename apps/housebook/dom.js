export let el = (tag, attrs = {}, ...children) => {
  let node = document.createElement(tag)
  for (let [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) {
      node.addEventListener(key.slice(2).toLowerCase(), value)
    } else if (key === 'class') node.className = value
    else if (key === 'checked') node.checked = value
    else if (value !== false && value != null) node.setAttribute(key, value)
  }
  node.append(...children.flat().filter((v) => v != null))
  return node
}
export let button = (label, action, cls = '') =>
  el('button', { type: 'button', class: cls, onClick: action }, label)
export let empty = (heading, body, action) =>
  el(
    'div',
    { class: 'empty' },
    el('h3', {}, heading),
    el('p', {}, body),
    action,
  )
export let tag = (value, cls = '') => el('span', { class: 'tag ' + cls }, value)
