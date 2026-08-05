// The badge: how many things in the graph already say something about
// the page in front of you. It is the whole reason to look at the
// toolbar — a page you have filed before should never be filed twice
// without knowing it.
//
// Read-only, and quiet about failure: the server is a box on the desk,
// so it is often simply not running. No badge is the honest answer to
// that; an error mark on every tab would be noise about our own plumbing.
import { refs } from './tasks.js'

let paint = async (tabId, url) => {
  let text = ''
  if (/^https?:/.test(url ?? '')) {
    try {
      let found = await refs(url)
      text = found.length ? String(found.length) : ''
    } catch {
      text = ''
    }
  }
  try {
    await chrome.action.setBadgeText({ tabId, text })
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#3d484d' })
  } catch { /* the tab closed while we were asking */ }
}

let look = async (tabId) => {
  try {
    let tab = await chrome.tabs.get(tabId)
    await paint(tabId, tab.url)
  } catch { /* gone */ }
}

chrome.tabs.onActivated.addListener(({ tabId }) => look(tabId))
chrome.tabs.onUpdated.addListener((tabId, change) => {
  // The url is what the badge counts, so re-ask when it changes and once
  // more when the tab settles (a client-side route can move it after).
  if (change.url || change.status == 'complete') look(tabId)
})
// A filing is the one write that changes the answer; the popup says so.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.filed) look(msg.filed)
})
