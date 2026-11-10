let list = document.querySelector('#gallery')
let response = await fetch('./studio/gallery')
if (!response.ok) throw new Error('The gallery could not be read.')
let pages = await response.json()
for (let page of pages) {
  let card = document.createElement('li'),
    image = document.createElement('img'),
    caption = document.createElement('p')
  card.className = 'Panel'
  image.className = 'Page_Image'
  image.src = './studio/gallery_file?id=' + encodeURIComponent(page.id)
  image.alt = page.caption || 'A shared coloring page'
  caption.textContent = page.caption
  card.append(image, caption)
  list.append(card)
}
if (!pages.length) list.textContent = 'No shared pages have been published yet.'
