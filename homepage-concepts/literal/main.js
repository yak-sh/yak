const directions = {
  publish: {
    label: 'A · Publish',
    title: 'Your agent built it.<br>Put it online.',
    text:
      'Yaks hosts the websites, mockups, prototypes, and apps you make with your AI assistant. Connect Yaks to your existing assistant. Publish from that conversation, share a link, and keep making changes there.',
    kicker: 'HOSTING FOR WHAT YOUR AGENT CREATES',
  },
  timeline: {
    label: 'B · Walkthrough',
    title: 'From an AI conversation<br>to an app people use.',
    text:
      'Connect Yaks to your existing assistant. Watch it make a shared equipment app, publish it, and change it after people start using it. Yaks provides the hosting, database, and realtime updates.',
    kicker: 'ONE APP, FROM FIRST REQUEST TO EVERYDAY USE',
  },
  bring: {
    label: 'C · Bring your work',
    title: 'Made something in your AI chat?<br>Give it a link.',
    text:
      'A website for your group. A mockup for a client. An app your friends can use. Connect Yaks to the assistant you already use. Publish what you made, send someone the address, and ask that same assistant for changes later.',
    kicker: 'WEBSITES · MOCKUPS · PROTOTYPES · APPS',
  },
}
const variant = directions[document.body.dataset.direction] ||
  directions.publish
