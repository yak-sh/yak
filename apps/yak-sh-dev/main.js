// The guide stays readable without JavaScript; only the playground loads packages.
const $ = (selector) => document.querySelector(selector)
for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(
        document.getElementById(button.dataset.copy).textContent,
      )
      button.textContent = 'Copied'
    } catch {
      button.textContent = 'Select code'
    }
    setTimeout(() => button.textContent = 'Copy', 1800)
  })
}
let runtime
const load = () =>
  runtime ??= import('./playground.js').then((module) => module.create())
const output = $('#output')
const input = $('#command')
let busy = false
async function run(command) {
  if (busy) return
  busy = true
  $('#run').disabled = true
  $('#runtime-status').textContent = 'Loading packages…'
  try {
    const graph = await load()
    $('#runtime-status').textContent = 'Live · in memory'
    output.textContent = `> yak ${command}\n\n`
    await graph.run(command, (line) => output.textContent += `${line}\n`)
    const books = await graph.books()
    $('#entity-count').textContent = `${books.length} ${
      books.length === 1 ? 'entity' : 'entities'
    }`
    $('#books').replaceChildren(...books.map((bundle) => {
      const article = document.createElement('article')
      article.className = 'book'
      const row = document.createElement('div')
      const symbol = document.createElement('span')
      symbol.className = 'book-symbol'
      symbol.textContent = 'B'
      const id = document.createElement('span')
      id.className = 'book-id'
      id.textContent = bundle.entity.eid
      row.append(symbol, id)
      const title = document.createElement('h3')
      title.textContent = bundle.book.title
      const pages = document.createElement('p')
      const count = document.createElement('strong')
      count.textContent = bundle.book.pages
      pages.append(count, ' pages')
      article.append(row, title, pages)
      return article
    }))
  } catch (error) {
    $('#runtime-status').textContent = 'Could not run'
    output.textContent =
      `The playground could not run: ${error.message}\n\nCheck your connection and try again. The guide and source links still work.`
    runtime = undefined
  } finally {
    busy = false
    $('#run').disabled = false
  }
}
$('#command-form').addEventListener('submit', (event) => {
  event.preventDefault()
  run(input.value.trim().replace(/^yak\s+/, ''))
})
for (const button of document.querySelectorAll('[data-command]')) {
  button.addEventListener('click', () => {
    input.value = button.dataset.command
    run(input.value)
  })
}
