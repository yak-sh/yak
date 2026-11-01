// The one listener behind every chart on a page (@yaks/ui/chart): what a
// pointer rests on, a finger drags over or an arrow key steps to is said in one
// tip, with a line through it on the chart. A chart holds its series in its
// `data-` attributes and nothing happens until somebody asks. Without this
// script a chart still says its whole series to a screen reader and draws
// what it draws. Every write to the page is textContent.
let tip
let on

let day = (from, i) =>
  new Date(Date.parse(`${from}T00:00:00Z`) + i * 86400000)
    .toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    })

let said = (chart, n) => {
  if ('money' in chart.dataset) {
    return `$${n >= 0.01 || n <= 0 ? n.toFixed(2) : n.toPrecision(1)}`
  }
  let noun = chart.dataset.noun
  return n.toLocaleString('en-US') +
    (noun ? ` ${noun}${n == 1 ? '' : 's'}` : '')
}

let valuesOf = (chart) => chart.dataset.values.split(',').map(Number)

// Where point `i` of `n` sits across the chart, from 0 to 1: a line's points
// run edge to edge, a column stands in the middle of its share.
let across = (chart, i, n) =>
  chart.dataset.chart == 'bars' ? (i + 0.5) / n : i / Math.max(1, n - 1)

let nearest = (chart, x, n) =>
  chart.dataset.chart == 'bars'
    ? Math.min(n - 1, Math.floor(x * n))
    : Math.round(x * (n - 1))

let hide = () => {
  if (tip) tip.hidden = true
  if (on) delete on.dataset.on
  on = undefined
}

let show = (chart, i) => {
  let values = valuesOf(chart)
  let box = chart.getBoundingClientRect()
  if (on && on != chart) delete on.dataset.on
  on = chart
  chart.dataset.on = i
  let x = across(chart, i, values.length)
  chart.style.setProperty('--at', `${x * 100}%`)
  if (!tip) {
    tip = document.createElement('div')
    tip.className = 'Chart_Tip'
    tip.setAttribute('role', 'status')
    document.body.append(tip)
  }
  tip.hidden = false
  tip.textContent = `${day(chart.dataset.from, i)}: ${said(chart, values[i])}`
  let width = tip.offsetWidth
  let left = box.left + x * box.width - width / 2
  tip.style.left = `${
    Math.max(
      4,
      Math.min(left, document.documentElement.clientWidth - width - 4),
    )
  }px`
  tip.style.top = `${Math.max(4, box.top - tip.offsetHeight - 6)}px`
}

let pointed = (e) => {
  let chart = e.target.closest?.('[data-chart]')
  if (!chart) {
    if (on && document.activeElement != on) hide()
    return
  }
  let box = chart.getBoundingClientRect()
  let x = Math.max(0, Math.min(1, (e.clientX - box.left) / (box.width || 1)))
  show(chart, nearest(chart, x, valuesOf(chart).length))
}

addEventListener('pointermove', pointed)
addEventListener('pointerdown', pointed)
addEventListener('scroll', hide, { passive: true, capture: true })

addEventListener('focusin', (e) => {
  let chart = e.target.closest?.('[data-chart]')
  if (chart && chart != on) show(chart, valuesOf(chart).length - 1)
})
addEventListener('focusout', (e) => {
  if (e.target == on) hide()
})
addEventListener('keydown', (e) => {
  let chart = e.target.closest?.('[data-chart]')
  if (!chart) return
  if (e.key == 'Escape') return hide()
  let step = { ArrowLeft: -1, ArrowRight: 1 }[e.key]
  if (!step) return
  e.preventDefault()
  let last = valuesOf(chart).length - 1
  let at = chart == on ? Number(chart.dataset.on) : last
  show(chart, Math.max(0, Math.min(last, at + step)))
})
