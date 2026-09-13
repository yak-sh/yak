// Start a local HTTP server for this directory and Chrome with
// --remote-debugging-port=9238 --user-data-dir=<temporary directory>.
// Run: node browser-test.mjs (PORT, CDP_PORT, SCREENSHOT_DIR are optional).
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
const base = `http://localhost:${process.env.PORT || 4178}`
const targets = await (await fetch(
  `http://localhost:${process.env.CDP_PORT || 9238}/json/list`,
)).json()
const ws = new WebSocket(
  targets.find((p) => p.type === 'page').webSocketDebuggerUrl,
)
await new Promise((resolve) =>
  ws.addEventListener('open', resolve, { once: true })
)
let id = 0
const pending = new Map()
const exceptions = []
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data)
  if (m.method === 'Runtime.exceptionThrown') {
    exceptions.push(m.params.exceptionDetails.text)
  }
  if (m.id) {
    const p = pending.get(m.id)
    pending.delete(m.id)
    m.error ? p.reject(m.error) : p.resolve(m.result)
  }
}
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = ++id
    pending.set(n, { resolve, reject })
    ws.send(JSON.stringify({ id: n, method, params }))
  })
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
  return r.result?.value
}
const until = async (expression) => {
  const end = Date.now() + 8000
  while (!(await evaluate(expression))) {
    if (Date.now() > end) throw new Error('Timed out: ' + expression)
    await new Promise((r) => setTimeout(r, 30))
  }
}
const frame = `(document.querySelector('iframe')?.contentDocument)`
const screen = async (name) => {
  const directory = process.env.SCREENSHOT_DIR || '/tmp/yaks-literal-shots'
  await fs.mkdir(directory, { recursive: true })
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  await fs.writeFile(
    `${directory}/${name}.png`,
    Buffer.from(shot.data, 'base64'),
  )
}
await send('Runtime.enable')
await send('Page.enable')
try {
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false,
  })
  for (const direction of ['publish', 'timeline', 'bring']) {
    await send('Page.navigate', { url: `${base}/${direction}.html` })
    await until(
      `document.body.dataset.direction==='${direction}' && document.querySelectorAll('.step').length===6 && ${frame}?.querySelector('#items article')`,
    )
    assert.equal(
      await evaluate('document.documentElement.scrollWidth <= innerWidth'),
      true,
    )
    assert.equal(
      await evaluate(
        'document.querySelectorAll(\'a[href="https://yaks.app/connect"]\').length >= 2',
      ),
      true,
    )
    await screen(direction)
  }
  await send('Page.navigate', { url: `${base}/timeline.html` })
  await until(`${frame}?.querySelector('#reset')`)
  await evaluate(`${frame}.querySelector('#reset').click()`)
  await evaluate(
    `${frame}.querySelector('[name=person]').value='<img src=x onerror=alert(1)>'; ${frame}.querySelector('#booking').requestSubmit()`,
  )
  await until(
    `${frame}.querySelector('.reserved')?.textContent.includes('<img')`,
  )
  assert.equal(await evaluate(`${frame}.querySelectorAll('img').length`), 0)
  await evaluate(`${frame}.querySelector('#booking').requestSubmit()`)
  assert.equal(
    await evaluate(`${frame}.querySelectorAll('.reserved').length`),
    1,
  )
  await evaluate(
    `new Promise(resolve => { document.querySelector('iframe').addEventListener('load', resolve, {once:true}); document.querySelector('[data-action=reload]').click() })`,
  )
  await until(`${frame}?.querySelectorAll('.reserved').length===1`)
  for (const action of ['publish', 'neighbor', 'checklist', 'answer']) {
    await evaluate(`document.querySelector('[data-action=${action}]').click()`)
    await until(
      action === 'publish'
        ? `!document.querySelector('.example-link').hidden`
        : action === 'neighbor'
        ? `${frame}.querySelectorAll('.reserved').length===2`
        : action === 'checklist'
        ? `${frame}.querySelectorAll('.return-checklist input').length===3`
        : `!${frame}.querySelector('#answer').hidden`,
    )
  }
  assert.equal(
    await evaluate(`${frame}.querySelectorAll('.reserved').length`),
    2,
  )
  assert.equal(
    await evaluate(
      `${frame}.querySelector('#answer-text').textContent.includes('outdoor screen')`,
    ),
    true,
  )
  await evaluate(
    `${frame}.querySelector('[name=item]').value='screen'; ${frame}.querySelector('[name=person]').value='Mo'; ${frame}.querySelector('#booking').requestSubmit()`,
  )
  await until(
    `${frame}.querySelector('#answer-text').textContent.startsWith('All three')`,
  )
  await evaluate(`${frame}.querySelector('.return-checklist input').click()`)
  await evaluate(
    `new Promise(resolve => { document.querySelector('iframe').addEventListener('load', resolve, {once:true}); document.querySelector('[data-action=reload]').click() })`,
  )
  await until(`${frame}?.querySelector('.return-checklist input')?.checked`)
  // A second same-origin browsing context changes records through storage events.
  await evaluate(
    `window.secondFrame=document.createElement('iframe'); secondFrame.src='demo.html'; secondFrame.title='Test second user'; document.body.append(secondFrame)`,
  )
  await until(
    'secondFrame.contentDocument?.querySelectorAll(".reserved").length===3',
  )
  await evaluate('secondFrame.contentDocument.querySelector("#reset").click()')
  await until(`${frame}.querySelectorAll('.reserved').length===0`)
  await evaluate(
    'secondFrame.remove(); document.querySelector("#walkthrough").scrollIntoView()',
  )
  await screen('walkthrough')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  })
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  await evaluate('window.scrollTo(0,0)')
  assert.equal(
    await evaluate('document.documentElement.scrollWidth <= innerWidth'),
    true,
  )
  assert.equal(
    await evaluate(
      'getComputedStyle(document.querySelector(".demo-sticky")).position',
    ),
    'static',
  )
  assert.equal(
    await evaluate(
      'getComputedStyle(document.querySelector(".step-num")).transitionDuration',
    ),
    '0s',
  )
  assert.equal(
    await evaluate(
      `${frame}.documentElement.scrollWidth<=document.querySelector('iframe').clientWidth`,
    ),
    true,
  )
  await screen('mobile')
  assert.deepEqual(exceptions, [])
  console.log(
    'PASS: 3 directions; reservations, duplicate prevention, persistence, safe text, checklist, computed answer, cross-context sync, mobile, reduced motion; screenshots saved.',
  )
} finally {
  ws.close()
}
