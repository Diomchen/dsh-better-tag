import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { createStore } from '../src/store.js'
import { registerLocalApi } from '../src/http.js'

const logger = { warn: () => {} }

async function withServer (run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'better-tag-http-'))
  const store = createStore({ dir, log: logger })
  await store.ready
  const server = http.createServer()
  const dispose = registerLocalApi({
    webServer: { register (route) { server.on('request', route.handler); return () => {} } },
    store,
    log: logger,
    path: '/better-tag',
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/better-tag`
  try {
    await run({ base, store })
  } finally {
    dispose()
    await new Promise(resolve => server.close(resolve))
  }
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
  return { status: response.status, json: await response.json() }
}

test('serves state and rejects writes without the custom header', async () => {
  await withServer(async ({ base }) => {
    const empty = await call(base, '/state')
    assert.equal(empty.status, 200)
    assert.deepEqual(empty.json, { ok: true, version: 1, tags: [], sessions: {} })

    const denied = await fetch(base + '/tags', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    })
    assert.equal(denied.status, 403)
  })
})

test('round-trips a tag and a session record over HTTP', async () => {
  await withServer(async ({ base }) => {
    const created = await call(base, '/tags', { method: 'POST', body: { name: '报税', color: '#8fd694' } })
    assert.equal(created.status, 200)
    const tag = created.json.tag
    assert.equal(tag.name, '报税')

    const saved = await call(base, '/session', {
      method: 'POST',
      body: { sessionId: 'session-a', tagIds: [tag.id], inlineTags: [{ name: '临时', color: '#5ec8d8' }], done: true },
    })
    assert.equal(saved.status, 200)
    assert.deepEqual(saved.json.sessions['session-a'].tagIds, [tag.id])
    assert.deepEqual(saved.json.sessions['session-a'].inlineTags, [{ name: '临时', color: '#5ec8d8' }])

    const state = await call(base, '/state')
    assert.equal(state.json.sessions['session-a'].done, true)
  })
})

test('maps a stale version to 409', async () => {
  await withServer(async ({ base }) => {
    const created = await call(base, '/tags', { method: 'POST', body: { name: 'a' } })
    const stale = created.json.version - 1
    const conflict = await call(base, '/session', {
      method: 'POST',
      body: { sessionId: 's', tagIds: [], ifVersion: stale },
    })
    assert.equal(conflict.status, 409)
    assert.equal(conflict.json.code, 'version-conflict')
  })
})

test('export then import stays idempotent', async () => {
  await withServer(async ({ base }) => {
    await call(base, '/tags', { method: 'POST', body: { name: '报税', color: '#8fd694' } })
    await call(base, '/tags', { method: 'POST', body: { name: '客户A', color: '#ffb86b' } })
    const exported = await call(base, '/export')
    assert.equal(exported.json.pack.kind, 'dsh-better-tag-pack')

    const imported = await call(base, '/import', { method: 'POST', body: { pack: exported.json.pack } })
    assert.equal(imported.status, 200)
    assert.equal(imported.json.report.added.length, 0)
    assert.equal(imported.json.tags.length, 2)
  })
})

test('bad JSON returns 500 without crashing the server', async () => {
  await withServer(async ({ base }) => {
    const response = await fetch(base + '/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-better-tag': '1' },
      body: '{oops',
    })
    assert.equal(response.status, 500)
    const state = await call(base, '/state')
    assert.equal(state.status, 200)
  })
})
