import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createStore, PALETTE } from '../src/store.js'

const logger = { warn: () => {} }

async function tempStore (options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'better-tag-store-'))
  const store = createStore({ dir, log: logger, ...options })
  await store.ready
  return { dir, store }
}

test('starts empty and persists a session record across restart', async () => {
  const { dir, store } = await tempStore()
  assert.deepEqual(store.state(), { version: 1, tags: [], sessions: {} })

  const { tag } = await store.createTag({ name: '报税', color: '#8fd694' })
  await store.setSession({ sessionId: 'session-a', tagIds: [tag.id], done: true })

  const reopened = createStore({ dir, log: logger })
  await reopened.ready
  const state = reopened.state()
  assert.equal(state.tags.length, 1)
  assert.equal(state.tags[0].name, '报税')
  assert.deepEqual(state.sessions['session-a'].tagIds, [tag.id])
  assert.equal(state.sessions['session-a'].done, true)
})

test('rejects duplicate tag names case-insensitively', async () => {
  const { store } = await tempStore()
  await store.createTag({ name: 'Report', color: '#7c9cff' })
  await assert.rejects(() => store.createTag({ name: ' report ', color: '#7c9cff' }), /already exists/)
})

test('deleting a tag cascades into every session', async () => {
  const { store } = await tempStore()
  const { tag: a } = await store.createTag({ name: 'a', color: '#7c9cff' })
  const { tag: b } = await store.createTag({ name: 'b', color: '#f0a35e' })
  await store.setSession({ sessionId: 's1', tagIds: [a.id, b.id] })
  await store.setSession({ sessionId: 's2', tagIds: [b.id] })

  const next = await store.deleteTag({ id: b.id })
  assert.equal(next.tags.length, 1)
  assert.deepEqual(next.sessions.s1.tagIds, [a.id])
  assert.deepEqual(next.sessions.s2.tagIds, [])
})

test('version conflicts refuse the write', async () => {
  const { store } = await tempStore()
  const before = store.state()
  await store.createTag({ name: 'a', color: '#7c9cff' })
  await assert.rejects(
    () => store.setSession({ sessionId: 's1', tagIds: [], ifVersion: before.version }),
    error => error.status === 409,
  )
  assert.equal(store.state().sessions.s1, undefined)
})

test('import merges by name and reports conflicts without touching local color', async () => {
  const { store } = await tempStore()
  await store.createTag({ name: '报税', color: '#8fd694' })

  const pack = {
    kind: 'dsh-better-tag-pack',
    version: 1,
    tags: [
      { name: '报税', color: '#8fd694' },
      { name: '报税', color: '#ff0000' },
      { name: '客户A', color: '#ffb86b' },
    ],
  }
  const first = await store.importPack(pack)
  assert.deepEqual(first.report.added, ['客户A'])
  assert.deepEqual(first.report.skipped, ['报税'])
  assert.equal(first.report.conflicts[0].name, '报税')
  assert.equal(first.state.tags.find(tag => tag.name === '报税').color, '#8fd694')

  const second = await store.importPack(pack)
  assert.equal(second.report.added.length, 0)
  assert.equal(second.state.tags.length, 2)
})

test('clearDone only clears an existing done stamp', async () => {
  const { store } = await tempStore()
  await store.setSession({ sessionId: 's1', tagIds: [], done: true })
  assert.equal(await store.clearDone('s1'), true)
  assert.equal(store.state().sessions.s1.done, false)
  assert.equal(await store.clearDone('s1'), false)
  assert.equal(await store.clearDone('missing'), false)
})


test('inline tags persist, dedupe, cap at eight, and never enter the library', async () => {
  const { dir, store } = await tempStore()
  const inline = []
  for (let i = 0; i < 10; i += 1) inline.push({ name: `临时${i}`, color: '#7c9cff' })
  inline.push({ name: '临时1', color: '#f0a35e' })
  const state = await store.setSession({ sessionId: 's1', inlineTags: inline })
  assert.equal(state.sessions.s1.inlineTags.length, 8)
  assert.equal(state.sessions.s1.inlineTags[1].name, '临时1')
  assert.equal(state.tags.length, 0)
  assert.equal(store.exportPack().tags.length, 0)

  const reopened = createStore({ dir, log: logger })
  await reopened.ready
  assert.equal(reopened.state().sessions.s1.inlineTags.length, 8)
})

test('fork copies inline tags but not the done stamp', async () => {
  const { store } = await tempStore()
  await store.setSession({
    sessionId: 'parent', inlineTags: [{ name: '临时', color: '#5ec8d8' }], done: true,
  })
  await store.copyTags('parent', 'child')
  const state = store.state()
  assert.deepEqual(state.sessions.child.inlineTags, [{ name: '临时', color: '#5ec8d8' }])
  assert.equal(state.sessions.child.done, false)
})


test('a new tag without a color takes the least-used palette slot', async () => {
  const { store } = await tempStore({ rng: () => 0 })
  await store.createTag({ name: 'a', color: '#7c9cff' })
  await store.createTag({ name: 'b', color: '#7c9cff' })

  const { tag } = await store.createTag({ name: 'c' })
  assert.equal(tag.color, '#f0a35e')
})

test('a new tag without a color picks among the least-used palette colors', async () => {
  const { store } = await tempStore({ rng: () => 0.99 })
  for (let index = 0; index < PALETTE.length; index += 1) {
    await store.createTag({ name: `tag-${index}`, color: PALETTE[index] })
  }
  await store.createTag({ name: 'extra-blue', color: '#7c9cff' })

  const { tag } = await store.createTag({ name: 'next' })
  assert.equal(tag.color, PALETTE[11])
})

test('an imported tag without a color is filled from the palette', async () => {
  const { store } = await tempStore({ rng: () => 0 })
  await store.createTag({ name: 'blue', color: '#7c9cff' })

  const result = await store.importPack({ tags: [{ name: 'imported' }] })
  assert.equal(result.state.tags.find(tag => tag.name === 'imported').color, '#f0a35e')
})

test('a colorless pack entry never conflicts with a local color', async () => {
  const { store } = await tempStore()
  await store.createTag({ name: 'keep', color: '#8fd694' })

  const result = await store.importPack({ tags: [{ name: 'keep' }] })
  assert.deepEqual(result.report.skipped, ['keep'])
  assert.deepEqual(result.report.conflicts, [])
  assert.equal(result.state.tags[0].color, '#8fd694')
})

test('an inline tag without a color gets a palette color instead of the first slot', async () => {
  const { store } = await tempStore({ rng: () => 0 })
  await store.createTag({ name: 'blue', color: '#7c9cff' })

  const state = await store.setSession({ sessionId: 's1', inlineTags: [{ name: 'temp' }] })
  assert.equal(state.sessions.s1.inlineTags[0].color, '#f0a35e')
})
