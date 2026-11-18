import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { apply } from '../index.js'

async function startPlugin () {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'better-tag-home-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home

  const listeners = new Map()
  const server = http.createServer()
  const controller = {
    calls: [],
    async fork (request) {
      this.calls.push(request)
      return { sessionId: 'child-session' }
    },
  }
  const liveSessions = []
  const ctx = {
    webServer: {
      register (route) { server.on('request', route.handler); return () => { server.removeListener('request', route.handler) } },
    },
    on (name, listener) {
      const set = listeners.get(name) ?? new Set()
      set.add(listener)
      listeners.set(name, set)
      return () => set.delete(listener)
    },
    get (name) {
      if (name === 'sessions') return { list: () => liveSessions }
      if (name === 'sessionController') return controller
      return undefined
    },
    effect (callback) {
      const dispose = callback()
      return () => { if (typeof dispose === 'function') dispose() }
    },
  }

  const dispose = apply(ctx)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/dsh-better-tag/v1`
  const emit = async (name, ...args) => {
    for (const listener of listeners.get(name) ?? []) await listener(...args)
  }
  const close = async () => {
    if (typeof dispose === 'function') dispose()
    await new Promise(resolve => server.close(resolve))
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await fs.rm(home, { recursive: true, force: true })
  }
  return { base, emit, close, controller, liveSessions }
}

async function waitFor (check, timeout = 800) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await check()) return true
    await new Promise(resolve => setTimeout(resolve, 15))
  }
  return false
}

async function call (base, pathname, { method = 'GET', body } = {}) {
  const headers = { accept: 'application/json' }
  if (method === 'POST') headers['x-better-tag'] = '1'
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(base + pathname, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return response.json()
}

test('activity clears a done stamp through the plugin listener', async () => {
  const plugin = await startPlugin()
  try {
    const created = await call(plugin.base, '/tags', { method: 'POST', body: { name: '报税' } })
    const tagId = created.tag.id
    await call(plugin.base, '/session', { method: 'POST', body: { sessionId: 's1', tagIds: [tagId], done: true } })

    await plugin.emit('api-session/activity', 's1', Date.now())
    const cleared = await waitFor(async () => (await call(plugin.base, '/state')).sessions.s1.done === false)
    assert.equal(cleared, true)

    const state = await call(plugin.base, '/state')
    assert.deepEqual(state.sessions.s1.tagIds, [tagId])
  } finally {
    await plugin.close()
  }
})

test('a fork created with shared seed events inherits tags but not done', async () => {
  const plugin = await startPlugin()
  try {
    const created = await call(plugin.base, '/tags', { method: 'POST', body: { name: '产品' } })
    const tagId = created.tag.id
    await call(plugin.base, '/session', { method: 'POST', body: { sessionId: 'parent', tagIds: [tagId], done: true } })

    const first = { type: 'user/message', seq: 0 }
    const parent = { id: 'parent', header: { isSeeded: false }, events: [first] }
    plugin.liveSessions.push(parent)
    const child = { id: 'child', header: { isSeeded: true }, events: [first] }

    await plugin.emit('session/created', child)
    const inherited = await waitFor(async () => (await call(plugin.base, '/state')).sessions.child?.tagIds?.length === 1)
    assert.equal(inherited, true)

    const state = await call(plugin.base, '/state')
    assert.deepEqual(state.sessions.child.tagIds, [tagId])
    assert.equal(state.sessions.child.done, false)
  } finally {
    await plugin.close()
  }
})

test('the controller fork wrapper copies tags to the child', async () => {
  const plugin = await startPlugin()
  try {
    const created = await call(plugin.base, '/tags', { method: 'POST', body: { name: '交付' } })
    const tagId = created.tag.id
    await call(plugin.base, '/session', { method: 'POST', body: { sessionId: 'source', tagIds: [tagId] } })

    await plugin.controller.fork({ sessionId: 'source' })
    const copied = await waitFor(async () => (await call(plugin.base, '/state')).sessions['child-session']?.tagIds?.length === 1)
    assert.equal(copied, true)

    const state = await call(plugin.base, '/state')
    assert.deepEqual(state.sessions['child-session'].tagIds, [tagId])
    assert.equal(state.sessions['child-session'].done, false)
  } finally {
    await plugin.close()
  }
})

test('disposing removes both the route and the event listeners', async () => {
  const plugin = await startPlugin()
  await plugin.close()
  await assert.rejects(() => fetch(plugin.base + '/state'))
})
