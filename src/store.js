/**
 * Durable per-session tag records.
 *
 * One JSON document under `<DSH_HOME>/storages/better-tag/state.json`, written
 * atomically and serialized behind one promise chain, so a crash never leaves a
 * half-written file and two writes never interleave. The document is small
 * (one record per tagged Session), and it never enters a Session log.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/** Preset content palette for tag chips. */
export const PALETTE = [
  '#7c9cff', '#f0a35e', '#67c98a', '#c084fc',
  '#5ec8d8', '#6ea8fe', '#f07a7a', '#9aa0ad',
  '#b58cff', '#e0a3ff', '#ffb86b', '#8fd694',
]

const MAX_TAGS_PER_SESSION = 12
const MAX_INLINE_TAGS = 8
const MAX_TAG_NAME = 16
const HEX = /^#[0-9a-fA-F]{6}$/

/** A validation or version failure the HTTP layer maps to a status. */
export class StoreError extends Error {
  constructor (code, message, status = 400) {
    super(message)
    this.name = 'StoreError'
    this.code = code
    this.status = status
  }
}

function emptyState () {
  return { version: 1, tags: [], sessions: {} }
}

function clone (value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeName (raw) {
  const name = String(raw ?? '').trim()
  if (name.length < 1 || name.length > MAX_TAG_NAME) {
    throw new StoreError('bad-name', `tag name must be 1-${MAX_TAG_NAME} characters`)
  }
  return name
}

function normalizeColor (raw) {
  if (typeof raw === 'string' && HEX.test(raw)) return raw.toLowerCase()
  return PALETTE[0]
}

function normalizeTag (record) {
  if (record === null || typeof record !== 'object') return null
  if (typeof record.id !== 'string' || typeof record.name !== 'string') return null
  return {
    id: record.id,
    name: record.name,
    color: typeof record.color === 'string' && HEX.test(record.color) ? record.color.toLowerCase() : PALETTE[0],
    order: Number.isInteger(record.order) ? record.order : 0,
    createdAt: Number.isFinite(record.createdAt) ? record.createdAt : Date.now(),
  }
}

function normalizeInlineTags (value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue
    const name = String(item.name ?? '').trim()
    if (name.length < 1 || name.length > MAX_TAG_NAME) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name, color: normalizeColor(item.color) })
    if (out.length >= MAX_INLINE_TAGS) break
  }
  return out
}

function normalizeSession (sessionId, record) {
  const tagIds = Array.isArray(record?.tagIds)
    ? [...new Set(record.tagIds.filter(id => typeof id === 'string'))].slice(0, MAX_TAGS_PER_SESSION)
    : []
  return {
    sessionId,
    tagIds,
    inlineTags: normalizeInlineTags(record?.inlineTags),
    done: record?.done === true,
    updatedAt: Number.isFinite(record?.updatedAt) ? record.updatedAt : Date.now(),
  }
}

/**
 * Build the store and start loading its document.
 * @param {{ dir: string, log?: Pick<Console, 'warn'> }} options - store location and logger.
 * @returns the store handle.
 */
