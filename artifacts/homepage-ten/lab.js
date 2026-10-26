let inFrame = globalThis.self !== globalThis.top
let preview = new URLSearchParams(location.search).has('preview')
if (preview) {
  let quiet = document.createElement('style')
  quiet.textContent =
    '*,*::before,*::after{animation-play-state:paused!important;transition:none!important}html{scroll-behavior:auto!important}'
  document.head.append(quiet)
}
if (!inFrame) {
  let names = [
    'Paper Garden',
    'Mission Control',
    'Type Foundry',
    'Pocket Desktop',
    'Blueprints',
    'Cabinet of Curiosities',
    'Frequency',
    'Field Notes',
    'Toy Factory',
    'Portal',
  ]
  let ids = [
    '01-garden',
    '02-orbit',
    '03-type',
    '04-desktop',
    '05-blueprint',
    '06-cabinet',
    '07-frequency',
    '08-fieldnotes',
    '09-factory',
    '10-portal',
  ]
  let file = location.pathname.split('/').pop().replace(/\.html$/, '')
  let index = Math.max(0, ids.indexOf(file))
  let host = document.createElement('div')
  host.style.cssText =
    'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:2147483640;width:max-content;max-width:calc(100vw - 20px)'
  let shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML =
    `<style>*{box-sizing:border-box}nav{display:flex;gap:5px;align-items:center;background:#f7f4ec;color:#25251f;border:1px solid #25251f24;border-radius:40px;padding:7px;box-shadow:0 5px 28px #0003;font:12px Arial,sans-serif}a,select{color:inherit;text-decoration:none;border:0;background:none;font:inherit;padding:9px 10px;border-radius:22px}a:hover{background:#e7e2d8}a:focus-visible,select:focus-visible{outline:2px solid #c94c2c}select{max-width:185px;cursor:pointer}a:first-of-type{background:#25251f;color:#f7f4ec}a[aria-label]{font-size:17px;padding:5px 10px}@media(max-width:440px){select{max-width:145px}a,select{padding:8px;font-size:11px}}</style><nav aria-label="Design study navigation"><a href="./">All ten ↗</a><a href="${
      ids[(index + 9) % 10]
    }.html" aria-label="Previous design">←</a><select aria-label="Choose a homepage design">${
      names.map((name, i) =>
        `<option value="${ids[i]}" ${i === index ? 'selected' : ''}>${
          String(i + 1).padStart(2, '0')
        } / ${name}</option>`
      ).join('')
    }</select><a href="${
      ids[(index + 1) % 10]
    }.html" aria-label="Next design">→</a></nav>`
  shadow.querySelector('select').addEventListener('change', (event) => {
    location.href = `${event.target.value}.html`
  })
  document.body.append(host)
  document.body.style.paddingBottom = '90px'
}
