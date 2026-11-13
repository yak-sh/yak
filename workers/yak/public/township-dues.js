// When a meeting's notice and minutes are due (site/townships.tsx), worked
// out by the township app's own function: the block names that app's
// deadlines.js in `data-dues`, which is imported as the page runs, and the
// block is hidden until it has loaded. A meeting's date, the time it starts,
// whether it is special and its time zone go in; the days its minutes are
// due and the hour its notice must be up by come out, each said in a line of
// the block's template, the page's copy, with its date in the line's place
// for one (`data-at`). Nothing typed leaves the page. Where the import fails,
// the block stays hidden, and the page still says the rules it counts by.
for (let block of document.querySelectorAll('[data-dues]')) {
  import(block.dataset.dues).then(({ dues }) => {
    let field = (name) => block.querySelector(`#dues-${name}`)
    let out = block.querySelector('.Dues_Said')
    let day = (key) =>
      new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', {
        timeZone: 'UTC',
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    let hour = (at, zone) =>
      new Date(at).toLocaleString('en-US', {
        timeZone: zone,
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).replace(/, (\d+:)/, ' at $1')
    // How far `zone`'s clock is ahead of UTC at the instant `t`, in ms.
    let ahead = (t, zone) => {
      let p = Object.fromEntries(
        new Intl.DateTimeFormat('en-US', {
          timeZone: zone,
          hourCycle: 'h23',
          year: 'numeric',
          month: 'numeric',
          day: 'numeric',
          hour: 'numeric',
          minute: 'numeric',
        }).formatToParts(t).map((x) => [x.type, Number(x.value)]),
      )
      return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - t
    }
    // The instant a clock in `zone` reads `key` at `time`.
    let instant = (key, time, zone) => {
      let read = Date.parse(`${key}T${time}:00Z`)
      return new Date(read - ahead(read - ahead(read, zone), zone))
        .toISOString()
    }
    let lines = block.querySelector('.Dues_Lines').content
    let line = (due, at) => {
      let li = lines.querySelector(`[data-due="${due}"]`).cloneNode(true)
      let place = li.querySelector('[data-at]')
      if (place) place.textContent = at
      return li
    }
    let said = () => {
      let key = field('day').value, time = field('time').value
      let zone = field('zone').value, special = field('special').checked
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return []
      let due = dues(instant(key, time || '12:00', zone), zone)
      return [
        line('proposed', day(due.proposed)),
        line('approved', day(due.approved)),
        ...!special
          ? []
          : [time ? line('notice', hour(due.notice, zone)) : line('untimed')],
      ]
    }
    let show = () => {
      let list = document.createElement('ul')
      list.className = 'Plan_List'
      list.append(...said())
      out.replaceChildren(...list.childNodes.length ? [list] : [])
    }
    block.addEventListener('input', show)
    block.addEventListener('change', show)
    block.hidden = false
  }).catch(() => {})
}