export function createStore ({ dir, log = console }) {
  let data = emptyState()
  let chain = Promise.resolve()
  const file = path.join(dir, 'state.json')

  async function load () {
    await fs.mkdir(dir, { recursive: true })
    try {
      const raw = await fs.readFile(file, 'utf8')
      const parsed = JSON.parse(raw)
      const tags = Array.isArray(parsed?.tags) ? parsed.tags.map(normalizeTag).filter(Boolean) : []
      const sessions = {}
      if (parsed?.sessions !== null && typeof parsed.sessions === 'object') {
        for (const [id, record] of Object.entries(parsed.sessions)) {
          sessions[id] = normalizeSession(id, record)
        }
      }
      data = {
        version: Number.isInteger(parsed?.version) && parsed.version > 0 ? parsed.version : 1,
        tags,
        sessions,
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') log.warn?.(`[better-tag] could not read ${file}: ${error.message}`)
    }
  }

  const ready = load()

  function persist () {
    const snapshot = JSON.stringify(data)
    const run = chain.then(async () => {
      await fs.mkdir(dir, { recursive: true })
      const tmp = `${file}.${process.pid}.tmp`
      await fs.writeFile(tmp, snapshot, 'utf8')
      await fs.rename(tmp, file)
    })
    chain = run.then(() => undefined, error => {
      log.warn?.(`[better-tag] could not write ${file}: ${error.message}`)
    })
    return run
  }

  function state () {
    return clone(data)
  }

  function checkVersion (ifVersion) {
    if (ifVersion === undefined || ifVersion === null) return
    if (!Number.isInteger(ifVersion) || ifVersion !== data.version) {
      throw new StoreError('version-conflict', `expected version ${data.version}`, 409)
    }
  }

  function tagById (id) {
    return data.tags.find(tag => tag.id === id)
  }

  function tagByName (name) {
    const needle = name.toLowerCase()
    return data.tags.find(tag => tag.name.toLowerCase() === needle)
  }

  function touchSession (sessionId) {
    const current = data.sessions[sessionId]
    const next = normalizeSession(sessionId, current)
    next.updatedAt = Date.now()
    data.sessions[sessionId] = next
    return next
  }

  return {
    ready,
    state,

    /** Update one Session's tags and/or done stamp. */
    async setSession ({ sessionId, tagIds, inlineTags, done, ifVersion } = {}) {
      await ready
      if (typeof sessionId !== 'string' || sessionId === '') {
        throw new StoreError('bad-session', 'sessionId is required')
      }
      checkVersion(ifVersion)
      const record = touchSession(sessionId)
      if (Array.isArray(tagIds)) {
        record.tagIds = [...new Set(tagIds.filter(id => typeof id === 'string' && tagById(id)))]
          .slice(0, MAX_TAGS_PER_SESSION)
      }
      if (Array.isArray(inlineTags)) record.inlineTags = normalizeInlineTags(inlineTags)
      if (typeof done === 'boolean') record.done = done
      data.version += 1
      await persist()
      return state()
    },

    /** Create one tag; returns the new tag and the new state. */
    async createTag ({ name, color } = {}) {
      await ready
      const clean = normalizeName(name)
      if (tagByName(clean)) throw new StoreError('duplicate-name', `tag "${clean}" already exists`)
      const tag = {
        id: randomUUID(),
        name: clean,
        color: normalizeColor(color),
        order: data.tags.length,
        createdAt: Date.now(),
      }
      data.tags.push(tag)
      data.version += 1
      await persist()
      return { tag, state: state() }
    },

    /** Rename or recolor one tag; every Session keeps its reference by id. */
    async updateTag ({ id, name, color } = {}) {
      await ready
      const tag = tagById(id)
      if (!tag) throw new StoreError('missing-tag', 'tag not found', 404)
      if (name !== undefined) {
        const clean = normalizeName(name)
        const clash = tagByName(clean)
        if (clash && clash.id !== id) throw new StoreError('duplicate-name', `tag "${clean}" already exists`)
        tag.name = clean
      }
      if (color !== undefined) tag.color = normalizeColor(color)
      data.version += 1
      await persist()
      return state()
    },

    /** Delete one tag and every Session reference to it. */
    async deleteTag ({ id } = {}) {
      await ready
      if (!tagById(id)) throw new StoreError('missing-tag', 'tag not found', 404)
      data.tags = data.tags.filter(tag => tag.id !== id)
      for (const record of Object.values(data.sessions)) {
        record.tagIds = record.tagIds.filter(tagId => tagId !== id)
      }
      data.version += 1
      await persist()
      return state()
    },

    /** Tag pack export: definitions only, never Session assignments. */
    exportPack () {
      return {
        kind: 'dsh-better-tag-pack',
        version: 1,
        name: 'dsh-better-tag',
        tags: data.tags.map(tag => ({ name: tag.name, color: tag.color })),
      }
    },

    /** Merge an imported pack into the local vocabulary. */
    async importPack (pack) {
      await ready
      if (pack === null || typeof pack !== 'object' || !Array.isArray(pack.tags)) {
        throw new StoreError('bad-pack', 'pack.tags must be an array')
      }
      const report = { added: [], skipped: [], conflicts: [] }
      let changed = false
      for (const raw of pack.tags) {
        let name
        try { name = normalizeName(raw?.name) } catch { report.skipped.push(String(raw?.name ?? '')); continue }
        const color = normalizeColor(raw?.color)
        const existing = tagByName(name)
        if (!existing) {
          data.tags.push({
            id: randomUUID(), name, color, order: data.tags.length, createdAt: Date.now(),
          })
          report.added.push(name)
          changed = true
        } else if (existing.color === color) {
          report.skipped.push(name)
        } else {
          report.conflicts.push({ name, local: existing.color, incoming: color })
        }
      }
      if (changed) {
        data.version += 1
        await persist()
      }
      return { report, state: state() }
    },

    /** Clear the done stamp after the user sends a new message. */
    async clearDone (sessionId) {
      await ready
      const record = data.sessions[sessionId]
      if (!record || record.done !== true) return false
      record.done = false
      record.updatedAt = Date.now()
      data.version += 1
      await persist()
      return true
    },

    /** Copy a parent Session's tags onto a fork; the child never inherits done. */
    async copyTags (fromSessionId, toSessionId) {
      await ready
      if (typeof fromSessionId !== 'string' || typeof toSessionId !== 'string') return false
      if (fromSessionId === toSessionId) return false
      const parent = data.sessions[fromSessionId]
      if (!parent || (parent.tagIds.length === 0 && (parent.inlineTags?.length ?? 0) === 0)) return false
      const child = normalizeSession(toSessionId, data.sessions[toSessionId])
      child.tagIds = parent.tagIds.filter(id => tagById(id)).slice(0, MAX_TAGS_PER_SESSION)
      child.inlineTags = (parent.inlineTags ?? []).map(tag => ({ name: tag.name, color: tag.color }))
      child.done = false
      child.updatedAt = Date.now()
      data.sessions[toSessionId] = child
      data.version += 1
      await persist()
      return true
    },

    /**
     * Fork inheritance for a newly created Session.
     * @param session - the created Session object.
     * @param listLive - returns every live Session.
     */
    async inheritFork (session, listLive) {
      if (session?.header?.isSeeded !== true) return false
      const childId = String(session.id)
      if (session.header.origin === 'subagent') return false
      const direct = session.header.parentSession === undefined ? undefined : String(session.header.parentSession)
      if (direct !== undefined) return this.copyTags(direct, childId)
      const eventsOf = live => {
        if (typeof live?.snapshotEvents === 'function') return live.snapshotEvents()
        return Array.isArray(live?.events) ? live.events : []
      }
      const first = eventsOf(session)[0]
      if (first === undefined) return false
      let match
      let matchEvents = -1
      for (const other of listLive?.() ?? []) {
        if (String(other.id) === childId) continue
        const events = eventsOf(other)
        if (events[0] !== first) continue
        if (events.length > matchEvents) { match = other; matchEvents = events.length }
      }
      if (match === undefined) return false
      return this.copyTags(String(match.id), childId)
    },
  }
}
