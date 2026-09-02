// Small, optional interactions shared by the concepts. Every page works without it.
let samples = {
  recipes: {
    prompt: 'Make me a recipe box for the dishes we cook every week.',
    path: 'recipes',
    title: 'Our recipes',
    detail: '18 keepers',
  },
  garden: {
    prompt: 'Make a garden log that remembers what I planted.',
    path: 'garden',
    title: 'Garden notes',
    detail: 'Bed 3 · tomatoes',
  },
  club: {
    prompt: 'Make a simple calendar for our Thursday walking club.',
    path: 'thursdays',
    title: 'Thursday walks',
    detail: 'Next: River trail',
  },
}

let setSample = (key) => {
  let sample = samples[key]
  if (!sample) return
  document.querySelectorAll('[data-prompt]').forEach((node) => {
    node.textContent = sample.prompt
  })
  document.querySelectorAll('[data-path]').forEach((node) => {
    node.textContent = sample.path
  })
  document.querySelectorAll('[data-app-title]').forEach((node) => {
    node.textContent = sample.title
  })
  document.querySelectorAll('[data-app-detail]').forEach((node) => {
    node.textContent = sample.detail
  })
  document.querySelectorAll('[data-sample]').forEach((node) => {
    let active = node.dataset.sample === key
    node.setAttribute('aria-pressed', String(active))
  })
}

document.querySelectorAll('[data-sample]').forEach((button) => {
  button.addEventListener('click', () => setSample(button.dataset.sample))
})

document.querySelectorAll('[data-waitlist]').forEach((form) => {
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    let status = form.querySelector('[data-status]')
    if (status) status.textContent = 'You’re on the list. We’ll be in touch.'
    form.querySelector('button')?.setAttribute('disabled', '')
  })
})
