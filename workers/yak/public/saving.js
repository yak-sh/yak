// What a person pays now, beside one plan's price (site/organizations.tsx).
// The block it works in carries the plan's dollars a month in `data-saving`
// and is hidden until this script runs, since without it the fields add
// nothing up. Every number typed in it is summed as it is typed, and the
// block's <output> says the sum and what the plan would save or would not, in
// the page's copy: `data-less` when the plan costs less, `data-same` when it
// does not, each filling its %{paid}, %{plan}, %{month} and %{year}.
// Nothing typed leaves the page.
for (let block of document.querySelectorAll('[data-saving]')) {
  let plan = Number(block.dataset.saving)
  let out = block.querySelector('output')
  let dollars = (n) =>
    '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  let fill = (words, values) =>
    words.replace(/%\{(\w+)\}/g, (slot, name) => values[name] ?? slot)
  let said = (paid) =>
    !paid ? '' : fill(paid > plan ? block.dataset.less : block.dataset.same, {
      paid: dollars(paid),
      plan: dollars(plan),
      month: dollars(paid - plan),
      year: dollars((paid - plan) * 12),
    })
  block.addEventListener('input', () => {
    let paid = [...block.querySelectorAll('input')]
      .reduce((sum, field) => sum + Math.max(0, Number(field.value) || 0), 0)
    out.textContent = said(paid)
  })
  block.hidden = false
}
