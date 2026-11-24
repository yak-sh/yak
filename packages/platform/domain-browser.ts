// The search fragment comes from the signed-in Domains page. Cancel stale
// reads before replacing results, and let checkout leave only when it has a URL.
export let domainBrowser = `
let form = document.querySelector('[data-domain-search]');
if (form) {
  let field = form.elements.q;
  let results = document.querySelector('[data-domain-results]');
  let note = document.querySelector('[data-search-status]');
  let timer;
  let pending;
  let say = (box, text, problem = false) => {
    box.textContent = text;
    box.hidden = !text;
    box.classList.toggle('Notice-negative', problem);
  };
  let find = async () => {
    let q = field.value.trim();
    results.replaceChildren();
    if (!q) return say(note, '');
    say(note, 'Searching…');
    let current = pending = new AbortController();
    let url = new URL(form.action);
    url.searchParams.set('search', q);
    try {
      let r = await fetch(url, { signal: AbortSignal.any([signal, current.signal]) });
      if (!r.ok || r.redirected) throw new Error('Search failed');
      let html = await r.text();
      if (current.signal.aborted || signal.aborted) return;
      results.innerHTML = html;
      let count = results.querySelectorAll('[data-available]').length;
      say(note, count ? (count == 1 ? '1 domain available.' : count + ' domains available.') : '');
    } catch (e) {
      if (!current.signal.aborted && !signal.aborted) {
        say(note, 'Search could not load. Try again.', true);
      }
    }
  };
  let reset = () => {
    clearTimeout(timer);
    pending?.abort();
  };
  field.addEventListener('input', () => {
    reset();
    results.replaceChildren();
    say(note, field.value.trim() ? 'Searching…' : '');
    timer = setTimeout(find, 325);
  }, { signal });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    reset();
    void find();
  }, { signal });
  signal.addEventListener('abort', reset, { once: true });

  document.addEventListener('submit', async (e) => {
    let form = e.target;
    let buying = form.matches('[data-domain-buy]');
    let transfer = form.matches('[data-domain-transfer]');
    if (!buying && !transfer && !form.matches('[data-domain-target]')) return;
    e.preventDefault();
    let data = new FormData(form);
    let button = form.querySelector('button[type="submit"]');
    let box = buying ? note : form.querySelector('[data-domain-message]');
    button.disabled = true;
    say(box, buying ? 'Opening checkout…' : transfer ? 'Offering…' : 'Saving…');
    try {
      let r = await fetch(form.action, {
        method: 'POST', body: data, headers: { accept: 'application/json' }, signal,
      });
      let out = await r.json();
      if (!r.ok) {
        say(box, out.error?.message ?? out.say ?? 'That did not go through. Try again.', true);
        return;
      }
      if (buying) return location.assign(out.url);
      if (transfer) return say(box, out.say);
      let row = form.closest('[data-owned-domain]');
      row.outerHTML = out.row;
      let saved = document.getElementById(data.get('point_domain'));
      say(saved.querySelector('[data-domain-message]'), 'Saved.');
      saved.querySelector('button[type="submit"]').focus();
    } catch (e) {
      if (!signal.aborted) say(box, 'That did not go through. Try again.', true);
    } finally {
      button.disabled = false;
    }
  }, { signal });
}
`
