// The platform serves this module beside the page, not inside the repository.
const { apply, drafts, me, subscribe, was } = await import(
  new URL('./api/client.js', import.meta.url).href
)
import { bindDurations, durationHTML } from './cooking-inputs.js'
import {
  cookingIngredients,
  formatSeconds,
  ownsSession,
  refId,
  snapshotSession,
  timerChange,
  timerRemaining,
  validSeconds,
} from './cooking-model.js'

// Integration: include cooking.css; render cookingHTML(rows, who, localRecipes)
// in a persistent container, then wireCooking(rows, who, fail, container, localRecipes).
// watchCooking(render, fail, who) returns an unsubscribe function and gives render
// whole snapshot rows. The third HTML argument enables the multi-recipe picker;
// alternatively the parent may call startCooking(selectedLocalRecipes).
// me()'s envelope contains person (not eid), writes, and signIn.
const escape = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[c])
const personId = (who) => typeof who === 'string' ? who : who?.person
const own = (session, who) => ownsSession(session, personId(who))
const writable = (who) => !!personId(who) && who?.writes !== false
const cleanups = new WeakMap()
const draftDesks = new WeakMap()
let lastError = ''
const pending = new Set()
// A receipt bridges a delayed subscription; picks themselves live in the store.
const pickReceipts = new Map()
const pickListeners = new Set()
function pickRows(rows, who) {
  const held = new Map(
    rows.filter((r) => r.cook_pick && refId(r.edge?.from) === personId(who))
      .map((
        r,
      ) => [r.edge.to, r]),
  )
  for (const [recipe, receipt] of pickReceipts) {
    if (receipt.by !== personId(who)) continue
    if (receipt.row) held.set(recipe, receipt.row)
    else held.delete(recipe)
  }
  return [...held.values()]
}

function signInHTML(who) {
  // Sign-in is a platform URL; do not turn arbitrary schemes into links.
  const href = who?.signIn
  const link =
    typeof href === 'string' && /^(?:https?:\/\/|\/(?!\/)|\.\/)/.test(href)
      ? `<a href="${escape(href)}">Sign in</a>`
      : 'Sign in'
  return `<p class="cook-sign-in">${link} to keep your own cooking sessions across devices.</p>`
}

function showError(error, fail, root) {
  lastError = error?.message ?? String(error)
  const scope = root ?? document
  for (const box of scope.querySelectorAll('[data-cook-error]')) {
    box.textContent = lastError
    box.hidden = false
  }
  if (fail) fail(error)
  else globalThis.reportError(error)
}

/** Start a durable, atomic snapshot. No recipe source rows are changed. */
export async function startCooking(recipes) {
  const who = await me()
  if (!personId(who)) {
    throw Object.assign(
      new Error('Sign in to create your own cross-device cooking session.'),
      { signIn: who?.signIn },
    )
  }
  if (!writable(who)) {
    throw new Error(
      'You do not have permission to save cooking sessions in this recipe box.',
    )
  }
  const { eid, bundles } = snapshotSession(recipes)
  await apply(bundles)
  return eid
}

/** Subscribe only; neither the visual clock nor a render ever reads the store. */
export function watchCooking(render, fail, who) {
  const parts = [[], [], [], []]
  const stops = []
  let active = true
  const emit = () => {
    if (!active) return
    const activeInput = document.activeElement
    const duration = activeInput?.dataset?.cookDraft
    const caret = duration
      ? [activeInput.selectionStart, activeInput.selectionEnd]
      : null
    const picker = activeInput?.name === 'cook-recipe'
      ? activeInput.value
      : null
    try {
      render(parts.flat())
      const selector = duration
        ? `[data-cook-draft="${CSS.escape(duration)}"]`
        : picker
        ? `[name="cook-recipe"][value="${CSS.escape(picker)}"]`
        : null
      if (selector) {
        const replacement = document.querySelector(selector)
        replacement?.focus({ preventScroll: true })
        if (caret && replacement) replacement.setSelectionRange(...caret)
      }
    } catch (error) {
      showError(error, fail)
    }
  }
  const receipt = () => emit()
  const onError = (event) => {
    const error = event.error ?? event.reason
    if (!error) return
    lastError = error.message ?? String(error)
    for (const box of document.querySelectorAll('[data-cook-error]')) {
      box.textContent = lastError
      box.hidden = false
    }
    if (fail) fail(error)
  }
  globalThis.addEventListener('error', onError)
  globalThis.addEventListener('unhandledrejection', onError)
  pickListeners.add(receipt)
  const connect = async () => {
    try {
      who ??= await me()
      if (!active) return
      if (!personId(who)) return emit()
      const by = personId(who)
      // Ownership UX only, not a substitute for server row permissions.
      stops.push(subscribe(`.cook_pick&.edge.from=${by}`, (rows) => {
        parts[3] = rows
        for (const [recipe, receipt] of pickReceipts) {
          if (receipt.by !== by) continue
          const found = rows.find((r) => r.edge.to === recipe)
          if ((receipt.row && found) || (!receipt.row && !found)) {
            pickReceipts.delete(recipe)
          }
        }
        emit()
      }))
      // App data is shared. Ownership filters what this person sees, not who
      // may read it at the store door. Constant queries keep history within the
      // platform's aggregate live-query budget without discarding sessions.
      stops.push(
        subscribe(`.cooking&.created.by=${by}&?doc&?completed`, (rows) => {
          parts[0] = rows
          emit()
        }),
      )
      stops.push(subscribe('.cook_recipe', (rows) => {
        parts[1] = rows
        emit()
      }))
      stops.push(subscribe('.cook_step&?doc&?timer&?completed', (rows) => {
        parts[2] = rows
        emit()
      }))
    } catch (error) {
      showError(error, fail)
    }
  }
  void connect()
  return () => {
    active = false
    stops.forEach((stop) => stop())
    pickListeners.delete(receipt)
    globalThis.removeEventListener('error', onError)
    globalThis.removeEventListener('unhandledrejection', onError)
  }
}

