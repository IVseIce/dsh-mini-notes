/**
 * dsh-mini-notes — Client half.
 *
 * 一个从标题栏按钮展开的「记事本」窗口：
 *   · 按钮在会话标题栏右侧（conversation.session.header.utilities），出现位置
 *     就贴着按钮下方，像从按钮里展开一样
 *   · 一个窗口里用标签页装多张便签，标签可切换、可关、可新增（浏览器式）
 *   · 窗口可拖动、可拉伸，位置和大小都记住
 *   · 输入即存（localStorage，防抖落盘），刷新后原样回来
 *   · 可钉住：钉住时点别处不收起，未钉住时点别处就收起
 *   · 关闭标签不销毁内容，而是进「回收站」：可恢复、可彻底删除
 *
 * 刻意做到最小：一个模块级 store + 两个组件，没有 Host 逻辑、没有网络请求、
 * 不订阅任何会话事件。关着的时候覆盖层组件直接返回 null。
 */
window.__ModuleLoader__.load({
  id: 'dsh-mini-notes',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useSyncExternalStore } = React

    /** Locale namespace owned by this plugin. */
    const NS = 'mini-notes'
    /** Storage key; a shape change bumps the version suffix. */
    const KEY = 'dsh-mini-notes.v2'

    const DEFAULT_W = 400
    const DEFAULT_H = 460
    const MIN_W = 280
    const MIN_H = 220
    const EDGE = 8

    const zh = {
      'button.label': '便签',
      'button.hint': '便签（可开多页）',
      'note.placeholder': '写点什么…',
      'note.tab': '便签 {n}',
      'note.drag': '拖动窗口',
      'note.add': '新建一页',
      'note.close': '关闭这一页',
      'note.hide': '收起便签',
      'note.pin': '钉住（点别处不收起）',
      'note.unpin': '取消钉住（点别处收起）',
      'note.saved': '已保存',
      'note.pages': '{n} 页',
      'zoom.in': '放大',
      'zoom.out': '缩小',
      'zoom.reset': '恢复 100%',
      'note.empty': '暂无内容',
      'confirm.cancel': '取消',
      'confirm.ok': '彻底删除',
      'trash.title': '回收站',
      'trash.open': '回收站',
      'trash.back': '返回便签',
      'trash.restore': '恢复这一页',
      'trash.purge': '彻底删除',
      'trash.purgeConfirm': '彻底删除这一页？不可撤销。',
      'trash.clear': '清空回收站',
      'trash.clearConfirm': '清空回收站？不可撤销。',
      'trash.empty': '回收站是空的',
      'trash.hint': '点一条即可恢复',
      'trash.count': '{n} 项',
      'trash.justNow': '刚刚',
      'trash.minutes': '{n} 分钟前',
      'trash.hours': '{n} 小时前',
      'trash.days': '{n} 天前'
    }
    const en = {
      'button.label': 'Notes',
      'button.hint': 'Notes (several pages)',
      'note.placeholder': 'Write something…',
      'note.tab': 'Note {n}',
      'note.drag': 'Drag window',
      'note.add': 'New page',
      'note.close': 'Close this page',
      'note.hide': 'Hide notes',
      'note.pin': 'Pin (stays when clicking away)',
      'note.unpin': 'Unpin (closes on click away)',
      'note.saved': 'Saved',
      'note.pages': '{n} pages',
      'zoom.in': 'Zoom in',
      'zoom.out': 'Zoom out',
      'zoom.reset': 'Reset to 100%',
      'note.empty': 'Empty',
      'confirm.cancel': 'Cancel',
      'confirm.ok': 'Delete',
      'trash.title': 'Trash',
      'trash.open': 'Trash',
      'trash.back': 'Back to notes',
      'trash.restore': 'Restore this page',
      'trash.purge': 'Delete forever',
      'trash.purgeConfirm': 'Delete this page for good?',
      'trash.clear': 'Empty trash',
      'trash.clearConfirm': 'Empty the trash for good?',
      'trash.empty': 'Trash is empty',
      'trash.hint': 'Click a row to restore it',
      'trash.count': '{n} items',
      'trash.justNow': 'just now',
      'trash.minutes': '{n} min ago',
      'trash.hours': '{n} h ago',
      'trash.days': '{n} d ago'
    }

    // ---------------------------------------------------------------- store
    //
    // Shape: { notes: [{ id, text }], activeId, open, pinned, box: {x,y,w,h} }
    // `box` is null until the panel has been placed; it then follows dragging
    // and resizing. Everything is one small JSON object, replaced on change.

    const MAX_TRASH = 2000

    const fresh = () => ({
      notes: [],
      activeId: 0,
      open: false,
      pinned: false,
      box: null,
      seq: 0,
      trash: [],
      view: 'note',
      zoom: 1,
      // In-panel confirmation, never persisted: { kind: 'purge', id } | { kind: 'clear' }
      pending: null
    })

    const isNum = (value) => typeof value === 'number' && Number.isFinite(value)

    function viewport() {
      return { w: window.innerWidth || 1280, h: window.innerHeight || 800 }
    }

    /** Clamp a window box into the viewport, keeping a usable minimum. */
    function fitBox(box) {
      const vp = viewport()
      const w = Math.min(Math.max(MIN_W, isNum(box.w) ? box.w : DEFAULT_W), Math.max(MIN_W, vp.w - EDGE * 2))
      const ht = Math.min(Math.max(MIN_H, isNum(box.h) ? box.h : DEFAULT_H), Math.max(MIN_H, vp.h - EDGE * 2))
      const x = Math.min(Math.max(EDGE, isNum(box.x) ? box.x : EDGE), Math.max(EDGE, vp.w - w - EDGE))
      const y = Math.min(Math.max(EDGE, isNum(box.y) ? box.y : EDGE), Math.max(EDGE, vp.h - ht - EDGE))
      return { x, y, w, h: ht }
    }

    /** Carry the earlier one-window-per-note format over as pages, once. */
    function migrateLegacy() {
      try {
        const legacy = window.localStorage.getItem('dsh-mini-notes.v1')
        if (!legacy) return null
        const data = JSON.parse(legacy)
        const list = data && Array.isArray(data.notes) ? data.notes : []
        const pages = []
        for (const item of list) {
          if (!item || typeof item.text !== 'string') continue
          pages.push({ id: pages.length + 1, text: item.text })
        }
        if (pages.length === 0) return null
        return {
          v: 2,
          notes: pages,
          activeId: pages[0].id,
          seq: pages.length,
          trash: [],
          view: 'note',
          open: list.some((item) => item && item.open === true),
          pinned: list.some((item) => item && item.pinned === true),
          box: null
        }
      } catch {
        return null
      }
    }

    /** Read persisted state, tolerating a missing or malformed entry. */
    function readStored() {
      try {
        const raw = window.localStorage.getItem(KEY)
        if (!raw) {
          const migrated = migrateLegacy()
          if (migrated === null) return fresh()
          try {
            window.localStorage.setItem(KEY, JSON.stringify(migrated))
            window.localStorage.removeItem('dsh-mini-notes.v1')
          } catch {
            /* storage unavailable: still use the migrated state in memory */
          }
          return {
            notes: migrated.notes,
            activeId: migrated.activeId,
            seq: migrated.seq,
            open: migrated.open,
            pinned: migrated.pinned,
            box: null,
            trash: [],
            view: 'note',
            zoom: 1,
            pending: null
          }
        }
        const data = JSON.parse(raw)
        if (!data || !Array.isArray(data.notes)) return fresh()
        const notes = []
        let seq = 0
        for (const item of data.notes) {
          if (!item || typeof item.text !== 'string') continue
          const id = isNum(item.id) ? item.id : seq + 1
          seq = Math.max(seq, id)
          notes.push({ id, text: item.text })
        }
        const activeId = notes.some((note) => note.id === data.activeId) ? data.activeId : (notes[0]?.id ?? 0)

        // Trash entries are whole pages plus when they were closed.
        const trash = []
        for (const item of Array.isArray(data.trash) ? data.trash : []) {
          if (!item || typeof item.text !== 'string') continue
          trash.push({
            id: isNum(item.id) ? item.id : trash.length + 1,
            text: item.text,
            at: isNum(item.at) ? item.at : 0
          })
        }
        const trashTop = trash.reduce((max, item) => Math.max(max, item.id), 0)

        return {
          notes,
          activeId,
          seq: Math.max(seq, trashTop, isNum(data.seq) ? data.seq : 0),
          open: data.open === true && (notes.length > 0 || trash.length > 0),
          pinned: data.pinned === true,
          box: data.box ? fitBox(data.box) : null,
          trash: trash.slice(0, MAX_TRASH),
          view: data.view === 'trash' || notes.length === 0 ? 'trash' : 'note',
          zoom: isNum(data.zoom) ? Math.min(2.5, Math.max(0.7, data.zoom)) : 1,
          pending: null
        }
      } catch {
        return fresh()
      }
    }

    let state = fresh()
    let loaded = false
    const listeners = new Set()
    let saveTimer = 0

    /** Load persisted state once, on first Client activation. */
    function load() {
      if (loaded) return
      loaded = true
      state = readStored()
    }

    function subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }

    function getSnapshot() {
      return state
    }

    function readButton() {
      return state.open
    }

    function persistNow() {
      if (saveTimer) {
        window.clearTimeout(saveTimer)
        saveTimer = 0
      }
      try {
        const { pending: _pending, ...rest } = state
        window.localStorage.setItem(KEY, JSON.stringify({ ...rest, v: 2 }))
      } catch {
        /* storage unavailable or full: keep typing, skip persistence */
      }
    }

    function schedulePersist() {
      if (saveTimer) return
      saveTimer = window.setTimeout(persistNow, 300)
    }

    function commit(next) {
      if (next === state) return
      state = next
      for (const listener of [...listeners]) listener()
      schedulePersist()
    }

    /** Where the panel should appear when the button opens it. */
    let anchor = null

    function placeBox() {
      const vp = viewport()
      const w = DEFAULT_W
      const ht = DEFAULT_H
      const right = anchor ? anchor.right : vp.w - 24
      const below = anchor ? anchor.bottom : 64
      return fitBox({ x: right - w, y: below + 8, w, h: ht })
    }

    function openPanel() {
      const box = fitBox(state.box ?? placeBox())
      if (state.notes.length > 0) {
        commit({ ...state, open: true, box })
        return
      }
      // Nothing open but something in the trash: show the trash instead of
      // silently creating a blank page over it.
      if (state.trash.length > 0) {
        commit({ ...state, open: true, box, view: 'trash' })
        return
      }
      const id = state.seq + 1
      commit({
        ...state,
        seq: id,
        notes: [{ id, text: '' }],
        activeId: id,
        open: true,
        box,
        view: 'note'
      })
    }

    function closePanel() {
      if (!state.open) return
      persistNow()
      commit({ ...state, open: false })
    }

    function togglePanel() {
      if (state.open) closePanel()
      else openPanel()
    }

    function setPinned(pinned) {
      commit({ ...state, pinned })
    }

    function setActive(id) {
      if (id === state.activeId) return
      commit({ ...state, activeId: id })
    }

    /** Replace a page's text. The textarea owns the caret and newlines; this
     *  only records what is already on screen. */
    function setText(id, text) {
      const note = state.notes.find((item) => item.id === id)
      if (!note || note.text === text) return
      commit({
        ...state,
        notes: state.notes.map((item) => (item.id === id ? { ...item, text } : item))
      })
    }

    function addNote() {
      const id = state.seq + 1
      commit({ ...state, seq: id, notes: [...state.notes, { id, text: '' }], activeId: id, open: true, view: 'note' })
    }

    /** Close a page: it moves to the trash instead of disappearing. */
    function removeNote(id) {
      const index = state.notes.findIndex((note) => note.id === id)
      if (index < 0) return
      const closed = state.notes[index]
      const notes = state.notes.filter((note) => note.id !== id)
      const trash = [{ id: closed.id, text: closed.text, at: Date.now() }, ...state.trash].slice(0, MAX_TRASH)
      if (notes.length === 0) {
        // No pages left: keep the window open on the trash so the closed page is
        // visibly recoverable instead of seeming lost.
        persistNow()
        commit({ ...state, notes: [], activeId: 0, trash, view: 'trash' })
        return
      }
      const activeId = state.activeId === id ? notes[Math.max(0, index - 1)].id : state.activeId
      commit({ ...state, notes, activeId, trash })
    }

    function setView(view) {
      if (view === state.view) return
      // Returning to the editor with no pages left would show an empty panel, so
      // hand the user a fresh blank page instead.
      if (view === 'note' && state.notes.length === 0) {
        const id = state.seq + 1
        commit({ ...state, seq: id, notes: [{ id, text: '' }], activeId: id, open: true, view: 'note' })
        return
      }
      commit({ ...state, view })
    }

    /** Put one trashed page back as a tab, reusing its id so nothing collides. */
    function restoreNote(id) {
      const entry = state.trash.find((item) => item.id === id)
      if (!entry) return
      const taken = state.notes.some((note) => note.id === id)
      const nextId = taken ? state.seq + 1 : id
      commit({
        ...state,
        seq: Math.max(state.seq, nextId),
        notes: [...state.notes, { id: nextId, text: entry.text }],
        activeId: nextId,
        open: true,
        view: 'note',
        trash: state.trash.filter((item) => item.id !== id)
      })
    }

    function purgeNote(id) {
      if (!state.trash.some((item) => item.id === id)) return
      commit({ ...state, trash: state.trash.filter((item) => item.id !== id) })
    }

    function clearTrash() {
      if (state.trash.length === 0) return
      commit({ ...state, trash: [] })
    }

    /** Ask before destroying a page; the panel renders its own dialog. */
    function askPurge(id) {
      if (!state.trash.some((item) => item.id === id)) return
      commit({ ...state, pending: { kind: 'purge', id } })
    }

    function askClearTrash() {
      if (state.trash.length === 0) return
      commit({ ...state, pending: { kind: 'clear' } })
    }

    function dismissConfirm() {
      if (!state.pending) return
      commit({ ...state, pending: null })
    }

    function acceptConfirm() {
      const pending = state.pending
      if (!pending) return
      if (pending.kind === 'purge') {
        commit({ ...state, pending: null, trash: state.trash.filter((item) => item.id !== pending.id) })
        return
      }
      commit({ ...state, pending: null, trash: [] })
    }

    /** Move a tab to another position (drag reordering). */
    function moveNote(id, target) {
      const from = state.notes.findIndex((note) => note.id === id)
      if (from < 0) return
      const to = Math.min(Math.max(0, target), state.notes.length - 1)
      if (to === from) return
      const notes = state.notes.slice()
      const [moved] = notes.splice(from, 1)
      notes.splice(to, 0, moved)
      commit({ ...state, notes })
    }

    /** Whole-panel zoom for the note text. */
    function setZoom(next) {
      const zoom = Math.min(2.5, Math.max(0.7, Math.round((isNum(next) ? next : 1) * 100) / 100))
      if (zoom === state.zoom) return
      commit({ ...state, zoom })
    }

    function setBox(box) {
      commit({ ...state, box: fitBox(box) })
    }

    // ----------------------------------------------------------------- icons

    const noteIcon = h(
      'svg',
      {
        viewBox: '0 0 16 16',
        'aria-hidden': true,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round'
      },
      h('rect', { x: 2.4, y: 2.4, width: 11.2, height: 11.2, rx: 2.6 }),
      h('path', { d: 'M5 6.2h6M5 9.2h3.6' })
    )

    const plusIcon = h(
      'svg',
      {
        viewBox: '0 0 16 16',
        'aria-hidden': true,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round'
      },
      h('path', { d: 'M8 3.8v8.4M3.8 8h8.4' })
    )

    const pinIcon = h(
      'svg',
      { viewBox: '0 0 16 16', 'aria-hidden': true },
      h('path', {
        d: 'M9.6 1.6 14.4 6.4 12.7 7 11.2 8.5 10.8 12 4 5.2 7.5 4.8 9 3.3Z',
        fill: 'currentColor'
      }),
      h('path', {
        d: 'M6.2 9.8 2.8 13.2',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round'
      })
    )

    const trashIcon = h(
      'svg',
      {
        viewBox: '0 0 16 16',
        'aria-hidden': true,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round'
      },
      h('path', { d: 'M3.2 4.4h9.6M6.4 4.4V3.1h3.2v1.3M4.6 4.4l.6 8.1h5.6l.6-8.1' }),
      h('path', { d: 'M6.7 6.8v3.4M9.3 6.8v3.4' })
    )

    const closeIcon = h(
      'svg',
      {
        viewBox: '0 0 16 16',
        'aria-hidden': true,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round'
      },
      h('path', { d: 'M4.6 4.6l6.8 6.8M11.4 4.6l-6.8 6.8' })
    )

    /** Tab title: first non-empty line, truncated, else a numbered placeholder. */
    function tabTitle(note, index, t) {
      const line = note.text
        .split('\n')
        .map((part) => part.trim())
        .find((part) => part.length > 0)
      if (!line) return t('note.tab', { n: index + 1 })
      return line.length > 14 ? `${line.slice(0, 14)}…` : line
    }

    // ------------------------------------------------------------ components

    /** The note panel: tab strip, page body, footer status, resize grip. */
    function NotesPanel({ t }) {
      const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
      const rootRef = useRef(null)
      const drag = useRef(null)
      // Tab reordering: which tab is being dragged, whether it actually moved,
      // and which slot it would land in.
      const tabDrag = useRef(null)
      const [tabDrop, setTabDrop] = React.useState(null)
      const note = current.notes.find((item) => item.id === current.activeId) ?? current.notes[0]
      const box = current.box ?? fitBox({ x: EDGE, y: EDGE, w: DEFAULT_W, h: DEFAULT_H })

      // Click-away: unpinned panel closes when the pointer lands outside it.
      useEffect(() => {
        const onDown = (event) => {
          const snapshot = getSnapshot()
          if (!snapshot.open || snapshot.pinned) return
          const target = event.target
          if (target instanceof Element) {
            if (target.closest('[data-mini-notes-launcher]')) return
            const root = rootRef.current
            if (root && target instanceof Node && root.contains(target)) return
          }
          closePanel()
        }
        document.addEventListener('pointerdown', onDown, true)
        return () => document.removeEventListener('pointerdown', onDown, true)
      }, [])

      // Keep the panel inside the viewport when the window shrinks.
      useEffect(() => {
        const onResize = () => {
          const snapshot = getSnapshot()
          if (!snapshot.open || !snapshot.box) return
          const fitted = fitBox(snapshot.box)
          if (
            fitted.x !== snapshot.box.x ||
            fitted.y !== snapshot.box.y ||
            fitted.w !== snapshot.box.w ||
            fitted.h !== snapshot.box.h
          ) {
            commit({ ...snapshot, box: fitted })
          }
        }
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [])

      // Escape closes the panel unless it is pinned.
      // Keep the active tab in view when the strip has to scroll.
      useEffect(() => {
        const root = rootRef.current
        if (!root) return
        const strip = root.querySelector('.mn-tabs')
        const active = strip && strip.querySelector('.mn-tab[data-active]')
        if (!strip || !active || typeof strip.scrollWidth !== 'number') return
        const left = active.offsetLeft
        const right = left + active.offsetWidth
        if (left < strip.scrollLeft) strip.scrollLeft = left
        else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth
      }, [current.activeId, current.notes.length])

      useEffect(() => {
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          const snapshot = getSnapshot()
          if (snapshot.pending) {
            dismissConfirm()
            return
          }
          if (snapshot.open && !snapshot.pinned) closePanel()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [])

      /** Slot index under the pointer inside the tab strip. */
      const slotAt = (clientX) => {
        const root = rootRef.current
        const strip = root && root.querySelector('.mn-tabs')
        if (!strip) return null
        const tabs = Array.prototype.slice.call(strip.querySelectorAll('.mn-tab'))
        for (let index = 0; index < tabs.length; index += 1) {
          const rect = tabs[index].getBoundingClientRect()
          if (clientX < rect.left + rect.width / 2) return index
        }
        return tabs.length - 1
      }

      const startTabDrag = (event, id) => {
        if (event.button !== 0) return
        // The tab's own close button keeps its click behaviour.
        if (event.target instanceof Element && event.target.closest('button')) return
        const index = current.notes.findIndex((item) => item.id === id)
        tabDrag.current = { id, px: event.clientX, moved: false, drop: index }
        setTabDrop(index)
        event.currentTarget.setPointerCapture(event.pointerId)
      }

      const moveTabDrag = (event) => {
        const session = tabDrag.current
        if (!session) return
        if (!session.moved && Math.abs(event.clientX - session.px) < 4) return
        session.moved = true
        const slot = slotAt(event.clientX)
        if (slot === null) return
        session.drop = slot
        setTabDrop(slot)
      }

      const endTabDrag = (event) => {
        const session = tabDrag.current
        if (!session) return
        tabDrag.current = null
        try {
          event.currentTarget.releasePointerCapture(event.pointerId)
        } catch {
          /* capture already gone */
        }
        const slot = session.moved ? session.drop : null
        setTabDrop(null)
        if (slot !== null) moveNote(session.id, slot)
      }

      const startDrag = (event) => {
        if (event.button !== 0) return
        // Tabs and tools keep their own click behaviour; drag the blank bar only.
        if (event.target instanceof Element && event.target.closest('button, .mn-tab, .mn-confirm')) return
        drag.current = {
          kind: 'move',
          px: event.clientX,
          py: event.clientY,
          x: box.x,
          y: box.y,
          w: box.w,
          h: box.h
        }
        event.currentTarget.setPointerCapture(event.pointerId)
        event.preventDefault()
      }

      const startResize = (event) => {
        if (event.button !== 0) return
        drag.current = {
          kind: 'size',
          px: event.clientX,
          py: event.clientY,
          x: box.x,
          y: box.y,
          w: box.w,
          h: box.h
        }
        event.currentTarget.setPointerCapture(event.pointerId)
        event.preventDefault()
        event.stopPropagation()
      }

      const onPointerMove = (event) => {
        const session = drag.current
        if (!session) return
        const dx = event.clientX - session.px
        const dy = event.clientY - session.py
        if (session.kind === 'move') {
          setBox({ x: session.x + dx, y: session.y + dy, w: session.w, h: session.h })
          return
        }
        const vp = viewport()
        setBox({
          x: session.x,
          y: session.y,
          w: Math.min(Math.max(MIN_W, session.w + dx), Math.max(MIN_W, vp.w - session.x - EDGE)),
          h: Math.min(Math.max(MIN_H, session.h + dy), Math.max(MIN_H, vp.h - session.y - EDGE))
        })
      }

      const endDrag = (event) => {
        if (!drag.current) return
        drag.current = null
        try {
          event.currentTarget.releasePointerCapture(event.pointerId)
        } catch {
          /* capture already gone */
        }
        persistNow()
      }

      if (!current.open) return null
      if (current.view !== 'trash' && !note) return null

      const showingTrash = current.view === 'trash'
      const trashCount = current.trash.length

      return h(
        'div',
        {
          ref: rootRef,
          className: 'mn-panel',
          'data-mini-notes-panel': '',
          'data-view': showingTrash ? 'trash' : 'note',
          style: {
            left: `${box.x}px`,
            top: `${box.y}px`,
            width: `${box.w}px`,
            height: `${box.h}px`,
            '--mn-zoom': `${current.zoom || 1}`
          }
        },
        h(
          'div',
          {
            className: 'mn-bar',
            title: t('note.drag'),
            onPointerDown: startDrag,
            onPointerMove,
            onPointerUp: endDrag,
            onPointerCancel: endDrag
          },
          h(
            'div',
            { className: 'mn-tabs', role: 'tablist' },
            current.notes.map((item, index) =>
              h(
                'div',
                {
                  key: item.id,
                  className: 'mn-tab',
                  'data-active': !showingTrash && item.id === current.activeId ? '1' : undefined,
                  'data-dragging': tabDrag.current && tabDrag.current.id === item.id ? '1' : undefined,
                  'data-drop': tabDrop === index ? '1' : undefined,
                  role: 'tab',
                  'aria-selected': !showingTrash && item.id === current.activeId,
                  tabIndex: 0,
                  onPointerDown: (event) => startTabDrag(event, item.id),
                  onPointerMove: moveTabDrag,
                  onPointerUp: endTabDrag,
                  onPointerCancel: endTabDrag,
                  onClick: () => {
                    // A drag that actually moved must not also switch tabs.
                    if (tabDrag.current && tabDrag.current.moved) return
                    setActive(item.id)
                    setView('note')
                  },
                  onKeyDown: (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      setActive(item.id)
                      setView('note')
                    }
                  }
                },
                h('span', { className: 'mn-tab-label' }, tabTitle(item, index, t)),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'mn-tab-close',
                    'aria-label': t('note.close'),
                    title: t('note.close'),
                    onClick: (event) => {
                      event.stopPropagation()
                      removeNote(item.id)
                    }
                  },
                  closeIcon
                )
              )
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'mn-tab-add',
                'aria-label': t('note.add'),
                title: t('note.add'),
                onClick: addNote
              },
              plusIcon
            )
          ),
          h(
            'div',
            { className: 'mn-tools' },
            h(
              'div',
              { className: 'mn-zoom' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'mn-zoom-btn',
                  'aria-label': t('zoom.out'),
                  title: t('zoom.out'),
                  onClick: () => setZoom(current.zoom / 1.1)
                },
                '−'
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'mn-zoom-btn',
                  'aria-label': t('zoom.reset'),
                  title: t('zoom.reset'),
                  onClick: () => setZoom(1)
                },
                `${Math.round((current.zoom || 1) * 100)}%`
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'mn-zoom-btn',
                  'aria-label': t('zoom.in'),
                  title: t('zoom.in'),
                  onClick: () => setZoom(current.zoom * 1.1)
                },
                '+'
              )
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'mn-icon',
                'data-on': showingTrash ? '1' : undefined,
                'aria-pressed': showingTrash,
                'aria-label': t('trash.title'),
                title: trashCount > 0 ? `${t('trash.title')} · ${t('trash.count', { n: trashCount })}` : t('trash.title'),
                onClick: () => setView(showingTrash ? 'note' : 'trash')
              },
              trashIcon
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'mn-icon',
                'data-on': current.pinned ? '1' : undefined,
                'aria-pressed': current.pinned,
                'aria-label': current.pinned ? t('note.unpin') : t('note.pin'),
                title: current.pinned ? t('note.unpin') : t('note.pin'),
                onClick: () => setPinned(!current.pinned)
              },
              pinIcon
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'mn-icon',
                'aria-label': t('note.hide'),
                title: t('note.hide'),
                onClick: closePanel
              },
              closeIcon
            )
          )
        ),
        showingTrash
          ? renderTrash(current, t)
          : renderNote(note, current, t),
        renderConfirm(current, t),
        h('div', {
          className: 'mn-grip',
          'aria-hidden': true,
          onPointerDown: startResize,
          onPointerMove,
          onPointerUp: endDrag,
          onPointerCancel: endDrag
        })
      )
    }

    /** Header button: opens or hides the panel. */
    function NotesButton({ t }) {
      const open = useSyncExternalStore(subscribe, readButton, readButton)
      return h(
        'button',
        {
          type: 'button',
          className: 'mn-launcher',
          'data-mini-notes-launcher': '',
          'data-active': open ? '1' : undefined,
          'aria-pressed': open,
          'aria-label': t('button.label'),
          title: t('button.hint'),
          onClick: (event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            anchor = { right: rect.right, bottom: rect.bottom }
            togglePanel()
          }
        },
        noteIcon
      )
    }

    /** Editor + footer for the active page. A plain textarea: no inline rich
     *  content, so the browser owns the caret and newlines behave normally. */
    function renderNote(note, current, t) {
      return h(
        React.Fragment,
        null,
        h('textarea', {
          className: 'mn-text',
          key: note.id,
          defaultValue: note.text,
          placeholder: t('note.placeholder'),
          spellCheck: false,
          autoFocus: note.text === '',
          onChange: (event) => setText(note.id, event.target.value)
        }),
        h(
          'div',
          { className: 'mn-foot' },
          h(
            'span',
            { className: 'mn-status' },
            note.text.trim() ? `${note.text.trim().length} · ${t('note.saved')}` : t('note.empty')
          ),
          h('span', { className: 'mn-spacer' }),
          h('span', { className: 'mn-hint' }, t('note.pages', { n: current.notes.length }))
        )
      )
    }

    /** In-panel confirmation for a destructive trash action. */
    function renderConfirm(current, t) {
      const pending = current.pending
      if (!pending) return null
      const message = pending.kind === 'clear' ? t('trash.clearConfirm') : t('trash.purgeConfirm')
      return h(
        'div',
        { className: 'mn-confirm-mask' },
        h(
          'div',
          { className: 'mn-confirm', role: 'alertdialog', 'aria-modal': true },
          h('div', { className: 'mn-confirm-text' }, message),
          h(
            'div',
            { className: 'mn-confirm-actions' },
            h(
              'button',
              { type: 'button', className: 'mn-confirm-cancel', onClick: dismissConfirm, autoFocus: true },
              t('confirm.cancel')
            ),
            h('button', { type: 'button', className: 'mn-confirm-ok', onClick: acceptConfirm }, t('confirm.ok'))
          )
        )
      )
    }

    /** "3 分钟前" style short age for a trashed page. */
    function ageLabel(at, t) {
      const minutes = Math.max(0, Math.floor((Date.now() - at) / 60000))
      if (minutes < 1) return t('trash.justNow')
      if (minutes < 60) return t('trash.minutes', { n: minutes })
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return t('trash.hours', { n: hours })
      return t('trash.days', { n: Math.floor(hours / 24) })
    }

    /** Trash view: one row per closed page, click the row to restore it. */
    function renderTrash(current, t) {
      const rows = current.trash.map((item) => {
        const preview = item.text.replace(/\s+/g, ' ').trim()
        return h(
          'div',
          { key: item.id, className: 'mn-trash-row' },
          h(
            'button',
            {
              type: 'button',
              className: 'mn-trash-main',
              'aria-label': t('trash.restore'),
              title: t('trash.restore'),
              onClick: () => restoreNote(item.id)
            },
            h(
              'span',
              { className: 'mn-trash-text' },
              preview.length > 60 ? `${preview.slice(0, 60)}…` : preview || t('note.empty')
            ),
            h('span', { className: 'mn-trash-age' }, ageLabel(item.at, t))
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'mn-icon mn-trash-purge',
              'aria-label': t('trash.purge'),
              title: t('trash.purge'),
              onClick: () => askPurge(item.id)
            },
            closeIcon
          )
        )
      })

      return h(
        'div',
        { className: 'mn-trash' },
        rows.length === 0
          ? h('div', { className: 'mn-trash-empty' }, t('trash.empty'))
          : h('div', { className: 'mn-trash-list' }, rows),
        h(
          'div',
          { className: 'mn-foot' },
          h('span', { className: 'mn-status' }, t('trash.hint')),
          h('span', { className: 'mn-spacer' }),
          h('span', { className: 'mn-hint' }, t('trash.count', { n: rows.length })),
          rows.length > 0
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'mn-trash-clear',
                  title: t('trash.clear'),
                  onClick: askClearTrash
                },
                t('trash.clear')
              )
            : null
        )
      )
    }

    // ---------------------------------------------------------------- styles

    const CSS = `
      .mn-launcher{position:relative;flex:none;width:28px;height:28px;padding:0;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
      .mn-launcher:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .mn-launcher[data-active]{color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-hover)}
      .mn-launcher svg{width:15px;height:15px;flex:none}
      .mn-layer{position:absolute;inset:0;pointer-events:none}
      .mn-panel{position:fixed;pointer-events:auto;display:flex;flex-direction:column;box-sizing:border-box;overflow:hidden;background:var(--dsw-alias-bg-base);border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);box-shadow:var(--dsw-elevation-prominent);animation:mnIn .13s ease-out both;transform-origin:100% 0}
      @keyframes mnIn{from{opacity:0;transform:translateY(-6px) scale(.97)}to{opacity:1;transform:none}}
      @media (prefers-reduced-motion:reduce){.mn-panel{animation:none}}
      .mn-bar{flex:none;display:flex;align-items:flex-end;gap:4px;padding:6px 6px 0 8px;cursor:grab;user-select:none;touch-action:none}
      .mn-bar:active{cursor:grabbing}
      .mn-tabs{flex:1 1 auto;min-width:0;display:flex;align-items:flex-end;gap:2px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none}
      .mn-tabs::-webkit-scrollbar{display:none}
      .mn-tab{box-sizing:border-box;flex:0 1 132px;min-width:46px;display:flex;align-items:center;gap:2px;height:30px;padding:0 3px 0 9px;border-radius:var(--dsw-radius-sm) var(--dsw-radius-sm) 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px;cursor:pointer;background:transparent;overflow:hidden}
      .mn-tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
      .mn-tab[data-active]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:500}
      .mn-tab-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .mn-tab-close{flex:0 0 auto;width:14px;height:14px;padding:0;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:var(--dsw-radius-xs);background:transparent;color:inherit;cursor:pointer;opacity:0;transition:opacity .1s ease}
      .mn-tab:hover .mn-tab-close,.mn-tab[data-active] .mn-tab-close{opacity:.7}
      .mn-tab-close:hover{background:var(--dsw-alias-interactive-bg-hover);opacity:1}
      .mn-tab-close svg{width:9px;height:9px}
      .mn-tab-add{flex:none;width:22px;height:22px;margin:0 0 4px 2px;padding:0;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:var(--dsw-radius-xs);background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
      .mn-tab-add:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .mn-tab-add svg{width:12px;height:12px}
      .mn-tools{flex:none;display:flex;align-items:center;gap:1px;padding-bottom:3px}
      .mn-zoom{display:flex;align-items:center;gap:0;margin-right:2px}
      .mn-zoom-btn{height:22px;min-width:20px;padding:0 3px;border:none;border-radius:var(--dsw-radius-xs);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;line-height:1;cursor:pointer}
      .mn-zoom-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .mn-icon{position:relative;width:24px;height:24px;padding:0;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:var(--dsw-radius-xs);background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;opacity:.85}
      .mn-icon:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);opacity:1}
      .mn-icon[data-on]{color:var(--dsw-alias-brand-primary);opacity:1}
      .mn-icon svg{width:14px;height:14px;flex:none}
      .mn-text{flex:1;min-height:0;box-sizing:border-box;width:100%;margin:0;padding:calc(12px * var(--mn-zoom,1)) calc(14px * var(--mn-zoom,1));border:none;outline:none;resize:none;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:calc(13.5px * var(--mn-zoom,1));line-height:calc(22px * var(--mn-zoom,1))}
      .mn-text::placeholder{color:var(--dsw-alias-label-caption)}
      .mn-foot{flex:none;display:flex;align-items:center;gap:8px;height:24px;padding:0 18px 0 12px;border-top:0.5px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}
      .mn-status{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .mn-status-error{color:var(--dsw-alias-state-error-primary)}
      .mn-spacer{flex:1}
      .mn-hint{flex:none;opacity:.7}
      .mn-trash{flex:1;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1)}
      .mn-trash-list{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:4px 6px}
      .mn-trash-empty{flex:1;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-caption);font-size:12px}
      .mn-trash-row{display:flex;align-items:center;gap:2px;border-radius:var(--dsw-radius-sm);padding:1px 2px}
      .mn-trash-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
      .mn-trash-main{flex:1;min-width:0;display:flex;align-items:baseline;gap:8px;padding:7px 8px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}
      .mn-trash-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:18px}
      .mn-trash-age{flex:none;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}
      .mn-trash-purge{flex:none;opacity:0;transition:opacity .1s ease}
      .mn-trash-row:hover .mn-trash-purge{opacity:.8}
      .mn-trash-clear{padding:0 4px;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;cursor:pointer}
      .mn-trash-clear:hover{color:var(--dsw-alias-state-error-primary)}
      .mn-confirm-mask{position:absolute;left:0;right:0;top:0;bottom:0;z-index:5;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--dsw-alias-bg-mask-1);border-radius:inherit}
      .mn-confirm{box-sizing:border-box;width:100%;max-width:280px;display:flex;flex-direction:column;gap:10px;padding:14px 14px 12px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-overlay);border:0.5px solid var(--dsw-alias-border-l2);box-shadow:var(--dsw-elevation-prominent)}
      .mn-confirm-text{color:var(--dsw-alias-label-primary);font-size:12.5px;line-height:19px}
      .mn-confirm-actions{display:flex;justify-content:flex-end;gap:6px}
      .mn-confirm-cancel,.mn-confirm-ok{height:26px;padding:0 10px;border-radius:var(--dsw-radius-sm);border:0.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
      .mn-confirm-cancel:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .mn-confirm-ok{border-color:transparent;background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-foreground)}
      .mn-confirm-ok:hover{filter:brightness(1.06)}
      .mn-confirm-ok:focus-visible,.mn-confirm-cancel:focus-visible{outline:2px solid var(--dsw-focus-ring-color);outline-offset:1px}
      .mn-tab[data-dragging]{opacity:.55;cursor:grabbing}
      .mn-tab[data-drop]{box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary)}
      .mn-grip{position:absolute;right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize;touch-action:none;background:linear-gradient(135deg,transparent 0 50%,var(--dsw-alias-border-l2) 50% 60%,transparent 60% 70%,var(--dsw-alias-border-l2) 70% 80%,transparent 80%)}
    `

    function insertStyles() {
      const tagId = 'dsh-mini-notes/client.css'
      if (document.querySelector(`style[data-plugin-css="${tagId}"]`)) return () => {}
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-mini-notes'
      tag.dataset.pluginCss = tagId
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => {
        tag.remove()
      }
    }

    // ---------------------------------------------------------------- plugin

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        load()

        ctx.effect(insertStyles, 'mini-notes: styles')
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'mini-notes: dictionaries')

        // Flush pending edits when the page goes away.
        ctx.effect(() => {
          const flush = () => persistNow()
          window.addEventListener('pagehide', flush)
          return () => {
            window.removeEventListener('pagehide', flush)
            flush()
          }
        }, 'mini-notes: persistence')

        ctx.slots.inject('conversation.session.header.utilities', () =>
          ctx.slots.register(
            {
              name: 'conversation.session.header.utilities',
              id: 'mini-notes',
              order: 10,
              locale: NS
            },
            NotesButton
          )
        )

        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'mini-notes-layer',
              order: 40,
              locale: NS
            },
            NotesPanel
          )
        )
      }
    }
  }
})
