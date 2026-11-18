/**
 * Host half of dsh-better-tag.
 *
 * Owns the durable tag store and its loopback API. It never writes Session
 * logs, never registers a model-facing tool, and never touches the agent loop:
 * tags and the done stamp belong to the human.
 */

import os from 'node:os'
import path from 'node:path'
import { createStore } from './src/store.js'
import { registerLocalApi } from './src/http.js'

export const name = 'dsh-better-tag'
export const inject = ['webServer']

function storeDir () {
  const home = process.env.DSH_HOME
  if (typeof home === 'string' && home !== '') return path.join(home, 'storages', 'better-tag')
  return path.join(process.env.HOME ?? os.homedir(), '.dsh', 'storages', 'better-tag')
}

/**
 * Activate the plugin.
 * @param {object} ctx - Cordis plugin context.
 * @returns a disposer that releases every registration.
 */
export function apply (ctx) {
  const log = console
  const store = createStore({ dir: storeDir(), log })
  const disposers = []

  disposers.push(registerLocalApi({ webServer: ctx.webServer, store, log }))

  try {
    disposers.push(ctx.on('api-session/activity', sessionId => {
      void store.clearDone(String(sessionId)).catch(error => log.warn?.(`[better-tag] clear done failed: ${error.message}`))
    }))
  } catch (error) {
    log.warn?.(`[better-tag] activity listener failed: ${error.message}`)
  }

  try {
    disposers.push(ctx.on('session/created', session => {
      const live = () => ctx.get('sessions')?.list?.() ?? []
      void store.inheritFork(session, live).catch(error => log.warn?.(`[better-tag] fork inherit failed: ${error.message}`))
    }))
  } catch (error) {
    log.warn?.(`[better-tag] created listener failed: ${error.message}`)
  }

  // Current DSH forks do not record their source on the child header, so the
  // controller's fork call is the one place that still knows both ids. Wrap it
  // best-effort. The marker keeps repeated plugin reloads from stacking
  // wrappers: a reload reuses the true original and replaces the previous
  // wrapper instead of wrapping it again.
  const FORK_MARK = Symbol.for('dsh-better-tag.fork-wrap')
  try {
    const controller = ctx.get('sessionController')
    if (controller !== undefined && typeof controller.fork === 'function') {
      const previous = controller[FORK_MARK]
      const original = typeof previous?.original === 'function' ? previous.original : controller.fork
      const patched = async request => {
        const value = await original.call(controller, request)
        try {
          await store.copyTags(String(request.sessionId), String(value.sessionId))
        } catch (error) {
          log.warn?.(`[better-tag] fork copy failed: ${error.message}`)
        }
        return value
      }
      controller.fork = patched
      controller[FORK_MARK] = { original, patched }
      disposers.push(() => {
        if (controller.fork === patched) controller.fork = original
        if (controller[FORK_MARK]?.patched === patched) delete controller[FORK_MARK]
      })
    }
  } catch (error) {
    log.warn?.(`[better-tag] fork wrap unavailable: ${error.message}`)
  }

  const disposeAll = () => {
    for (const dispose of disposers.reverse()) {
      try { dispose() } catch { /* ignore */ }
    }
  }

  try {
    ctx.effect(() => disposeAll, 'dsh-better-tag: lifecycle')
    return undefined
  } catch {
    return disposeAll
  }
}