export function cookingHTML(rows, who, recipes = []) {
  const sessions = rows.filter((r) => r.cooking && own(r, who)).sort((a, b) =>
    String(b.created?.at ?? '').localeCompare(String(a.created?.at ?? '')) ||
    a.entity.eid.localeCompare(b.entity.eid)
  )
  let html =
    `<section class="cooking" aria-label="Live cooking"><header><h2>Cook together</h2>
    <p>Choose recipes, then work through their interleaved steps. Timers and progress follow you across devices.</p><p>Each timer uses the first duration written in its step (the upper end of a range). Check it before starting; use the duration buttons or enter custom seconds to adjust it. This page must be open to show an elapsed timer.</p></header>
    <p class="cook-error" role="alert" data-cook-error ${
      lastError ? '' : 'hidden'
    }>${escape(lastError)}</p>`
  if (!personId(who)) return html + signInHTML(who) + '</section>'
  if (who?.writes === false) {
    html +=
      '<p>This recipe box is read-only. Your saved sessions are shown below.</p>'
  }
  if (recipes.length) {
    html += `<form data-cook-picker><fieldset ${
      writable(who) ? '' : 'disabled'
    }><legend>What are we making?</legend>`
    for (const recipe of recipes) {
      html +=
        `<label class="cook-choice"><input type="checkbox" name="cook-recipe" value="${
          escape(recipe.eid)
        }" ${
          pickRows(rows, who).some((r) => r.edge.to === recipe.eid)
            ? 'checked'
            : ''
        }> ${escape(recipe.title)}</label>`
    }
    html +=
      '<button type="submit">Start cooking selected recipes</button></fieldset></form>'
  }
  if (!sessions.length) {
    html +=
      '<p>No cooking sessions yet. Start one from your selected recipes.</p>'
  }
  for (const session of sessions) {
    const eid = session.entity.eid
    const recipeRows = rows.filter((r) => r.cook_recipe?.session === eid)
    const steps = rows.filter((r) => r.cook_step?.session === eid).sort((
      a,
      b,
    ) => a.cook_step.ord - b.cook_step.ord)
    const count = steps.filter((r) => r.completed).length
    const locked = session.completed || !writable(who)
    html += `<article class="cook-session ${
      session.completed ? 'is-complete' : ''
    }" data-cook-session="${escape(eid)}">
      <header><h3>${escape(session.doc?.title ?? 'Cooking session')}</h3>
      <p>${count} / ${steps.length} steps complete${
      session.created?.at
        ? ` · Started <time>${
          escape(new Date(session.created.at).toLocaleString())
        }</time>`
        : ''
    }</p>
      <button type="button" data-cook-action="session" data-id="${
      escape(eid)
    }" ${
      !writable(who) ||
        (!session.completed && (!steps.length || count !== steps.length))
        ? 'disabled'
        : ''
    }>${
      session.completed ? 'Reopen session' : 'Finish session'
    }</button></header>
      <details><summary>Ingredients · interleaved by recipe</summary><ul class="cook-ingredients">`
    for (const ingredient of cookingIngredients(recipeRows)) {
      html += `<li><span class="cook-recipe-name">${
        escape(ingredient.title)
      }</span> ${escape(ingredient.text)}</li>`
    }
    html += '</ul></details><ol class="cook-steps">'
    for (const step of steps) {
      const id = step.entity.eid
      const recipe = recipeRows.find((r) =>
        r.entity.eid === step.cook_step.recipe
      )
      const timer = step.timer
      const remaining = timer ? timerRemaining(timer) : step.cook_step.seconds
      const done = !!step.completed
      const timerName = step.doc?.title ??
        `${recipe?.cook_recipe.title ?? 'Recipe'} · Step ${
          step.cook_step.ord + 1
        }`
      html += `<li class="cook-step ${
        done ? 'is-complete' : ''
      }"><label class="cook-step-check">
        <input type="checkbox" data-cook-action="complete" data-id="${
        escape(id)
      }" ${done ? 'checked' : ''} ${locked ? 'disabled' : ''}>
        <span><span class="cook-recipe-name">${
        escape(recipe?.cook_recipe.title ?? 'Recipe snapshot')
      }</span> ${escape(step.cook_step.text)}</span></label>
        <div class="cook-timer" aria-label="${
        escape(timerName)
      }"><span class="cook-timer-name">${escape(timerName)}</span>`
      if (remaining != null) {
        html += `<output class="cook-clock" data-cook-clock ${
          timer?.due ? `data-due="${escape(timer.due)}"` : ''
        }>${formatSeconds(remaining)}${
          timer?.due && remaining === 0
            ? ' · Time’s up'
            : timer?.remaining != null
            ? ' · Paused'
            : ''
        }</output>`
        html += `<button type="button" data-cook-action="${
          timer?.due ? 'pause' : 'start'
        }" data-id="${escape(id)}" ${locked || done ? 'disabled' : ''}>${
          timer?.due ? 'Pause' : timer?.remaining > 0 ? 'Resume' : 'Start'
        }</button>
          <button type="button" data-cook-action="reset" data-id="${
          escape(id)
        }" ${locked || done ? 'disabled' : ''}>Reset</button>`
      }
      html += '<div class="cook-seconds"><span>Set duration:</span>'
      for (const seconds of [30, 60, 300, 600, 1800, 3600]) {
        html += `<button type="button" data-cook-action="duration" data-id="${
          escape(id)
        }" data-seconds="${seconds}" ${locked || done ? 'disabled' : ''}>${
          formatSeconds(seconds)
        }</button>`
      }
      for (const delta of [-60, -10, 10, 60]) {
        html += `<button type="button" data-cook-action="adjust" data-id="${
          escape(id)
        }" data-delta="${delta}" ${locked || done ? 'disabled' : ''}>${
          delta > 0 ? '+' : ''
        }${delta}s</button>`
      }
      html += `</div>${durationHTML(id, locked || done)}</div></li>`
    }
    html += '</ol></article>'
  }
  return html + '</section>'
}

