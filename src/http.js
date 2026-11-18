/**
 * Local loopback API for the tag store.
 *
 * The Client half is a browser module without a Host RPC channel for this
 * package, so it talks to this prefix over same-origin `fetch`. Only loopback
 * peers reach it, and every write must carry a custom header a cross-site
 * request cannot set without a preflight.
 */

const CSRF_HEADER = 'x-better-tag'
const MAX_BODY = 1024 * 1024

/** One live registration per web server; a second apply reuses it. */
let active = null

function isLoopback (address) {
  if (typeof address !== 'string' || address === '') return true
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function readJson (req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.trim() === '') return resolve({})
      try { resolve(JSON.parse(raw)) } catch { reject(new Error('bad json')) }
    })
    req.on('error', reject)
  })
}

function send (res, status, json) {
  if (res.writableEnded) return
  const payload = Buffer.from(JSON.stringify(json), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.length),
    'cache-control': 'no-store',
  })
  res.end(payload)
}

/**
 * Register the tag API.
 * @param {{ webServer: { register: Function }, store: object, log?: object, path?: string }} options - dependencies.
 * @returns a disposer.
 */
export function registerLocalApi ({ webServer, store, log = console, path: base = '/dsh-better-tag/v1' } = {}) {
  if (webServer?.register === undefined) throw new Error('webServer is unavailable')
  if (active !== null && active.webServer === webServer && active.path === base) {
    active.store = store
    return () => {
      if (active !== null && active.store === store) active.store = null
    }
  }

  const dispose = webServer.register({
    kind: 'prefix',
    path: base,
    handler: async (req, res) => {
      try {
        if (!isLoopback(req.socket?.remoteAddress)) return send(res, 403, { ok: false, error: 'loopback-only' })
        if (req.method === 'POST' && req.headers[CSRF_HEADER] !== '1') {
          return send(res, 403, { ok: false, error: 'missing request header' })
        }
        const live = active?.store ?? store
        if (live === null || live === undefined) return send(res, 503, { ok: false, error: 'not-ready' })
        await live.ready
        const url = new URL(req.url ?? '/', 'http://local')
        const route = url.pathname.slice(base.length) || '/'

        if (req.method === 'GET' && (route === '/' || route === '/ping')) {
          return send(res, 200, { ok: true, service: 'better-tag' })
        }
        if (req.method === 'GET' && route === '/state') {
          return send(res, 200, { ok: true, ...live.state() })
        }
        if (req.method === 'GET' && route === '/export') {
          return send(res, 200, { ok: true, pack: live.exportPack() })
        }
        if (req.method === 'POST' && route === '/session') {
          const body = await readJson(req)
          const state = await live.setSession({
            sessionId: body.sessionId,
            tagIds: body.tagIds,
            inlineTags: body.inlineTags,
            done: body.done,
            ifVersion: body.ifVersion,
          })
          return send(res, 200, { ok: true, ...state })
        }
        if (req.method === 'POST' && route === '/tags') {
          const body = await readJson(req)
          const result = await live.createTag({ name: body.name, color: body.color })
          return send(res, 200, { ok: true, tag: result.tag, ...result.state })
        }
        if (req.method === 'POST' && route === '/tags/update') {
          const body = await readJson(req)
          const state = await live.updateTag({ id: body.id, name: body.name, color: body.color })
          return send(res, 200, { ok: true, ...state })
        }
        if (req.method === 'POST' && route === '/tags/delete') {
          const body = await readJson(req)
          const state = await live.deleteTag({ id: body.id })
          return send(res, 200, { ok: true, ...state })
        }
        if (req.method === 'POST' && route === '/import') {
          const body = await readJson(req)
          const result = await live.importPack(body.pack)
          return send(res, 200, { ok: true, report: result.report, ...result.state })
        }
        return send(res, 404, { ok: false, error: 'not-found' })
      } catch (error) {
        const status = typeof error?.status === 'number' ? error.status : 500
        if (status >= 500) log?.warn?.(`[better-tag] ${error?.message ?? error}`)
        return send(res, status, { ok: false, error: error?.message ?? 'internal', code: error?.code ?? 'error' })
      }
    },
  })

  const registration = { webServer, path: base, store, dispose }
  active = registration
  return () => {
    try { dispose() } catch { /* ignore */ }
    if (active === registration) active = null
  }
}