const steps = [
  [
    'Ask for an app',
    '“Make a place where our neighbors can reserve shared equipment.”',
    'The assistant builds an interface. Try reserving an item in the example—you don’t need a chat account to use the finished app.',
    'Try the app',
    'try',
  ],
  [
    'Publish and share it',
    '“Put it online so I can send the group a link.”',
    'Yaks hosts what your assistant made and gives it an address. The example link below opens this local demonstration, not a newly deployed site.',
    'Show the example link',
    'publish',
  ],
  [
    'Keep the reservations',
    '“Will the bookings still be here tomorrow?”',
    'Yaks apps can use a built-in online database. This preview demonstrates persistence using your browser: reserve something, then reload the example.',
    'Reload the saved example',
    'reload',
  ],
  [
    'Let people use it together',
    '“Priya needs the speaker on Saturday.”',
    'The product supports realtime updates. Here, a labelled simulated neighbor action changes the same records. Open a second example tab to see browser-local updates across tabs.',
    'Simulate Priya reserving the speaker',
    'neighbor',
  ],
  [
    'Change the app, not the data',
    '“The projector cable gets lost. Add a return checklist to that item.”',
    'Ask the same assistant for the change and publish the update. The projector gains cable, remote, and bag checkboxes; your reservations stay put. This is a specific rule for this group—not another note buried in a chat.',
    'Add the projector’s checklist',
    'checklist',
  ],
  [
    'Ask your agent to use the records',
    '“Have we reserved everything for movie night?”',
    'The scripted demo answer reads the reservations you actually made. Change them and the answer changes. In your app, your connected assistant can read and update its data.',
    'Check our movie-night plan',
    'answer',
  ],
]
document.title = variant.label + ' — yaks.app homepage preview'
document.querySelector('main').innerHTML = `
<section class="hero"><p class="eyebrow">${variant.kicker}</p><h1>${variant.title}</h1><p class="lede">${variant.text}</p><div class="actions"><a class="button" href="https://yaks.app/connect">Connect your assistant <span aria-hidden="true">↗</span></a><a href="#walkthrough">See how it works ↓</a></div><p class="quiet">No new chatbot. Work in your existing assistant; other people just open the link.</p>${
  document.body.dataset.direction === 'bring'
    ? '<div class="formats"><span>A site to visit</span><span>A prototype to try</span><span>An app to share</span></div>'
    : ''
}</section>
<section class="walkthrough" id="walkthrough" aria-labelledby="demo-title"><div class="demo-column"><div class="demo-sticky"><p class="eyebrow">TRY A WORKING EXAMPLE</p><h2 id="demo-title">A borrowing app for one neighborhood.</h2><div class="browser"><div class="browser-bar"><span class="browser-dot" aria-hidden="true"></span><span id="address">Interactive example · local to this browser</span><a href="demo.html" target="_blank" rel="noopener" aria-label="Open example in a separate tab">↗</a></div><iframe src="demo.html" title="Interactive neighborhood equipment-sharing app"></iframe></div><p class="demo-disclosure">Scripted walkthrough, not live AI. Buttons make real local changes. Nothing is published or sent to a server.</p><p class="example-link" hidden>Example link: <a href="demo.html" target="_blank" rel="noopener">open the borrowing app ↗</a></p><p id="progress" class="progress" aria-live="polite"></p></div></div><div class="steps">${
  steps.map(([title, quote, text, button, action], i) =>
    `<article class="step" id="step-${i}" data-step="${i}"><span class="step-num">0${
      i + 1
    }</span><h3>${title}</h3><blockquote>${quote}</blockquote><p>${text}</p><button class="step-action" data-action="${action}">${button}<span aria-hidden="true"> →</span></button><a class="mobile-demo-link" href="#demo-title">View the updated example ↑</a></article>`
  ).join('')
}</div></section>
<section class="existing-context"><p class="eyebrow">KEEP THE ASSISTANT YOU ALREADY WORK WITH</p><h2>Start with what you’ve already worked out.</h2><p>The useful starting point might already be in your conversation: recipes you’ve collected, plans for your group, or a prototype you’ve been refining. Connect Yaks, then ask your assistant to turn the material it can access into something you can use and share.</p><p class="quiet">Yaks doesn’t automatically read your chat history. Your assistant chooses what to send when you ask it to build or update an app.</p></section><section class="capabilities"><p class="eyebrow">MORE THAN A PLACE TO PUT THE FILES</p><h2>Start with a page.<br>Build an app when you need one.</h2><div class="three"><article><span class="feature-number">01</span><h3>Hosting and sharing</h3><p>Publish a website, mockup, prototype, or app from your assistant. Share its address with people who don’t use that assistant.</p></article><article><span class="feature-number">02</span><h3>Data that stays</h3><p>A built-in database lets the app remember reservations, records, and changes after the conversation ends.</p></article><article><span class="feature-number">03</span><h3>People working together</h3><p>Realtime updates keep a shared app useful as people use it. Your agent can change the interface and work with its data.</p></article></div></section>
<section class="gallery" aria-labelledby="gallery-title"><div><p class="eyebrow">WHAT WILL PEOPLE ACTUALLY MAKE?</p><h2 id="gallery-title">We want to show your version.</h2><p>The most useful examples will come from people solving their own problems—not from us imagining another to-do list.</p><p>Already made something on Yaks? Send a link and tell us who uses it, what they do there, and what didn’t fit before. We’ll ask before featuring it.</p><a class="button secondary" href="mailto:hello@yaks.app?subject=Something%20I%20made%20on%20Yaks">Email your app for consideration ↗</a></div><aside class="gallery-note"><span class="eyebrow">REAL-USER GALLERY · INVITATION</span><h3>A link. A person.<br>A reason it exists.</h3><p>No sample cards are presented as customer work. This section is a place to invite the first submissions, not a claim that a gallery is already here.</p></aside></section>
<section class="ideas"><div><p class="eyebrow">NOT SURE WHAT TO MAKE?</p><h2>Start with your life,<br>not an app category.</h2><p>Your assistant can help you find an idea. Look for something you’ll return to, share with someone, or keep changing.</p></div><div><label for="idea-prompt">A prompt to try with your assistant</label><textarea id="idea-prompt" rows="5" readonly>Help me find something useful to make on Yaks. Ask me about the people I coordinate with, information we keep losing, and routines that don't fit our current tools. Suggest three small apps worth using outside this chat. Explain who would use each one and why it needs a shared, persistent interface. Ask one question at a time.</textarea><button id="copy-prompt">Copy this prompt</button><span id="copy-status" role="status"></span></div></section>
<section class="closing"><h2>Make it with your assistant.<br>Put it on Yaks.</h2><a class="button" href="https://yaks.app/connect">Connect your assistant ↗</a><a class="closing-link" href="https://yaks.app/pricing">See pricing</a></section>`
const frame = document.querySelector('iframe')
function send(action) {
  frame.contentWindow.postMessage(
    { type: 'yaks-demo-action', action },
    location.origin,
  )
}
document.querySelectorAll('[data-action]').forEach((button) =>
  button.addEventListener('click', () => {
    const action = button.dataset.action
    if (action === 'try') {
      frame.focus()
      return
    }
    if (action === 'reload') {
      frame.contentWindow.location.reload()
      return
    }
    send(action)
    document.querySelectorAll('.step').forEach((s) =>
      s.classList.toggle('active', s.contains(button))
    )
  })
)
globalThis.addEventListener('message', (event) => {
  if (
    event.source !== frame.contentWindow || event.origin !== location.origin ||
    event.data?.type !== 'yaks-demo-state'
  ) return
  document.querySelector('.example-link').hidden = !event.data.published
  document.querySelector('#address').textContent = event.data.published
    ? 'demo.html · local example link'
    : 'Interactive example · local to this browser'
  document.querySelector('#progress').textContent =
    `${event.data.reservations} reservations saved${
      event.data.checklist ? ' · Projector checklist added' : ''
    }`
})
document.querySelector('#copy-prompt').addEventListener('click', async () => {
  const text = document.querySelector('#idea-prompt')
  try {
    await navigator.clipboard.writeText(text.value)
    document.querySelector('#copy-status').textContent = 'Copied.'
  } catch {
    text.focus()
    text.select()
    document.querySelector('#copy-status').textContent =
      'Select and copy the prompt above.'
  }
})
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        document.querySelectorAll('.step').forEach((s) =>
          s.classList.toggle('reading', s === entry.target)
        )
      }
    }
  }, { rootMargin: '-25% 0px -45% 0px' })
  document.querySelectorAll('.step').forEach((step) => observer.observe(step))
}