// Optimistic guards prevent a stale device pausing/resuming a newer timer.
async function timerGuard(row) {
  return {
    timer: {
      due: await was(row.timer?.due),
      remaining: await was(row.timer?.remaining),
    },
  }
}

async function completionGuard(row) {
  return {
    completed: {
      at: await was(row.completed?.at),
      by: await was(refId(row.completed?.by)),
    },
  }
}
async function guardSession(session) {
  return {
    entity: { eid: session.entity.eid },
    $was: await completionGuard(session),
  }
}

/** Rewire after render; call returned cleanup on unmount. The clock only edits outputs. */
export function wireCooking(rows, who, fail, root = document, recipes = []) {
  cleanups.get(root)?.()
  let desk = draftDesks.get(root)
  if (!desk) {
    desk = drafts({ report: (error) => showError(error, fail) })
    draftDesks.set(root, desk)
  }
  const find = (id) => rows.find((r) => r.entity.eid === id)
  const parent = (step) => find(step.cook_step.session)
  const requireWrite = (session) => {
    if (!own(session, who) || !writable(who)) {
      throw new Error(
        'Sign in as the session owner to change this cooking session.',
      )
    }
  }
  const run = async (target, operation) => {
    const key = target.dataset.id ??
      (target.name === 'cook-recipe' ? `pick:${target.value}` : 'picker')
    if (target.disabled || pending.has(key)) return
    pending.add(key)
    target.disabled = true
    try {
      await operation()
    } catch (error) {
      if (target.type === 'checkbox') {
        target.checked = target.name === 'cook-recipe'
          ? pickRows(rows, who).some((r) => r.edge.to === target.value)
          : !!find(target.dataset.id)?.completed
      }
      showError(error, fail, root)
    } finally {
      pending.delete(key)
      if (target.isConnected) target.disabled = false
    }
  }
  const selection = (event) => {
    const target = event.target
    if (target.name !== 'cook-recipe') return
    void run(target, async () => {
      if (!writable(who)) throw new Error('Sign in to choose recipes.')
      const recipe = target.value
      const held = pickRows(rows, who).find((r) => r.edge.to === recipe)
      const selecting = target.checked
      if (selecting && !held) {
        const answer = await apply({
          entity: { eid: '$pick' },
          edge: { from: personId(who), to: recipe },
          cook_pick: {},
        })
        const row = answer.bundles.find((r) =>
          r.cook_pick && r.edge?.to === recipe
        )
        if (!row) {
          throw new Error('Selection write accepted without its receipt.')
        }
        pickReceipts.set(recipe, { by: personId(who), row })
      } else if (!selecting && held) {
        await apply({ entity: { eid: held.entity.eid }, $delete: true })
        pickReceipts.set(recipe, { by: personId(who), row: null })
      }
      for (const listener of pickListeners) listener()
    })
  }
  const click = (event) => {
    const target = event.target.closest('[data-cook-action]')
    if (!target || !root.contains(target)) return
    const row = find(target.dataset.id)
    if (!row) return
    const action = target.dataset.cookAction
    // A checkbox's change is persisted once by this delegated click handler.
    void run(target, async () => {
      if (action === 'session') {
        requireWrite(row)
        const steps = rows.filter((r) =>
          r.cook_step?.session === row.entity.eid
        )
        if (
          !row.completed && (!steps.length || steps.some((r) => !r.completed))
        ) throw new Error('Complete each step first.')
        await apply([
          {
            entity: { eid: row.entity.eid },
            completed: row.completed ? null : {},
            $was: await completionGuard(row),
          },
          ...await Promise.all(
            steps.map(async (step) => ({
              entity: { eid: step.entity.eid },
              $was: await completionGuard(step),
            })),
          ),
        ])
        return
      }
      const session = parent(row)
      requireWrite(session)
      if (session.completed) {
        throw new Error('Reopen the session before changing its steps.')
      }
      if (action === 'complete') {
        await apply([
          await guardSession(session),
          {
            entity: { eid: row.entity.eid },
            completed: row.completed ? null : {},
            ...(!row.completed ? { timer: null } : {}),
            $was: { ...await completionGuard(row), ...await timerGuard(row) },
          },
        ])
      } else {
        const seconds = action === 'duration'
          ? validSeconds(target.dataset.seconds)
          : action === 'adjust'
          ? Math.max(
            1,
            (row.cook_step.seconds ?? 0) + Number(target.dataset.delta),
          )
          : null
        const timer = timerChange(
          row,
          seconds === null ? action : 'reset',
          Date.now(),
          seconds ?? row.cook_step.seconds,
        )
        await apply([
          await guardSession(session),
          {
            entity: { eid: row.entity.eid },
            timer,
            ...(seconds === null ? {} : { cook_step: { seconds } }),
            $was: { ...await completionGuard(row), ...await timerGuard(row) },
          },
        ])
      }
    })
  }
  const submit = (event) => {
    const form = event.target
    if (!form.matches('[data-cook-picker]')) return
    event.preventDefault()
    const button = form.querySelector('button')
    void run(button, async () => {
      if ([...pending].some((key) => key.startsWith('pick:'))) {
        throw new Error('Wait for recipe selections to finish saving.')
      }
      const selected = new Set(
        pickRows(rows, who).map((r) => r.edge.to),
      )
      await startCooking(recipes.filter((r) => selected.has(r.eid)))
    })
  }
  const tick = () => {
    for (const output of root.querySelectorAll('[data-cook-clock][data-due]')) {
      const left = timerRemaining({ due: output.dataset.due })
      output.textContent = `${formatSeconds(left)}${
        left === 0 ? ' · Time’s up' : ''
      }`
      output.classList.toggle('is-expired', left === 0)
    }
  }
  const unbindDurations = bindDurations(root, desk, {
    run,
    bundles: async (id, seconds) => {
      const row = find(id)
      const session = parent(row)
      requireWrite(session)
      if (session.completed) {
        throw new Error('Reopen the session before changing its steps.')
      }
      const timer = timerChange(row, 'reset', Date.now(), seconds)
      return [
        await guardSession(session),
        {
          entity: { eid: row.entity.eid },
          timer,
          cook_step: { seconds },
          $was: { ...await completionGuard(row), ...await timerGuard(row) },
        },
      ]
    },
  })
  root.addEventListener('change', selection)
  root.addEventListener('click', click)
  root.addEventListener('submit', submit)
  tick()
  const clock = setInterval(tick, 1000)
  const cleanup = () => {
    unbindDurations()
    clearInterval(clock)
    root.removeEventListener('change', selection)
    root.removeEventListener('click', click)
    root.removeEventListener('submit', submit)
    cleanups.delete(root)
  }
  cleanups.set(root, cleanup)
  return () => {
    // An old render's cleanup must not tear down the current bindings.
    if (cleanups.get(root) !== cleanup) return
    cleanup()
    desk.close()
    draftDesks.delete(root)
  }
}
