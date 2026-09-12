const story = document.querySelector('.story')
const screen = document.querySelector('#app-screen')
const conversation = document.querySelector('#conversation')
const reduced = matchMedia('(prefers-reduced-motion: reduce)')
let current = 'recipes', stage = -1, changeTimer, flight
const demos = {
  recipes: {
    name: 'Recipe box',
    brand: 'The recipe box',
    sub: 'A collection worth keeping.',
    chats: [
      [
        'I have recipes in about six different places. Can you make me a recipe box?',
        'Absolutely. Here’s one place for your favorites. Open a recipe, or add something new.',
        '✓ Recipe collection created · 3 favorites added',
      ],
      [
        'My sister’s vegetarian. Can we add a way to find the things she can eat?',
        'I’ve added dietary tags and a vegetarian filter. Your recipes are right where you left them.',
        '✓ Dietary tags added · Filter ready · Recipes kept',
      ],
      [
        'Let’s make the soup and the salad. Put what we need on a shopping list for four.',
        'Done. I’ve read the ingredients, combined the quantities, and made a list you can check off.',
        '✓ 2 recipes read · 4 servings · 1 shopping list',
      ],
    ],
  },
  garden: {
    name: 'Garden notes',
    brand: 'Out in the garden',
    sub: 'Good things take a little tending.',
    chats: [
      [
        'Can you make somewhere to remember what we planted and when?',
        'Here’s your garden notebook. Each plant has a place for dates, notes, and observations.',
        '✓ Plant notebook created · 3 plants added',
      ],
      [
        'We keep forgetting which plants need water. Can we track that?',
        'I’ve added watering notes and a needs-water view, without changing your planting history.',
        '✓ Watering dates added · New view ready',
      ],
      [
        'What needs attention this weekend?',
        'The basil is due for water and the tomatoes are ready to tie up. I made a weekend checklist.',
        '✓ Garden records read · Weekend checklist created',
      ],
    ],
  },
  club: {
    name: 'Book club',
    brand: 'The reading room',
    sub: 'Good books. Better conversations.',
    chats: [
      [
        'We’re starting a book club. Can you help us keep it all together?',
        'Here’s a shared reading shelf, with your current book and the next meeting.',
        '✓ Reading shelf created · First meeting added',
      ],
      [
        'Everyone has different schedules. Let’s let people vote on the next date.',
        'I’ve added a date poll alongside the meeting. Your reading shelf stays the same.',
        '✓ Date voting added · Members can respond',
      ],
      [
        'Which date works best, and what should we talk about?',
        'Sunday has the most votes. I’ve collected the questions people left into a meeting agenda.',
        '✓ Votes counted · Questions gathered · Agenda ready',
      ],
    ],
  },
}
function cards(tags = false) {
  return `<div class="recipe-grid"><article class="recipe-card"><div class="food-art"><div class="plate">🥗</div></div><div class="recipe-info"><strong>Sunday garden salad</strong><small>15 min · From Maya</small>${
    tags ? '<span class="tag">VEGETARIAN</span>' : ''
  }</div></article><article class="recipe-card"><div class="food-art soup"><div class="plate">🥣</div></div><div class="recipe-info"><strong>Roasted tomato soup</strong><small>40 min · A family favorite</small>${
    tags ? '<span class="tag">VEGETARIAN</span>' : ''
  }</div></article><article class="recipe-card"><div class="food-art cake"><div class="plate">🍰</div></div><div class="recipe-info"><strong>Olive oil & lemon cake</strong><small>55 min · Weekend baking</small>${
    tags ? '<span class="tag">VEGETARIAN</span>' : ''
  }</div></article></div>`
}
function shell(body) {
  const d = demos[current]
  return `<div class="app-titlebar"><span class="app-brand">${d.brand}</span><small>YOUR APP / V${
    stage + 1
  }</small></div><div class="app-nav"><b>${
    current === 'recipes'
      ? 'My recipes'
      : current === 'garden'
      ? 'My plants'
      : 'Our shelf'
  }</b><span>${
    stage === 2 ? 'Our plans' : 'Favorites'
  }</span><span>Notes</span></div>${body}<div class="screen-footer"><span>Made for the way you do things.</span><strong>yaks.app ↗</strong></div>`
}
function renderScreen() {
  let body = ''
  if (current === 'recipes') {
    body = `<div class="app-heading"><div><h3>${
      stage === 2 ? 'Dinner, taken care of.' : 'A few good things to make.'
    }</h3><p>${
      stage === 2
        ? 'Your recipes → your shopping list.'
        : 'Recipes from friends, family, and everywhere else.'
    }</p></div><button class="tiny-button" id="demo-add">+ Add recipe</button></div>`
    if (stage === 1) {
      body +=
        '<div class="filters"><button class="filter" data-filter="all">All recipes</button><button class="filter active" data-filter="veg">Vegetarian ✓</button><button class="filter" data-filter="quick">Under 30 minutes</button></div>'
    }
    body += stage === 2
      ? `<div class="shopping-layout">${
        cards(true)
      }<aside class="shopping-list"><h4>Shopping list</h4><p>FOR FOUR · SOUP + SALAD</p>${
        [
          'Tomatoes · 800 g',
          'Mixed leaves · 1 bag',
          'Red onion · 1',
          'Vegetable stock · 1 L',
          'Bread · 1 loaf',
        ].map((x) => `<label><input type="checkbox">${x}</label>`).join('')
      }</aside></div>`
      : cards(stage === 1)
  } else if (current === 'garden') {
    body = `<div class="app-heading"><div><h3>${
      stage === 2 ? 'A weekend in the garden.' : 'What’s growing?'
    }</h3><p>${
      stage === 1 ? 'A little water makes a difference.' : demos.garden.sub
    }</p></div><span class="tiny-button">${
      stage === 1 ? 'Needs water' : 'June notes'
    }</span></div><div class="garden-grid">${
      [['🌿', 'Basil', stage === 1 ? 'Water today' : 'Planted May 12'], [
        '🍅',
        'Tomatoes',
        stage === 1 ? 'Watered yesterday' : 'Planted April 28',
      ], ['🌼', 'Calendula', stage === 1 ? 'Watered today' : 'Planted May 8']]
        .map((p) =>
          `<article class="plant">${p[0]}<strong>${p[1]}</strong><small>${
            p[2]
          }</small></article>`
        ).join('')
    }</div>${
      stage === 2
        ? '<div class="app-note">☐ Water the basil &nbsp; ☐ Tie up tomatoes &nbsp; ☐ Take a photo</div>'
        : ''
    }`
  } else {
    body = `<div class="app-heading"><div><h3>${
      stage === 2 ? 'Sunday looks good.' : 'Something worth talking about.'
    }</h3><p>${demos.club.sub}</p></div></div><div class="book-row"><div class="book-cover">The<br>Secret<br>Garden</div><p><b>On our shelf this month</b><br>The Secret Garden · Frances Hodgson Burnett<br>Next meeting: Sunday, 4 pm</p></div>${
      stage === 1
        ? '<div class="app-note">WHEN CAN YOU MAKE IT?<br><br>Friday · 2 votes &nbsp;&nbsp; Saturday · 3 votes &nbsp;&nbsp; <b>Sunday · 6 votes</b></div>'
        : stage === 2
        ? '<div class="app-note"><b>OUR MEETING AGENDA</b><br><br>01 · What changes Mary’s mind?<br>02 · A favorite passage from each of us<br>03 · Pick our next book</div>'
        : '<div class="app-note">6 readers · One shared shelf · Plenty of opinions</div>'
    }`
  }
  screen.innerHTML = shell(body)
  screen.querySelectorAll('[data-filter]').forEach((b) =>
    b.addEventListener('click', () => {
      screen.querySelectorAll('[data-filter]').forEach((x) =>
        x.classList.toggle('active', x === b)
      )
      screen.querySelectorAll('.recipe-card').forEach((card, i) =>
        card.hidden = b.dataset.filter === 'quick' && i > 0
      )
    })
  )
  screen.querySelector('#demo-add')?.addEventListener('click', () => {
    document.querySelector('#announcement').textContent =
      'This is a scripted example. Scroll to watch your assistant change the app.'
    const btn = screen.querySelector('#demo-add')
    btn.textContent = 'Demo only'
    setTimeout(() => {
      if (btn.isConnected) btn.textContent = '+ Add recipe'
    }, 1500)
  })
}
function render() {
  const d = demos[current], chat = d.chats[stage]
  conversation.innerHTML =
    `<div class="chat-line user"><span class="speaker">YOU</span><p>${
      chat[0]
    }</p></div><div class="chat-line agent"><span class="speaker">YOUR ASSISTANT</span><p>${
      chat[1]
    }</p></div><div class="change-receipt">${chat[2]}</div>`
  document.querySelector('#page-number').textContent = `0${stage + 1} / 03`
  document.querySelectorAll('[data-versions]').forEach((el) => {
    el.innerHTML = el.dataset.versions === current
      ? Array.from(
        { length: stage + 1 },
        (_, i) => i < stage ? `<del>V${i + 1}</del>` : `<b>V${i + 1}</b>`,
      ).join('')
      : '<b>V1</b>'
  })
  document.querySelectorAll('[data-stage]').forEach((b) =>
    b.setAttribute('aria-pressed', String(Number(b.dataset.stage) === stage))
  )
  document.querySelector('#drive-label').textContent = d.name.toUpperCase()
  document.querySelector('#selection-text').textContent =
    `${d.name} is in the drive`
  renderScreen()
  document.querySelector('#announcement').textContent = `${d.name}, version ${
    stage + 1
  }. ${chat[2].replaceAll('✓', '')}`
}
function setStage(n) {
  n = Math.max(0, Math.min(2, n))
  if (n === stage) return
  stage = n
  render()
}
function stageScroll(n) {
  const top = story.getBoundingClientRect().top + scrollY
  const travel = story.offsetHeight -
    document.querySelector('.scene').offsetHeight
  scrollTo({
    top: top + (n / 2) * travel,
    behavior: reduced.matches ? 'instant' : 'smooth',
  })
}
function insertDisk(button) {
  if (reduced.matches || !button.animate) return
  flight?.cancel()
  document.querySelector('.flying-disk')?.remove()
  const from = button.getBoundingClientRect(),
    to = document.querySelector('.drive-slot').getBoundingClientRect()
  if (to.bottom < 0 || to.top > innerHeight) return
  const clone = button.cloneNode(true)
  clone.classList.add('flying-disk')
  clone.removeAttribute('data-app')
  clone.setAttribute('aria-hidden', 'true')
  clone.tabIndex = -1
  Object.assign(clone.style, {
    left: from.left + 'px',
    top: from.top + 'px',
    width: from.width + 'px',
    height: from.height + 'px',
  })
  document.body.append(clone)
  flight = clone.animate([{ transform: 'rotate(-6deg)', opacity: 1 }, {
    transform: `translate(${
      to.left + to.width / 2 - from.left - from.width / 2
    }px,${to.top - from.top - from.height / 2}px) rotateX(65deg) scale(.65)`,
    opacity: 1,
    offset: .72,
  }, {
    transform: `translate(${
      to.left + to.width / 2 - from.left - from.width / 2
    }px,${to.top - from.top - from.height / 2 - 8}px) rotateX(85deg) scale(.3)`,
    opacity: 0,
  }], { duration: 650, easing: 'cubic-bezier(.3,.05,.3,1)' })
  flight.onfinish = () => clone.remove()
  flight.oncancel = () => clone.remove()
  document.querySelector('.drive').classList.add('loading')
  setTimeout(
    () => document.querySelector('.drive').classList.remove('loading'),
    700,
  )
}
document.querySelectorAll('[data-app]').forEach((button) =>
  button.addEventListener('click', () => {
    current = button.dataset.app
    document.querySelectorAll('[data-app]').forEach((b) => {
      b.classList.toggle('selected', b === button)
      b.setAttribute('aria-pressed', String(b === button))
    })
    insertDisk(button)
    clearTimeout(changeTimer)
    screen.classList.add('changing')
    changeTimer = setTimeout(() => {
      render()
      screen.classList.remove('changing')
    }, reduced.matches ? 0 : 180)
  })
)
document.querySelectorAll('[data-stage]').forEach((b) =>
  b.addEventListener('click', () => {
    setStage(Number(b.dataset.stage))
    stageScroll(Number(b.dataset.stage))
  })
)
document.querySelector('.power-button').addEventListener(
  'click',
  () => stageScroll(0),
)
let scheduled = false
function onScroll() {
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(() => {
    scheduled = false
    const travel = story.offsetHeight -
      document.querySelector('.scene').offsetHeight
    const progress = -story.getBoundingClientRect().top / Math.max(1, travel)
    setStage(progress < .3 ? 0 : progress < .68 ? 1 : 2)
  })
}
addEventListener('scroll', onScroll, { passive: true })
addEventListener('resize', onScroll)
onScroll()
