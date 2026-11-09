// One block opened: the change it holds said in words, what it had seen, its
// ops one per line, and how its log vouches for it.
import { describe, op } from './describe.js'
import { short } from './view.js'

let esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

let chip = ({ name, color }, words) =>
  `<span class="Chip" style="--c:${color}"><i class="Chip_dot"></i>${
    esc(name)
  } ${esc(words)}</span>`

/**
 * The HTML of a block's card. `looks` maps an actor to its {name, color},
 * `status` is what the log check said of it (ok, or held while unshared), and
 * `leaf` its leaf hash, in hex.
 */
export let detail = ({ block, looks, status, leaf }) => {
  let c = block.change, me = looks(c.actor)
  let deps = Object.entries(c.deps ?? {})
  let ops = c.ops ?? []
  let first = (name) => name.split(' ')[0]
  let shown = ops.slice(0, 60).map((o) => {
    let [action, what] = op(o, (a) => first(looks(a).name))
    return `<li class="Detail_op"><span class="Op Op-${esc(action)}">${
      esc(action)
    }</span>${esc(what)}</li>`
  }).join('')
  return `<header class="Detail_head" style="--c:${me.color}">
      <i class="Detail_dot"></i><div class="Detail_writer"><b>${
    esc(me.name)
  }</b><span class="Detail_meta">block ${block.index} · change ${c.seq}</span></div>
      <button class="Detail_close" aria-label="Close">×</button>
    </header>
    <p class="Detail_what">${esc(describe(c))}</p>
    <h4 class="Detail_heading">Had seen</h4>
    <p class="Detail_deps">${
    [
      ...deps.map(([a, s]) => chip(looks(a), `block ${s - 1}`)),
      c.seq > 1
        ? chip(me, `block ${c.seq - 2}`) +
          '<small class="Detail_note">its own last block, implied</small>'
        : '',
    ].join('') ||
    '<small class="Detail_note">Nothing: it is the first change anyone made.</small>'
  }</p>
    <h4 class="Detail_heading">${ops.length} op${
    ops.length == 1 ? '' : 's'
  }</h4>
    <ol class="Detail_ops">${shown}${
    ops.length > 60
      ? `<li class="Detail_more Detail_op">and ${ops.length - 60} more</li>`
      : ''
  }</ol>
    <h4 class="Detail_heading">In the hypercore</h4>
    <dl class="Detail_proof">
      <dt class="Detail_term">log</dt><dd class="Detail_value"><code title="${
    esc(c.actor)
  }">${esc(short(c.actor))}…</code> ${esc(me.name)}’s public key</dd>
      <dt class="Detail_term">leaf</dt><dd class="Detail_value"><code>${
    esc(leaf.slice(0, 16))
  }…</code> BLAKE2b of the block’s bytes</dd>
      <dt class="Detail_term">signature</dt><dd class="Detail_value">${
    status == 'held'
      ? 'Not shared yet: the block waits in this browser.'
      : status == 'ok'
      ? `<span class="Ok">✓ verified</span> with ${esc(first(me.name))}’s key`
      : `<span class="Bad">✗ ${esc(status)}</span>: this block is refused`
  }</dd>
      <dt class="Detail_term">block id</dt><dd class="Detail_value"><code title="${
    esc(block.eid)
  }">${esc(block.eid.slice(0, 16))}…</code> SHA-256 of its bytes</dd>
    </dl>
    <details class="Detail_raw"><summary class="Detail_summary">The change as stored</summary><pre class="Detail_code">${
    esc(JSON.stringify(c, null, 2))
  }</pre></details>`
}
