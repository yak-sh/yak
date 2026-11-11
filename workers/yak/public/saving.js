// What a person pays now, beside one plan's price (site/organizations.tsx).
// The block it works in carries the plan's dollars a month in `data-saving`
// and is hidden until this script runs, since without it the fields add
// nothing up. Every number typed in it is summed as it is typed, and the
// block's <output> says the sum and what the plan would save or would not.
// Nothing typed leaves the page.
for (let block of document.querySelectorAll('[data-saving]')) {
  let plan = Number(block.dataset.saving)
  let out = block.querySelector('output')
  let dollars = (n) =>
    '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  let said = (paid) =>
    !paid ? '' : paid > plan
      ? `You pay ${dollars(paid)} a month for these. ` +
        `They are ${dollars(plan)} a month here, which is ` +
        `${dollars(paid - plan)} less each month and ` +
        `${dollars((paid - plan) * 12)} less each year.`
      : `You pay ${dollars(paid)} a month for these, which is no more than ` +
        `the ${dollars(plan)} plan. It would not save you money.`
  block.addEventListener('input', () => {
    let paid = [...block.querySelectorAll('input')]
      .reduce((sum, field) => sum + Math.max(0, Number(field.value) || 0), 0)
    out.textContent = said(paid)
  })
  block.hidden = false
}
