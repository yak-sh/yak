// The church's colours and fonts, from the directory's `congregation` row, as
// the CSS variables style.css reads.

let hex = (s, or) => (/^#[0-9a-f]{6}$/i.test(s || '') ? s : or)
let rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
let mix = (a, b, t) =>
  '#' +
  rgb(a).map((v, i) =>
    Math.round(v + (rgb(b)[i] - v) * t).toString(16).padStart(2, '0')
  ).join('')
let light = (h) => {
  let [r, g, b] = rgb(h).map((v) => {
    v /= 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
let loaded = new Set()
let font = (name) => {
  if (!name || loaded.has(name)) return
  loaded.add(name)
  let l = document.createElement('link')
  l.rel = 'stylesheet'
  l.href = `https://fonts.googleapis.com/css2?family=${
    name.replace(/ /g, '+')
  }:wght@400;600&display=swap`
  document.head.append(l)
}

let last
export let theme = (church) => {
  let key = JSON.stringify(church ?? {})
  if (key == last) return
  last = key
  let accent = hex(church?.accent, '#2f5d50'),
    paper = hex(church?.paper, '#faf8f3')
  let ink = mix('#1b1a17', accent, 0.08)
  font(church?.heading_font)
  font(church?.body_font)
  let vars = {
    '--paper': paper,
    '--card': mix(paper, '#ffffff', 0.6),
    '--ink': ink,
    '--muted': mix(ink, paper, 0.42),
    '--line': mix(ink, paper, 0.86),
    '--accent': accent,
    '--accent-ink': light(accent) > 0.4 ? '#161512' : '#ffffff',
    '--soft': mix(accent, paper, 0.9),
    ...(church?.heading_font
      ? { '--hf': `'${church.heading_font}', Georgia, serif` }
      : {}),
    ...(church?.body_font
      ? { '--bf': `'${church.body_font}', system-ui, sans-serif` }
      : {}),
  }
  for (let k in vars) document.documentElement.style.setProperty(k, vars[k])
  document.querySelector('meta[name=theme-color]')?.setAttribute(
    'content',
    paper,
  )
}
