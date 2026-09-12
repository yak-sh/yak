// Run against an isolated Chrome with --remote-debugging-port=9338.
import fs from 'node:fs'
import assert from 'node:assert/strict'
const pages = await (await fetch('http://127.0.0.1:9338/json')).json()
const ws = new WebSocket(pages[0].webSocketDebuggerUrl)
await new Promise((r) => ws.onopen = r)
let seq = 0
const waiting = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  waiting.get(m.id)?.(m.result)
}
function send(method, params = {}) {
  return new Promise((r) => {
    const id = ++seq
    waiting.set(id, r)
    ws.send(JSON.stringify({ id, method, params }))
  })
}
async function evals(expression) {
  return (await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })).result?.value
}
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
})
await send('Page.navigate', {
  url: 'http://127.0.0.1:4187/homepage-concepts/crt/',
})
await new Promise((r) => setTimeout(r, 1500))
await evals('document.fonts.ready')
assert.deepEqual(
  await evals(
    '({stage:document.querySelector("#page-number").textContent, recipes:document.querySelectorAll(".recipe-card").length, overflow:document.documentElement.scrollWidth>innerWidth})',
  ),
  { stage: '01 / 03', recipes: 3, overflow: false },
)
await send('Page.captureScreenshot', {
  format: 'png',
  captureBeyondViewport: false,
}).then((r) =>
  fs.writeFileSync('/tmp/crt-hero.png', Buffer.from(r.data, 'base64'))
)
await evals(
  'window.scrollTo({top:document.querySelector(".story").offsetTop,behavior:"instant"})',
)
await new Promise((r) => setTimeout(r, 250))
await send('Page.captureScreenshot', { format: 'png' }).then((r) =>
  fs.writeFileSync('/tmp/crt-v1.png', Buffer.from(r.data, 'base64'))
)
await evals(
  'window.scrollTo({top:document.querySelector(".story").offsetTop+(document.querySelector(".story").offsetHeight-document.querySelector(".scene").offsetHeight)*.85,behavior:"instant"})',
)
await new Promise((r) => setTimeout(r, 250))
assert.deepEqual(
  await evals(
    '({stage:document.querySelector("#page-number").textContent,deleted:document.querySelectorAll("[data-versions=recipes] del").length,checks:document.querySelectorAll(".shopping-list input").length})',
  ),
  { stage: '03 / 03', deleted: 2, checks: 5 },
)
await send('Page.captureScreenshot', { format: 'png' }).then((r) =>
  fs.writeFileSync('/tmp/crt-v3.png', Buffer.from(r.data, 'base64'))
)
await evals('document.querySelector("[data-app=garden]").click()')
await new Promise((r) => setTimeout(r, 800))
assert.deepEqual(
  await evals(
    '({brand:document.querySelector(".app-brand").textContent,flight:document.querySelectorAll(".flying-disk").length})',
  ),
  { brand: 'Out in the garden', flight: 0 },
)
await send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 1,
  mobile: true,
})
await evals(
  'document.querySelector("[data-app=recipes]").click();window.scrollTo({top:document.querySelector(".story").offsetTop,behavior:"instant"})',
)
await new Promise((r) => setTimeout(r, 800))
assert.deepEqual(
  await evals(
    '({overflow:document.documentElement.scrollWidth>innerWidth,stage:document.querySelector("#page-number").textContent})',
  ),
  { overflow: false, stage: '01 / 03' },
)
await send('Page.captureScreenshot', { format: 'png' }).then((r) =>
  fs.writeFileSync('/tmp/crt-mobile.png', Buffer.from(r.data, 'base64'))
)
ws.close()
console.log(
  'PASS: initial recipe, scroll V3, crossed-out labels, disk switch, animation cleanup, mobile width',
)
