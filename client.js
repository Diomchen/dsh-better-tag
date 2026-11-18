/**
 * Client half of dsh-better-tag.
 *
 * One module-level snapshot feeds every seat: sidebar row chips, the done
 * button, the row menu, the title-adjacent tag editor, and the overview panel.
 * Writes go to the Host's loopback API and replace the snapshot with the
 * response, so every seat stays consistent without a push channel.
 */

window.__ModuleLoader__.load({
  id: 'dsh-better-tag',
  factory (require) {
    const React = require('react')
    const h = React.createElement
    const { useSyncExternalStore, useEffect, useRef, useState } = React

    const NS = 'better-tag'
    const PANEL_ID = 'better-tag-overview'
    const API = '/dsh-better-tag/v1'
    const HEADER = { 'x-better-tag': '1' }

    const DICTS = {
      zh: {
        nav: '会话总览',
        panel: '会话总览',
        title: '会话总览',
        subtitle: '跨全部 workspace',
        pending: '待你',
        unread: 'AI 已交回',
        running: '进行中',
        done: '已完成',
        idle: '空闲',
        all: '全部',
        showArchived: '显示归档',
        total: '共',
        export: '导出标签包',
        import: '导入标签包',
        manage: '管理标签',
        empty: '这个筛选下没有会话。',
        loadError: '标签服务未就绪',
        retry: '重试',
        picker: '标签',
        create: '新建',
        createPlaceholder: '新标签名',
        manageFromPicker: '管理标签…',
        tempSection: '临时标签 · 不入标签库',
        tempPlaceholder: '临时标签名',
        tempCreate: '临时',
        promote: '固定',
        remove: '移除',
        tempLimit: '每个会话最多 8 个临时标签',
        tempUsedLibrary: '已有同名标签，已改用标签库中的标签',
        promoteColorKept: '标签库已有同名标签，颜色沿用库中的',
        menuClearTemp: '清除临时标签',
        noTags: '还没有标签，先新建一个。',
        doneOn: '落完成章',
        doneOff: '取消完成章',
        menuTags: '标签…',
        headerAdd: '标签',
        rename: '重命名',
        delete: '删除',
        deleteConfirm: '删除这个标签？它会从所有会话移除。',
        importTitle: '导入标签包',
        importHint: '粘贴 JSON 标签包，或选择文件。',
        importFile: '选择文件',
        importRun: '导入',
        importReport: '新增 {added} · 跳过 {skipped} · 冲突 {conflicts}',
        importReportTitle: '导入结果',
        close: '关闭',
        cancel: '取消',
        save: '保存',
        exporting: '正在导出…',
        importBad: '不是有效的标签包 JSON。',
      },
      en: {
        nav: 'Session overview',
        panel: 'Session overview',
        title: 'Session overview',
        subtitle: 'Across every workspace',
        pending: 'Needs you',
        unread: 'Handed back',
        running: 'Running',
        done: 'Done',
        idle: 'Idle',
        all: 'All',
        showArchived: 'Show archived',
        total: 'Total',
        export: 'Export pack',
        import: 'Import pack',
        manage: 'Manage tags',
        empty: 'No sessions under this filter.',
        loadError: 'Tag service unavailable',
        retry: 'Retry',
        picker: 'Tags',
        create: 'Add',
        createPlaceholder: 'New tag name',
        manageFromPicker: 'Manage tags…',
        tempSection: 'Temporary · not in library',
        tempPlaceholder: 'Temporary tag name',
        tempCreate: 'Temp',
        promote: 'Pin',
        remove: 'Remove',
        tempLimit: 'Up to 8 temporary tags per session',
        tempUsedLibrary: 'A library tag with this name exists; used it instead',
        promoteColorKept: 'A library tag kept its own color',
        menuClearTemp: 'Clear temporary tags',
        noTags: 'No tags yet. Create one first.',
        doneOn: 'Mark done',
        doneOff: 'Clear done',
        menuTags: 'Tags…',
        headerAdd: 'Tag',
        rename: 'Rename',
        delete: 'Delete',
        deleteConfirm: 'Delete this tag? It is removed from every session.',
        importTitle: 'Import tag pack',
        importHint: 'Paste a JSON tag pack, or choose a file.',
        importFile: 'Choose file',
        importRun: 'Import',
        importReport: 'Added {added} · skipped {skipped} · conflicts {conflicts}',
        importReportTitle: 'Import result',
        close: 'Close',
        cancel: 'Cancel',
        save: 'Save',
        exporting: 'Exporting…',
        importBad: 'Not a valid tag-pack JSON.',
      },
    }

    let translate = key => DICTS.zh[key] ?? key
    const t = (key, vars) => {
      const text = String(translate(key) ?? key)
      if (vars === undefined || vars === null) return text
      return text.replace(/\{(\w+)\}/g, (_m, name) => String(vars[name] ?? `{${name}}`))
    }

    /* ------------------------------------------------------------------ */
    /* store                                                               */
    /* ------------------------------------------------------------------ */

    let view = { version: 0, tags: [], sessions: {}, phase: 'loading', error: null, notice: null }
    let snapshot = view
    const listeners = new Set()

    function commit (patch) {
      view = { ...view, ...patch, phase: patch.phase ?? (view.phase === 'loading' ? 'ready' : view.phase) }
      snapshot = view
      for (const listener of [...listeners]) {
        try { listener() } catch { /* ignore */ }
      }
    }
    const subscribe = listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }
    const useStore = () => useSyncExternalStore(subscribe, () => snapshot, () => snapshot)

    let noticeTimer = null
    function notify (message) {
      commit({ notice: message })
      if (noticeTimer !== null) clearTimeout(noticeTimer)
      noticeTimer = setTimeout(() => { noticeTimer = null; commit({ notice: null }) }, 4000)
    }

    async function api (pathname, body) {
      const response = await fetch(API + pathname, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined
          ? { accept: 'application/json' }
          : { accept: 'application/json', 'content-type': 'application/json', ...HEADER },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      let json
      try { json = await response.json() } catch { json = null }
      if (!response.ok || json === null || json.ok === false) {
        const error = new Error(json?.error ?? `request failed (${response.status})`)
        error.status = response.status
        error.code = json?.code
        throw error
      }
      return json
    }

    function applyState (json) {
      commit({ version: json.version, tags: json.tags, sessions: json.sessions, phase: 'ready', error: null })
    }

    async function refresh () {
      try {
        applyState(await api('/state'))
      } catch (error) {
        commit({ phase: 'error', error: error.message })
      }
    }

    async function saveSession (sessionId, patch) {
      try {
        applyState(await api('/session', { sessionId, ifVersion: view.version, ...patch }))
        return true
      } catch (error) {
        if (error.status === 409) {
          await refresh()
          try {
            applyState(await api('/session', { sessionId, ifVersion: view.version, ...patch }))
            return true
          } catch (retry) {
            notify(retry.message)
            return false
          }
        }
        notify(error.message)
        return false
      }
    }

    const toggleDone = sessionId => {
      const done = view.sessions[sessionId]?.done === true
      return saveSession(sessionId, { done: !done })
    }

    const setTags = (sessionId, tagIds) => saveSession(sessionId, { tagIds })

    async function toggleTag (sessionId, tagId) {
      const current = view.sessions[sessionId]?.tagIds ?? []
      const next = current.includes(tagId) ? current.filter(id => id !== tagId) : [...current, tagId]
      return setTags(sessionId, next)
    }

    async function createTag (name, color) {
      try {
        const json = await api('/tags', color === undefined ? { name } : { name, color })
        applyState(json)
        return json.tag
      } catch (error) {
        notify(error.message)
        return null
      }
    }

    async function updateTag (id, patch) {
      try {
        applyState(await api('/tags/update', { id, ...patch }))
      } catch (error) { notify(error.message) }
    }

    async function deleteTag (id) {
      try {
        applyState(await api('/tags/delete', { id }))
      } catch (error) { notify(error.message) }
    }

    async function setInlineTags (sessionId, inlineTags) {
      return saveSession(sessionId, { inlineTags })
    }

    async function addInlineTag (sessionId, raw) {
      const name = String(raw ?? '').trim()
      if (name.length < 1) return false
      if (name.length > 16) { notify(t('tempLimit')); return false }
      const library = view.tags.find(tag => tag.name.toLowerCase() === name.toLowerCase())
      if (library !== undefined) {
        const current = view.sessions[sessionId]?.tagIds ?? []
        if (!current.includes(library.id)) await setTags(sessionId, [...current, library.id])
        notify(t('tempUsedLibrary'))
        return true
      }
      const current = inlineTagsOf(sessionId)
      if (current.some(tag => tag.name.toLowerCase() === name.toLowerCase())) return true
      if (current.length >= 8) { notify(t('tempLimit')); return false }
      const palette = ['#7c9cff', '#f0a35e', '#67c98a', '#c084fc', '#5ec8d8', '#6ea8fe', '#f07a7a', '#9aa0ad', '#b58cff', '#e0a3ff', '#ffb86b', '#8fd694']
      const color = palette[(current.length + (view.sessions[sessionId]?.tagIds.length ?? 0)) % palette.length]
      return saveSession(sessionId, { inlineTags: [...current, { name, color }] })
    }

    async function removeInlineTag (sessionId, name) {
      return saveSession(sessionId, { inlineTags: inlineTagsOf(sessionId).filter(tag => tag.name !== name) })
    }

    async function promoteInlineTag (sessionId, name) {
      const inline = inlineTagsOf(sessionId).find(tag => tag.name === name)
      if (inline === undefined) return false
      let tagId
      const existing = view.tags.find(tag => tag.name.toLowerCase() === name.toLowerCase())
      if (existing !== undefined) {
        tagId = existing.id
        if (existing.color !== inline.color) notify(t('promoteColorKept'))
      } else {
        const created = await createTag(name, inline.color)
        if (created === null) return false
        tagId = created.id
      }
      const current = view.sessions[sessionId]?.tagIds ?? []
      const tagIds = current.includes(tagId) ? current : [...current, tagId]
      const inlineTags = inlineTagsOf(sessionId).filter(tag => tag.name !== name)
      return saveSession(sessionId, { tagIds, inlineTags })
    }

    async function exportPack () {
      try {
        const json = await api('/export')
        const blob = new Blob([JSON.stringify(json.pack, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = 'dsh-better-tag-pack.json'
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      } catch (error) { notify(error.message) }
    }

    async function importPack (pack) {
      try {
        const json = await api('/import', { pack })
        applyState(json)
        return json.report
      } catch (error) {
        notify(error.message)
        return null
      }
    }

    function tagOf (id) {
      return view.tags.find(tag => tag.id === id)
    }

    function sessionTags (sessionId) {
      const meta = view.sessions[sessionId]
      if (meta === undefined) return []
      const library = meta.tagIds.map(tagOf).filter(Boolean)
        .map(tag => ({ ...tag, key: tag.id, ephemeral: false }))
      const inline = (meta.inlineTags ?? []).map(tag => ({
        key: `inline:${tag.name}`, name: tag.name, color: tag.color, ephemeral: true,
      }))
      return [...library, ...inline]
    }

    function inlineTagsOf (sessionId) {
      return view.sessions[sessionId]?.inlineTags ?? []
    }

    /* ------------------------------------------------------------------ */
    /* picker + panel UI state                                             */
    /* ------------------------------------------------------------------ */

    let overlay = { open: false, sessionId: null, rect: null }
    let overlaySnapshot = overlay
    const overlayListeners = new Set()
    function commitOverlay (next) {
      overlay = { ...overlay, ...next }
      overlaySnapshot = overlay
      for (const listener of [...overlayListeners]) {
        try { listener() } catch { /* ignore */ }
      }
    }
    const subscribeOverlay = listener => {
      overlayListeners.add(listener)
      return () => { overlayListeners.delete(listener) }
    }
    const useOverlay = () => useSyncExternalStore(subscribeOverlay, () => overlaySnapshot, () => overlaySnapshot)

    let ui = { manager: false, importOpen: false }
    let uiSnapshot = ui
    const uiListeners = new Set()
    function commitUi (next) {
      ui = { ...ui, ...next }
      uiSnapshot = ui
      for (const listener of [...uiListeners]) {
        try { listener() } catch { /* ignore */ }
      }
    }
    const subscribeUi = listener => {
      uiListeners.add(listener)
      return () => { uiListeners.delete(listener) }
    }
    const useUi = () => useSyncExternalStore(subscribeUi, () => uiSnapshot, () => uiSnapshot)

    function openPicker (sessionId, rect) {
      commitOverlay({ open: true, sessionId, rect })
    }
    function closePicker () {
      commitOverlay({ open: false })
    }

    /* ------------------------------------------------------------------ */
    /* icons                                                               */
    /* ------------------------------------------------------------------ */

    function CheckIcon ({ size = 12 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true },
        h('path', {
          d: 'M3 8.6 6.4 12 13 4.6',
          fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
        }))
    }

    function TagIcon ({ size = 14 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, 'aria-hidden': true },
        h('path', {
          d: 'M2.5 6.2c0-.7.6-1.2 1.2-1.2h4.1c.3 0 .6.1.8.3l4.6 4.6c.5.5.5 1.2 0 1.7l-3.7 3.7c-.5.5-1.2.5-1.7 0L3.2 10.7a1.2 1.2 0 0 1-.3-.8z',
          fill: 'currentColor',
        }),
        h('circle', { cx: 6.1, cy: 7.8, r: 1.1, fill: 'var(--bt-icon-cut, #1b1d24)' }))
    }

    /* ------------------------------------------------------------------ */
    /* shared bits                                                         */
    /* ------------------------------------------------------------------ */

    function Chip ({ tag, onClick, title }) {
      const style = {
        '--bt-chip': tag.color,
        background: `color-mix(in srgb, ${tag.color} 16%, transparent)`,
        borderColor: `color-mix(in srgb, ${tag.color} 36%, transparent)`,
        color: tag.color,
      }
      const className = 'bt-chip' + (tag.ephemeral === true ? ' is-temp' : '') + (onClick === undefined ? '' : ' bt-chip-button')
      if (onClick === undefined) {
        return h('span', { className, style, title: title ?? tag.name }, tag.name)
      }
      return h('button', { type: 'button', className, style, title: title ?? tag.name, onClick }, tag.name)
    }

    function useSessionMeta (sessionId) {
      const snap = useStore()
      return { meta: snap.sessions[sessionId], tags: sessionTags(sessionId), snap }
    }

    /* ------------------------------------------------------------------ */
    /* sidebar row decorations                                             */
    /* ------------------------------------------------------------------ */

    function RowTags ({ sessionId }) {
      const { tags, meta } = useSessionMeta(sessionId)
      if (tags.length === 0 && meta?.done !== true) return null
      const shown = tags.slice(0, 2)
      return h('span', { className: 'bt-row-tags' },
        shown.map(tag => h(Chip, { key: tag.key, tag })),
        tags.length > 2 ? h('span', { className: 'bt-more' }, `+${tags.length - 2}`) : null,
        meta?.done === true
          ? h('span', { className: 'bt-stamp', title: t('done') }, h(CheckIcon, { size: 10 }))
          : null)
    }

    function DoneAction ({ sessionId }) {
      const { meta } = useSessionMeta(sessionId)
      const done = meta?.done === true
      return h('button', {
        type: 'button',
        className: 'bt-action' + (done ? ' is-on' : ''),
        title: t(done ? 'doneOff' : 'doneOn'),
        'aria-label': t(done ? 'doneOff' : 'doneOn'),
        'aria-pressed': done,
        onClick: () => { void toggleDone(sessionId) },
      }, h(CheckIcon, { size: 12 }))
    }

    /* ------------------------------------------------------------------ */
    /* session row menu                                                    */
    /* ------------------------------------------------------------------ */

    function MenuTagsItem ({ sessionId, useMenuOpenState }) {
      const [, setMenuOpen] = useMenuOpenState()
      const { tags } = useSessionMeta(sessionId)
      return h('button', {
        type: 'button', role: 'menuitem', className: 'bt-menuitem',
        onClick: event => {
          setMenuOpen(false)
          openPicker(sessionId, event.currentTarget.getBoundingClientRect())
        },
      }, h(TagIcon, { size: 14 }), t('menuTags'), tags.length > 0 ? h('span', { className: 'bt-menu-count' }, String(tags.length)) : null)
    }

    function MenuDoneItem ({ sessionId, useMenuOpenState }) {
      const [, setMenuOpen] = useMenuOpenState()
      const { meta } = useSessionMeta(sessionId)
      const done = meta?.done === true
      return h('button', {
        type: 'button', role: 'menuitem', className: 'bt-menuitem',
        onClick: () => { setMenuOpen(false); void toggleDone(sessionId) },
      }, done ? t('doneOff') : t('doneOn'))
    }

    /* ------------------------------------------------------------------ */
    /* session hover card                                                  */
    /* ------------------------------------------------------------------ */

    function HoverTags ({ sessionId }) {
      const { tags, meta } = useSessionMeta(sessionId)
      if (tags.length === 0 && meta?.done !== true) return null
      return h('div', { className: 'bt-hover' },
        h('div', { className: 'bt-hover-head' }, t('picker')),
        h('div', { className: 'bt-hover-chips' },
          tags.map(tag => h(Chip, { key: tag.key, tag })),
          meta?.done === true
            ? h('span', { className: 'bt-stamp', title: t('done') }, h(CheckIcon, { size: 10 }))
            : null))
    }

    /* ------------------------------------------------------------------ */
    /* title-adjacent tags                                                 */
    /* ------------------------------------------------------------------ */

    function HeaderTags ({ sessionId }) {
      const { tags } = useSessionMeta(sessionId)
      const shown = tags.slice(0, 3)
      return h('span', { className: 'bt-head-tags' },
        shown.map(tag => h(Chip, {
          key: tag.key, tag, title: t('picker'),
          onClick: event => openPicker(sessionId, event.currentTarget.getBoundingClientRect()),
        })),
        tags.length > 3 ? h('span', { className: 'bt-more' }, `+${tags.length - 3}`) : null,
        h('button', {
          type: 'button', className: 'bt-add-tag',
          onClick: event => openPicker(sessionId, event.currentTarget.getBoundingClientRect()),
          title: t('headerAdd'),
        }, '+ ' + t('headerAdd')))
    }

    /* ------------------------------------------------------------------ */
    /* tag picker overlay                                                  */
    /* ------------------------------------------------------------------ */

    function PickerOverlay () {
      const current = useOverlay()
      const snap = useStore()
      const [draft, setDraft] = useState('')
      const [tempDraft, setTempDraft] = useState('')
      const notice = snap.notice
      if (!current.open || current.sessionId === null) {
        return notice === null || notice === undefined
          ? null
          : h('div', { className: 'bt-toast' }, notice)
      }
      const sessionId = current.sessionId
      const meta = snap.sessions[sessionId]
      const selected = new Set(meta?.tagIds ?? [])
      const rect = current.rect
      const width = 248
      const height = Math.min(420, 84 + snap.tags.length * 28)
      const left = Math.max(8, Math.min(rect?.left ?? 16, window.innerWidth - width - 8))
      const top = Math.min(rect?.bottom ?? 64, window.innerHeight - height - 8) + 6

      const create = async () => {
        const name = draft.trim()
        if (name === '') return
        const tag = await createTag(name)
        setDraft('')
        if (tag !== null) await toggleTag(sessionId, tag.id)
      }

      const head = h('div', { className: 'bt-picker-head' }, t('picker'))
      const empty = snap.tags.length === 0 ? h('div', { className: 'bt-picker-empty' }, t('noTags')) : null
      const rows = snap.tags.map(tag => h('button', {
        key: tag.id, type: 'button',
        className: 'bt-pick-row' + (selected.has(tag.id) ? ' is-on' : ''),
        onClick: () => { void toggleTag(sessionId, tag.id) },
      },
      h('span', { className: 'bt-swatch', style: { background: tag.color } }),
      h('span', { className: 'bt-pick-name' }, tag.name),
      selected.has(tag.id) ? h('span', { className: 'bt-pick-check' }, h(CheckIcon, { size: 11 })) : null))
      const list = h('div', { className: 'bt-picker-list' }, rows)
      const newRow = h('div', { className: 'bt-picker-new' },
        h('input', {
          className: 'bt-input', value: draft, placeholder: t('createPlaceholder'), maxLength: 16,
          onChange: event => setDraft(event.target.value),
          onKeyDown: event => { if (event.key === 'Enter') void create() },
        }),
        h('button', { type: 'button', className: 'bt-btn', onClick: () => { void create() } }, t('create')))
      const manage = h('button', {
        type: 'button', className: 'bt-link',
        onClick: () => {
          closePicker()
          commitUi({ manager: true })
          selectPanel(PANEL_ID)
        },
      }, t('manageFromPicker'))
      const inline = inlineTagsOf(sessionId)
      const tempSection = h('div', { className: 'bt-picker-sect' }, t('tempSection'))
      const tempRows = inline.map(tag => h('div', { key: `inline:${tag.name}`, className: 'bt-temp-row' },
        h('span', { className: 'bt-swatch is-temp', style: { borderColor: tag.color } }),
        h('span', { className: 'bt-pick-name' }, tag.name),
        h('button', {
          type: 'button', className: 'bt-temp-action',
          onClick: () => { void promoteInlineTag(sessionId, tag.name) },
        }, t('promote')),
        h('button', {
          type: 'button', className: 'bt-temp-action',
          onClick: () => { void removeInlineTag(sessionId, tag.name) },
        }, t('remove'))))
      const tempList = h('div', { className: 'bt-temp-list' }, tempRows)
      const tempNew = h('div', { className: 'bt-picker-new' },
        h('input', {
          className: 'bt-input', value: tempDraft, placeholder: t('tempPlaceholder'), maxLength: 16,
          onChange: event => setTempDraft(event.target.value),
          onKeyDown: event => { if (event.key === 'Enter') { void addInlineTag(sessionId, tempDraft).then(() => setTempDraft('')) } },
        }),
        h('button', {
          type: 'button', className: 'bt-btn',
          onClick: () => { void addInlineTag(sessionId, tempDraft).then(() => setTempDraft('')) },
        }, t('tempCreate')))
      const picker = h('div', { className: 'bt-picker', style: { left, top, width } },
        head, empty, list, newRow, tempSection, tempList, tempNew, manage)
      const overlayElement = h('div', {
        className: 'bt-overlay',
        onMouseDown: event => { if (event.target === event.currentTarget) closePicker() },
      }, picker)
      const toast = notice === null || notice === undefined ? null : h('div', { className: 'bt-toast' }, notice)
      return toast === null ? overlayElement : h(React.Fragment, null, toast, overlayElement)
    }

    /* ------------------------------------------------------------------ */
    /* overview panel                                                      */
    /* ------------------------------------------------------------------ */

    function statusOf (sessionId, statuses, sessions) {
      const state = statuses?.get?.(sessionId)
      const done = sessions[sessionId]?.done === true
      if (state?.pendingInteraction != null) return 'pending'
      if (state?.completionUnread === true) return 'unread'
      if (state?.running === true) return 'running'
      if (done) return 'done'
      return 'idle'
    }

    const RANK = { pending: 0, unread: 1, running: 2, done: 3, idle: 4 }

    function OverviewPanel (props) {
      const ids = props.useSessions(state => state.ids)
      const byId = props.useSessions(state => state.byId)
      const workspaceItems = props.useWorkspaces(state => state.items)
      const archivedIds = props.useWorkspaces(state => state.archivedSessionIds)
      const statuses = props.useSessionStatus(map => map)
      const snap = useStore()
      const currentUi = useUi()
      const [filterTag, setFilterTag] = useState(null)
      const [showArchived, setShowArchived] = useState(false)
      const [importText, setImportText] = useState('')
      const [report, setReport] = useState(null)
      const fileRef = useRef(null)

      const archived = new Set(archivedIds ?? [])
      const workspaceOf = new Map()
      for (const workspace of workspaceItems ?? []) {
        for (const sessionId of workspace.sessionIds ?? []) workspaceOf.set(sessionId, workspace.title ?? workspace.path)
      }

      const all = []
      for (const id of ids ?? []) {
        const summary = byId?.[id]
        if (summary === undefined || summary.blank === true) continue
        all.push(summary)
      }
      const visible = all
        .filter(summary => showArchived || !archived.has(summary.id))
        .filter(summary => filterTag === null || (snap.sessions[summary.id]?.tagIds ?? []).includes(filterTag))
        .map(summary => ({ summary, status: statusOf(summary.id, statuses, snap.sessions) }))
        .sort((a, b) => (RANK[a.status] - RANK[b.status]) || ((b.summary.updatedAt ?? 0) - (a.summary.updatedAt ?? 0)))

      const counts = { pending: 0, unread: 0, running: 0, done: 0 }
      for (const summary of all) {
        if (archived.has(summary.id) && !showArchived) continue
        const status = statusOf(summary.id, statuses, snap.sessions)
        if (counts[status] !== undefined) counts[status] += 1
      }

      const openSession = sessionId => {
        try { openSessionById(sessionId) } catch { /* ignore */ }
        selectPanel(null)
      }

      const doImport = async () => {
        let pack
        try {
          pack = JSON.parse(importText)
        } catch {
          notify(t('importBad'))
          return
        }
        const result = await importPack(pack)
        if (result !== null) {
          setReport(result)
          setImportText('')
          commitUi({ importOpen: false })
        }
      }

      const pickFile = async file => {
        if (!file) return
        try { setImportText(await file.text()) } catch { /* ignore */ }
      }

      return h('div', { className: 'bt-panel' },
        h('div', { className: 'bt-panel-head' },
          h('div', null,
            h('h2', { className: 'bt-panel-title' }, t('title')),
            h('div', { className: 'bt-panel-sub' }, t('subtitle'))),
          h('div', { className: 'bt-toolbar' },
            h('button', { type: 'button', className: 'bt-btn', onClick: () => { void exportPack() } }, t('export')),
            h('button', { type: 'button', className: 'bt-btn', onClick: () => commitUi({ importOpen: true }) }, t('import')),
            h('button', { type: 'button', className: 'bt-btn', onClick: () => commitUi({ manager: true }) }, t('manage')))),
        h('div', { className: 'bt-counts' },
          h('span', { className: 'bt-count is-pending' }, t('pending') + ' ', h('b', null, String(counts.pending))),
          h('span', { className: 'bt-count is-unread' }, t('unread') + ' ', h('b', null, String(counts.unread))),
          h('span', { className: 'bt-count is-running' }, t('running') + ' ', h('b', null, String(counts.running))),
          h('span', { className: 'bt-count is-done' }, t('done') + ' ', h('b', null, String(counts.done))),
          h('span', { className: 'bt-count' }, t('total') + ' ', h('b', null, String(all.length)))),
        h('div', { className: 'bt-filters' },
          h('button', {
            type: 'button', className: 'bt-filter' + (filterTag === null ? ' is-on' : ''),
            onClick: () => setFilterTag(null),
          }, t('all')),
          snap.tags.map(tag => h('button', {
            key: tag.id, type: 'button',
            className: 'bt-filter' + (filterTag === tag.id ? ' is-on' : ''),
            style: filterTag === tag.id ? { borderColor: tag.color, color: tag.color } : undefined,
            onClick: () => setFilterTag(filterTag === tag.id ? null : tag.id),
          }, tag.name)),
          h('label', { className: 'bt-archived' },
            h('input', { type: 'checkbox', checked: showArchived, onChange: event => setShowArchived(event.target.checked) }),
            t('showArchived'))),
        snap.phase === 'error' ? h('div', { className: 'bt-empty' },
          t('loadError'), h('button', { type: 'button', className: 'bt-btn', onClick: () => { void refresh() } }, t('retry'))) : null,
        visible.length === 0 ? h('div', { className: 'bt-empty' }, t('empty')) : null,
        h('div', { className: 'bt-list' },
          visible.map(({ summary, status }) => h('div', {
            key: summary.id,
            className: 'bt-row',
            role: 'button',
            tabIndex: 0,
            onClick: () => openSession(summary.id),
            onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openSession(summary.id) } },
          },
          h('span', { className: `bt-dot is-${status}` }),
          h('span', { className: 'bt-row-title' }, summary.displayTitle || summary.title || String(summary.id)),
          h('span', { className: 'bt-row-ws' }, workspaceOf.get(summary.id) ?? '—'),
          h('span', { className: 'bt-row-tags' },
            sessionTags(summary.id).slice(0, 3).map(tag => h(Chip, { key: tag.key, tag })),
            sessionTags(summary.id).length > 3 ? h('span', { className: 'bt-more' }, `+${sessionTags(summary.id).length - 3}`) : null),
          h('span', { className: 'bt-row-status' }, t(status))))),
        report !== null ? h('div', { className: 'bt-toast' },
          t('importReportTitle') + ' · ' + t('importReport', {
            added: report.added.length, skipped: report.skipped.length, conflicts: report.conflicts.length,
          }),
          h('button', { type: 'button', className: 'bt-link', onClick: () => setReport(null) }, t('close'))) : null,
        currentUi.manager ? h(ManagerModal, { snap }) : null,
        currentUi.importOpen ? h(ImportModal, { importText, setImportText, onPick: pickFile, onRun: doImport, fileRef }) : null)
    }

    function ManagerModal ({ snap }) {
      return h('div', { className: 'bt-modal-back', onMouseDown: event => { if (event.target === event.currentTarget) commitUi({ manager: false }) } },
        h('div', { className: 'bt-modal' },
          h('div', { className: 'bt-modal-head' }, t('manage')),
          h('div', { className: 'bt-manager' },
            snap.tags.length === 0 ? h('div', { className: 'bt-picker-empty' }, t('noTags')) : null,
            snap.tags.map(tag => h('div', { key: tag.id, className: 'bt-manager-row' },
              h('input', {
                className: 'bt-input bt-manager-name',
                defaultValue: tag.name,
                maxLength: 16,
                onBlur: event => { if (event.target.value.trim() !== tag.name) void updateTag(tag.id, { name: event.target.value }) },
                onKeyDown: event => { if (event.key === 'Enter') event.currentTarget.blur() },
              }),
              h('span', { className: 'bt-swatches' },
                ['#7c9cff', '#f0a35e', '#67c98a', '#c084fc', '#5ec8d8', '#6ea8fe', '#f07a7a', '#9aa0ad', '#b58cff', '#e0a3ff', '#ffb86b', '#8fd694'].map(color => h('button', {
                  key: color, type: 'button',
                  className: 'bt-swatch-btn' + (tag.color === color ? ' is-on' : ''),
                  style: { background: color },
                  'aria-label': color,
                  onClick: () => { void updateTag(tag.id, { color }) },
                })))),
            h('button', {
              type: 'button', className: 'bt-btn bt-danger',
              onClick: () => { if (window.confirm(t('deleteConfirm'))) void deleteTag(tag.id) },
            }, t('delete')))),
          h('div', { className: 'bt-modal-foot' },
            h('button', { type: 'button', className: 'bt-btn', onClick: () => commitUi({ manager: false }) }, t('close')))))
    }

    function ImportModal ({ importText, setImportText, onPick, onRun, fileRef }) {
      return h('div', { className: 'bt-modal-back', onMouseDown: event => { if (event.target === event.currentTarget) commitUi({ importOpen: false }) } },
        h('div', { className: 'bt-modal' },
          h('div', { className: 'bt-modal-head' }, t('importTitle')),
          h('div', { className: 'bt-modal-hint' }, t('importHint')),
          h('textarea', {
            className: 'bt-textarea', value: importText, spellCheck: false, rows: 8,
            onChange: event => setImportText(event.target.value),
          }),
          h('div', { className: 'bt-modal-foot' },
            h('input', {
              ref: fileRef, type: 'file', accept: 'application/json,.json', style: { display: 'none' },
              onChange: event => { void onPick(event.target.files?.[0]) },
            }),
            h('button', { type: 'button', className: 'bt-btn', onClick: () => fileRef.current?.click() }, t('importFile')),
            h('button', { type: 'button', className: 'bt-btn', onClick: () => commitUi({ importOpen: false }) }, t('cancel')),
            h('button', { type: 'button', className: 'bt-btn is-primary', onClick: onRun }, t('importRun')))))
    }

    function PanelIcon () {
      return h(TagIcon, { size: 16 })
    }

    /* ------------------------------------------------------------------ */
    /* styles                                                              */
    /* ------------------------------------------------------------------ */

    const CSS = `
.bt-row-tags{display:inline-flex;align-items:center;gap:3px;overflow:hidden;flex:0 1 auto}
[class*="rowResting"]{display:flex;align-items:center}
[class*="rowResting"] > span:has(.bt-row-tags){order:-1}
[class*="rowResting"] .bt-row-tags{order:-1}
.bt-chip{display:inline-flex;align-items:center;height:16px;max-width:64px;padding:0 5px;border-radius:3px;border:1px solid transparent;font-size:10px;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:0 0 auto}
.bt-chip-button{cursor:pointer;font:inherit;font-size:10px}
.bt-chip.is-temp{border-style:dashed;background:transparent}
.bt-chip.is-temp::before{content:'';width:4px;height:4px;border-radius:50%;background:currentColor;opacity:.75;margin-right:3px}
.bt-picker-sect{font-size:10px;letter-spacing:.4px;color:var(--dsw-alias-text-3,rgba(127,127,127,.9));border-top:1px solid var(--dsw-alias-border-1,rgba(127,127,127,.22));padding-top:7px;margin-top:2px}
.bt-temp-list{display:flex;flex-direction:column;gap:1px}
.bt-temp-row{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:5px}
.bt-temp-row:hover{background:var(--dsw-alias-bg-3,rgba(127,127,127,.13))}
.bt-temp-row .bt-pick-name{flex:1}
.bt-temp-action{border:0;background:transparent;color:var(--dsw-alias-text-3,rgba(127,127,127,.95));font:inherit;font-size:10.5px;cursor:pointer;padding:2px 4px;border-radius:3px}
.bt-temp-action:hover{background:var(--dsw-alias-bg-3,rgba(127,127,127,.16));color:var(--dsw-alias-text-1,inherit)}
.bt-swatch.is-temp{background:transparent !important;border:1px dashed currentColor}
.bt-chip-button:hover{filter:brightness(1.15)}
.bt-stamp{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:4px;border:1px solid rgba(79,191,130,.55);color:#4fbf82;flex:0 0 auto}
.bt-more{font-size:9.5px;color:var(--dsw-alias-text-3,rgba(127,127,127,.9));flex:0 0 auto}
.bt-action{display:grid;place-items:center;width:20px;height:20px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-text-3,rgba(120,125,135,.95));cursor:pointer}
.bt-action:hover{background:var(--dsw-alias-bg-3,rgba(127,127,127,.14));color:var(--dsw-alias-text-1,inherit)}
.bt-action.is-on{color:#4fbf82}
.bt-menuitem{display:flex;align-items:center;gap:8px;width:100%;border:0;background:transparent;color:var(--dsw-alias-text-1,inherit);font:inherit;font-size:12px;text-align:left;padding:6px 8px;border-radius:5px;cursor:pointer}
.bt-menuitem:hover{background:var(--dsw-alias-bg-3,rgba(127,127,127,.14))}
.bt-menu-count{margin-left:auto;color:var(--dsw-alias-text-3,rgba(127,127,127,.9));font-size:11px}
.bt-hover{display:flex;flex-direction:column;gap:4px;margin:4px 0 6px;min-width:0}
.bt-hover-head{font-size:10px;letter-spacing:.4px;text-transform:uppercase;color:var(--dsw-alias-text-3,rgba(127,127,127,.9))}
.bt-hover-chips{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.bt-head-tags{display:inline-flex;align-items:center;gap:4px;min-width:0;overflow:hidden;flex:0 1 auto}
.bt-head-tags .bt-chip{height:20px;max-width:110px;font-size:11px;padding:0 7px}
.bt-add-tag{height:20px;border:1px dashed var(--dsw-alias-border-2,rgba(127,127,127,.45));border-radius:4px;background:transparent;color:var(--dsw-alias-text-3,rgba(127,127,127,.9));font-size:11px;padding:0 7px;cursor:pointer;flex:0 0 auto}
.bt-add-tag:hover{color:var(--dsw-alias-text-1,inherit)}
.bt-overlay{position:fixed;inset:0;z-index:2147483000;pointer-events:auto}
.bt-picker{position:fixed;background:var(--dsw-alias-bg-1,#1e2129);border:1px solid var(--dsw-alias-border-1,rgba(127,127,127,.3));border-radius:10px;box-shadow:0 16px 44px rgba(0,0,0,.45);padding:8px;display:flex;flex-direction:column;gap:6px;max-height:440px}
.bt-picker-head{font-size:11px;color:var(--dsw-alias-text-3,rgba(127,127,127,.9));padding:2px 4px}
.bt-picker-list{overflow:auto;display:flex;flex-direction:column;gap:1px}
.bt-pick-row{display:flex;align-items:center;gap:8px;border:0;background:transparent;color:var(--dsw-alias-text-1,inherit);font:inherit;font-size:12px;text-align:left;padding:6px;border-radius:5px;cursor:pointer}
.bt-pick-row:hover,.bt-pick-row.is-on{background:var(--dsw-alias-bg-3,rgba(127,127,127,.13))}
.bt-pick-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-pick-check{color:#4fbf82;display:flex}
.bt-picker-empty{font-size:11.5px;color:var(--dsw-alias-text-3,rgba(127,127,127,.9));padding:6px}
.bt-picker-new{display:flex;gap:5px;border-top:1px solid var(--dsw-alias-border-1,rgba(127,127,127,.22));padding-top:7px}
.bt-input{flex:1;min-width:0;height:26px;border-radius:5px;border:1px solid var(--dsw-alias-border-2,rgba(127,127,127,.4));background:var(--dsw-alias-bg-2,rgba(127,127,127,.08));color:var(--dsw-alias-text-1,inherit);font:inherit;font-size:12px;padding:0 8px}
.bt-btn{height:26px;border-radius:5px;border:1px solid var(--dsw-alias-border-2,rgba(127,127,127,.4));background:var(--dsw-alias-bg-2,rgba(127,127,127,.08));color:var(--dsw-alias-text-1,inherit);font:inherit;font-size:12px;padding:0 10px;cursor:pointer}
.bt-btn:hover{background:var(--dsw-alias-bg-3,rgba(127,127,127,.16))}
.bt-btn.is-primary{background:#3b5bd6;border-color:#3b5bd6;color:#fff}
.bt-btn.bt-danger{color:#f07a7a;border-color:rgba(240,122,122,.4)}
.bt-link{border:0;background:transparent;color:var(--dsw-alias-text-3,rgba(127,127,127,.95));font:inherit;font-size:12px;text-align:left;padding:4px;cursor:pointer;text-decoration:underline}
.bt-swatch{width:8px;height:8px;border-radius:2px;flex:0 0 auto}
.bt-per{display:none}
.bt-panel{padding:20px 24px 40px;height:100%;overflow:auto;color:var(--dsw-alias-text-1,inherit)}
.bt-panel-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:10px;flex-wrap:wrap}
.bt-panel-title{margin:0;font-size:16px;font-weight:600}
.bt-panel-sub{font-size:11.5px;color:var(--dsw-alias-text-3,rgba(127,127,127,.9));margin-top:2px}
.bt-toolbar{display:flex;gap:6px;margin-left:auto;flex-wrap:wrap}
.bt-counts{display:flex;gap:16px;flex-wrap:wrap;font-size:11.5px;color:var(--dsw-alias-text-3,rgba(127,127,127,.95));margin:8px 0 12px}
.bt-count b{color:var(--dsw-alias-text-1,inherit);font-weight:600;margin-left:2px}
.bt-count.is-pending b{color:#f0a35e}
.bt-count.is-unread b{color:#4fbf82}
.bt-count.is-running b{color:#5b8cff}
.bt-filters{display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
.bt-filter{height:22px;border-radius:999px;border:1px solid var(--dsw-alias-border-2,rgba(127,127,127,.35));background:transparent;color:var(--dsw-alias-text-3,rgba(127,127,127,.95));font:inherit;font-size:11px;padding:0 9px;cursor:pointer}
.bt-filter.is-on{border-color:#4a5a8a;background:rgba(74,90,138,.18);color:var(--dsw-alias-text-1,inherit)}
.bt-archived{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--dsw-alias-text-3,rgba(127,127,127,.9));margin-left:6px}
.bt-list{display:flex;flex-direction:column;gap:1px}
.bt-row{display:flex;align-items:center;gap:10px;padding:7px 9px;border-radius:7px;cursor:pointer;min-width:0}
.bt-row:hover{background:var(--dsw-alias-bg-3,rgba(127,127,127,.12))}
.bt-row-title{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px}
.bt-row-ws{flex:0 0 96px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;color:var(--dsw-alias-text-3,rgba(127,127,127,.9))}
.bt-row-tags{display:flex;gap:3px;flex:0 1 auto;overflow:hidden;max-width:240px}
.bt-row-status{flex:0 0 62px;text-align:right;font-size:11px;color:var(--dsw-alias-text-3,rgba(127,127,127,.95));white-space:nowrap}
.bt-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto;background:#454a55}
.bt-dot.is-pending{background:#f0a35e}
.bt-dot.is-unread{background:#4fbf82}
.bt-dot.is-running{background:#5b8cff;box-shadow:0 0 0 3px rgba(91,140,255,.12)}
.bt-dot.is-done{background:transparent;border:1px solid #4fbf82}
.bt-empty{padding:22px 4px;color:var(--dsw-alias-text-3,rgba(127,127,127,.9));font-size:12px;display:flex;gap:8px;align-items:center}
.bt-toast{pointer-events:none;position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--dsw-alias-bg-1,#1e2129);border:1px solid var(--dsw-alias-border-1,rgba(127,127,127,.3));border-radius:8px;padding:8px 12px;font-size:12px;display:flex;gap:10px;align-items:center;box-shadow:0 10px 30px rgba(0,0,0,.4);z-index:2147483001}
.bt-modal-back{position:fixed;inset:0;background:rgba(0,0,0,.45);display:grid;place-items:center;z-index:2147483002}
.bt-modal{width:min(560px,90vw);max-height:80vh;overflow:auto;background:var(--dsw-alias-bg-1,#1e2129);border:1px solid var(--dsw-alias-border-1,rgba(127,127,127,.3));border-radius:12px;padding:16px;box-shadow:0 24px 60px rgba(0,0,0,.5)}
.bt-modal-head{font-size:14px;font-weight:600;margin-bottom:8px}
.bt-modal-hint{font-size:12px;color:var(--dsw-alias-text-3,rgba(127,127,127,.9));margin-bottom:8px}
.bt-manager{display:flex;flex-direction:column;gap:8px;max-height:52vh;overflow:auto}
.bt-manager-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.bt-manager-name{flex:0 0 150px}
.bt-swatches{display:flex;gap:4px;flex-wrap:wrap}
.bt-swatch-btn{width:14px;height:14px;border-radius:3px;border:1px solid transparent;cursor:pointer;padding:0}
.bt-swatch-btn.is-on{outline:2px solid var(--dsw-alias-text-1,#fff);outline-offset:1px}
.bt-textarea{width:100%;min-height:140px;border-radius:8px;border:1px solid var(--dsw-alias-border-2,rgba(127,127,127,.4));background:var(--dsw-alias-bg-2,rgba(127,127,127,.08));color:var(--dsw-alias-text-1,inherit);font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;padding:8px;resize:vertical}
.bt-modal-foot{display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap}
`

    function installStyles () {
      try {
        if (typeof styles !== 'undefined' && styles !== null && typeof styles.insert === 'function') return styles.insert(CSS)
      } catch { /* fall through */ }
      const element = document.createElement('style')
      element.setAttribute('data-dsh-better-tag', '')
      element.textContent = CSS
      document.head.appendChild(element)
      return () => { element.remove() }
    }

    /* ------------------------------------------------------------------ */
    /* apply                                                               */
    /* ------------------------------------------------------------------ */

    let ctxRef = {}

    function service (name) {
      try { return ctxRef.get?.(name) } catch { return undefined }
    }

    function selectPanel (key) {
      try { service('layout')?.selectPanel?.(key) } catch { /* ignore */ }
    }

    function openSessionById (sessionId) {
      try { service('uiWorkspace')?.openSession?.(sessionId) } catch { /* ignore */ }
    }

    function installLocale (ctx) {
      try {
        if (ctx?.locale === undefined) return
        ctx.locale.register(NS, DICTS)
        translate = ctx.locale.bind(NS)
      } catch (error) {
        console.warn('[dsh-better-tag] locale registration failed; keeping Chinese copy', error)
      }
    }

    function MenuClearTempItem ({ sessionId, useMenuOpenState }) {
      const [, setMenuOpen] = useMenuOpenState()
      const { meta } = useSessionMeta(sessionId)
      if ((meta?.inlineTags?.length ?? 0) === 0) return null
      return h('button', {
        type: 'button', role: 'menuitem', className: 'bt-menuitem',
        onClick: () => { setMenuOpen(false); void saveSession(sessionId, { inlineTags: [] }) },
      }, t('menuClearTemp'))
    }

    function apply (ctx) {
      ctxRef = ctx
      installLocale(ctx)
      const disposers = []
      try {
        const disposeStyles = installStyles()
        if (typeof disposeStyles === 'function') disposers.push(disposeStyles)
      } catch (error) {
        console.warn('[dsh-better-tag] styles failed', error)
      }

      const contribute = (ownerKey, options, Component) => {
        try {
          disposers.push(ctx.slots.inject(ownerKey, () => ctx.slots.register(options, Component)))
        } catch (error) {
          console.warn('[dsh-better-tag] slot registration failed', ownerKey, error)
        }
      }

      contribute('sidebar.session.row.trailing', {
        name: 'sidebar.session.row.trailing', id: 'better-tag-chips', order: 100, locale: NS,
      }, RowTags)
      contribute('sidebar.session.row.hover', {
        name: 'sidebar.session.row.hover', id: 'better-tag-hover', order: 10, locale: NS,
      }, HoverTags)
      contribute('sidebar.workspaces.session.row.action', {
        name: 'sidebar.workspaces.session.row.action', id: 'better-tag-done', order: 150, locale: NS,
      }, DoneAction)
      contribute('sidebar.workspaces.session.menu.item', {
        name: 'sidebar.workspaces.session.menu.item', id: 'better-tag-menu-clear-temp', order: 390, locale: NS,
      }, MenuClearTempItem)
      contribute('sidebar.workspaces.session.menu.item', {
        name: 'sidebar.workspaces.session.menu.item', id: 'better-tag-menu-done', order: 400, locale: NS,
      }, MenuDoneItem)
      contribute('sidebar.workspaces.session.menu.item', {
        name: 'sidebar.workspaces.session.menu.item', id: 'better-tag-menu-tags', order: 410, locale: NS,
      }, MenuTagsItem)
      contribute('conversation.session.header.actions', {
        name: 'conversation.session.header.actions', id: 'better-tag-header', order: 60, locale: NS,
      }, HeaderTags)
      contribute('shell.overlay', {
        name: 'shell.overlay', id: 'better-tag-picker', order: 60, locale: NS,
      }, PickerOverlay)
      contribute('main', { name: 'main', key: PANEL_ID, locale: NS }, OverviewPanel)
      contribute('sidebar.panellist', {
        name: 'sidebar.panellist', id: PANEL_ID, order: 55, locale: NS,
        label: () => t('nav'),
      }, PanelIcon)

      void refresh()

      try {
        const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
        document.addEventListener('visibilitychange', onVisible)
        disposers.push(() => document.removeEventListener('visibilitychange', onVisible))
      } catch { /* ignore */ }

      return () => {
        for (const dispose of disposers.reverse()) {
          try { dispose() } catch { /* ignore */ }
        }
      }
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
