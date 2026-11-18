/**
 * Smoke test for the dsh-mini-notes client half — no browser, no React package.
 *
 * Stubs `window`, `document`, `localStorage`, `__ModuleLoader__` and a small
 * hook-capable React stand-in, loads client.js, mounts both slot entries and
 * exercises opening, tab switching, typing, adding/removing pages, dragging,
 * resizing, pinning and click-away. Behavioural check only — not a browser.
 */
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert')

const SRC = process.argv[2]
if (!SRC) throw new Error('usage: node harness.cjs <client.js>')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const settled = () => sleep(360)

// ------------------------------------------------------------------ DOM stubs

const camel = (name) => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())

class TextNode {
  constructor(value) {
    this.nodeType = 3
    this.nodeValue = String(value)
    this.parent = null
    this.children = []
  }
  get textContent() {
    return this.nodeValue
  }
}

class El {
  constructor(tag) {
    this.nodeType = 1
    this.tagName = String(tag).toUpperCase()
    this.children = []
    this.style = {}
    this.dataset = {}
    this.attrs = {}
    this.parent = null
    this.listeners = {}
    this.value = ''
  }
  appendChild(child) {
    child.parent = this
    this.children.push(child)
    return child
  }
  remove() {
    if (!this.parent) return
    this.parent.children = this.parent.children.filter((c) => c !== this)
    this.parent = null
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value)
  }
  getAttribute(name) {
    return this.attrs[name]
  }
  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) || this.dataset[camel(name)] !== undefined
  }
  get parentElement() {
    return this.parent
  }
  get className() {
    return this.attrs.class || ''
  }
  set className(value) {
    if (value === '') delete this.attrs.class
    else this.attrs.class = String(value)
  }
  removeAttribute(name) {
    delete this.attrs[name]
  }
  get childNodes() {
    return this.children
  }
  get textContent() {
    if (this._text !== undefined) return this._text
    return this.children
      .map((c) => {
        if (c.nodeType === 3) return c.nodeValue
        if (c.tagName === 'BR') return '\n'
        return c.textContent
      })
      .join('')
  }
  set textContent(value) {
    if (value === '') {
      this.children = []
      this._text = undefined
      return
    }
    this._text = String(value)
  }
  addEventListener(type, fn) {
    ;(this.listeners[type] ||= []).push(fn)
  }
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn)
  }
  closest(selector) {
    if (selector === 'button') {
      let cursor = this
      while (cursor) {
        if (cursor.tagName === 'BUTTON') return cursor
        cursor = cursor.parent
      }
      return null
    }
    const m = /^\[([a-z-]+)\]$/.exec(selector)
    if (m) {
      let cursor = this
      while (cursor) {
        if (cursor.attrs[m[1]] !== undefined || cursor.dataset[camel(m[1])] !== undefined) return cursor
        cursor = cursor.parent
      }
      return null
    }
    return null
  }
  contains(node) {
    let cursor = node
    while (cursor) {
      if (cursor === this) return true
      cursor = cursor.parent
    }
    return false
  }
  focus() {
    this.focused = true
  }
  getContext() {
    return { drawImage() {} }
  }
  toDataURL(type) {
    // Emit something longer than the 64-char WebP sanity check.
    return `data:${type || 'image/png'};base64,${'A'.repeat(200)}`
  }
  setPointerCapture() {}
  releasePointerCapture() {}
  getBoundingClientRect() {
    if (this._box) return this._box
    return { right: 900, bottom: 40, left: 870, top: 12, width: 30, height: 28 }
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null
  }
  querySelectorAll(selector) {
    const out = []
    const matches = (node) => {
      if (!node || node.nodeType === 3) return false
      if (selector.startsWith('style[data-plugin-css=')) {
        const want = selector.slice('style[data-plugin-css='.length, -2).replace(/^"|"$/g, '')
        return node.dataset.pluginCss === want
      }
      if (selector === 'textarea') return node.tagName === 'TEXTAREA'
      if (selector === '.mn-editor') return (node.attrs.class || '').split(' ').includes('mn-editor')
      if (selector.startsWith('.')) {
        return (node.attrs.class || '').split(' ').includes(selector.slice(1))
      }
      const m = /^\[([a-z-]+)(?:="([^"]*)")?\]$/.exec(selector)
      if (m) {
        const value = node.attrs[m[1]] ?? node.dataset[camel(m[1])]
        return m[2] === undefined ? value !== undefined : value === m[2]
      }
      return false
    }
    const walk = (node) => {
      if (!node || node.nodeType === 3) return
      for (const child of node.children) {
        if (matches(child)) out.push(child)
        walk(child)
      }
    }
    walk(this)
    return out
  }
}

const documentListeners = {}
const document = new El('#document')
document.head = new El('head')
document.body = new El('body')
document.documentElement = new El('html')
document.createElement = (tag) => new El(tag)
document.createTextNode = (value) => new TextNode(value)
document.createRange = () => {
  const range = {
    startContainer: document.body,
    startOffset: 0,
    collapsed: true,
    selectNodeContents(node) {
      range.startContainer = node
      range.startOffset = 0
    },
    setStart(node, offset) {
      range.startContainer = node
      range.startOffset = offset
    },
    setStartBefore(node) {
      range.startContainer = node.parent || document.body
      range.startOffset = (range.startContainer.children || []).indexOf(node)
    },
    collapse() {
      range.collapsed = true
    },
    setEnd() {}
  }
  return range
}
document.addEventListener = (type, fn) => {
  ;(documentListeners[type] ||= []).push(fn)
}
document.removeEventListener = (type, fn) => {
  documentListeners[type] = (documentListeners[type] || []).filter((f) => f !== fn)
}
document.querySelector = (sel) => document.head.querySelector(sel)

const storage = new Map()

/** Minimal Image stand-in: fires onload with a fixed natural size. */
class FakeImage {
  constructor() {
    this.naturalWidth = 3200
    this.naturalHeight = 1800
  }
  set src(_value) {
    Promise.resolve().then(() => this.onload && this.onload())
  }
}
global.Image = FakeImage
let objectUrlSeq = 0
global.URL.createObjectURL = () => `blob:fake/${(objectUrlSeq += 1)}`
global.URL.revokeObjectURL = () => {}
const windowListeners = {}
const windowStub = {
  innerWidth: 1400,
  innerHeight: 900,
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k)
  },
  confirm: () => false,
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  addEventListener: (type, fn) => {
    ;(windowListeners[type] ||= []).push(fn)
  },
  removeEventListener: (type, fn) => {
    windowListeners[type] = (windowListeners[type] || []).filter((f) => f !== fn)
  }
}

let currentRange = null
windowStub.getSelection = () => ({
  rangeCount: currentRange ? 1 : 0,
  getRangeAt: () => currentRange,
  removeAllRanges: () => {
    currentRange = null
  },
  addRange: (range) => {
    currentRange = range
  }
})
const setSelection = (range) => {
  currentRange = range
}

global.window = windowStub
global.document = document
global.Element = El
global.Node = El

// -------------------------------------------------------------- React stand-in

let hooks = null

const React = {
  Fragment: '#fragment',
  memo: (fn) => fn,
  createElement(type, props, ...children) {
    return { type, props: props || {}, children: children.flat(Infinity).filter((c) => c != null) }
  },
  useEffect(fn) {
    hooks.effects.push(fn)
  },
  useMemo(fn) {
    return fn()
  },
  useCallback(fn) {
    return fn
  },
  useRef(initial) {
    const index = hooks.refIndex++
    if (hooks.refs[index] === undefined) hooks.refs[index] = { current: initial }
    return hooks.refs[index]
  },
  useSyncExternalStore(_subscribe, getSnapshot) {
    return getSnapshot()
  },
  useState(initial) {
    const owner = hooks ?? lastCtx
    owner.states ??= []
    const slot = owner.stateIndex++
    if (owner.states[slot] === undefined) {
      owner.states[slot] = typeof initial === 'function' ? initial() : initial
    }
    return [
      owner.states[slot],
      (next) => {
        owner.states[slot] = typeof next === 'function' ? next(owner.states[slot]) : next
      }
    ]
  }
}

// -------------------------------------------------------------------- renderer

const hyphen = (key) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

function render(node) {
  if (node == null || node === false || node === true) return null
  if (typeof node === 'string' || typeof node === 'number') {
    const text = new El('#text')
    text.textContent = String(node)
    return text
  }
  if (Array.isArray(node)) return node.flatMap((child) => render(child) ?? [])
  if (node.type === '#fragment') return node.children.flatMap((child) => render(child) ?? [])
  if (typeof node.type === 'function') {
    const props = { ...node.props }
    if (node.children.length > 0) props.children = node.children.length === 1 ? node.children[0] : node.children
    return render(node.type(props))
  }
  const el = new El(node.type)
  for (const [key, value] of Object.entries(node.props || {})) {
    if (key === 'key' || key === 'children') continue
    if (key === 'ref') {
      if (typeof value === 'function') value(el)
      else if (value && typeof value === 'object') value.current = el
      continue
    }
    if (key === 'style') Object.assign(el.style, value)
    else if (key.startsWith('on') && typeof value === 'function') {
      const type = key.slice(2).toLowerCase()
      ;(el.listeners[type] ||= []).push(value)
    } else if (key === 'defaultValue') el.value = value
    else if (key === 'className') el.attrs.class = value
    else el.attrs[hyphen(key)] = value
  }
  for (const child of node.children) {
    const rendered = render(child)
    for (const item of Array.isArray(rendered) ? rendered : [rendered]) if (item) el.appendChild(item)
  }
  return el
}

/** Per-component hook state that survives re-renders, like a real fiber. */
const fibers = new WeakMap()

/** Mount (or update) one registered component, running its effects. */
function mount(Component) {
  let fiber = fibers.get(Component)
  if (!fiber) {
    fiber = { refs: [], states: [] }
    fibers.set(Component, fiber)
  }
  hooks = { effects: [], refs: fiber.refs, states: fiber.states, refIndex: 0, stateIndex: 0 }
  const tree = render({
    type: Component,
    props: { t: (key, params) => (params ? `${key}${JSON.stringify(params)}` : key) },
    children: []
  })
  const ctx = hooks
  lastCtx = ctx
  hooks = null
  const cleanups = []
  for (const effect of ctx.effects) {
    const cleanup = effect()
    if (typeof cleanup === 'function') cleanups.push(cleanup)
  }
  return { tree, cleanups }
}

const unmount = (ui) => {
  for (const cleanup of ui.cleanups) cleanup()
}

// ------------------------------------------------------------------ load plugin

let plugin = null
const loader = {
  load({ id, factory }) {
    const out = factory((name) => {
      if (name === 'react') return React
      throw new Error(`unexpected require: ${name}`)
    })
    plugin = { id, ...out }
  }
}
windowStub.__ModuleLoader__ = loader
global.__ModuleLoader__ = loader

new Function(
  'window',
  'document',
  'Element',
  'Node',
  'localStorage',
  fs.readFileSync(path.resolve(SRC), 'utf8')
)(windowStub, document, El, El, windowStub.localStorage)

assert.ok(plugin, 'plugin loaded from the module factory')

const locales = {}
const registered = new Map()
const ctx = {
  effect(fn) {
    const dispose = fn()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  on() {
    return () => {}
  },
  get() {
    return undefined
  },
  locale: {
    register(ns, dicts) {
      locales[ns] = dicts
      return () => {}
    }
  },
  slots: {
    inject(_key, callback) {
      return callback()
    },
    register(options, component) {
      registered.set(options.id, { options, component })
      return () => registered.delete(options.id)
    }
  }
}
plugin.apply(ctx)

assert.deepStrictEqual([...registered.keys()].sort(), ['mini-notes', 'mini-notes-layer'])
assert.ok(locales['mini-notes'].zh['note.add'])
assert.ok(locales['mini-notes'].en['note.placeholder'])
assert.ok(document.head.querySelector('style[data-plugin-css="dsh-mini-notes/client.css"]'), 'stylesheet inserted')

/** Re-evaluate client.js from scratch (a page reload) and draw it once. */
function loadFresh() {
  registered.clear()
  let freshPlugin = null
  const freshLoader = {
    load({ id, factory }) {
      const out = factory((name) => {
        if (name === 'react') return React
        throw new Error(`unexpected require: ${name}`)
      })
      freshPlugin = { id, ...out }
    }
  }
  windowStub.__ModuleLoader__ = freshLoader
  global.__ModuleLoader__ = freshLoader
  new Function(
    'window',
    'document',
    'Element',
    'Node',
    'localStorage',
    fs.readFileSync(path.resolve(SRC), 'utf8')
  )(windowStub, document, El, El, windowStub.localStorage)
  freshPlugin.apply(ctx)
  const freshButton = registered.get('mini-notes').component
  const freshPanel = registered.get('mini-notes-layer').component
  return { button: mount(freshButton).tree, panel: mount(freshPanel).tree }
}

const Button = registered.get('mini-notes').component
const Panel = registered.get('mini-notes-layer').component

let buttonUi
let panelUi

/** Re-render both entries the way a store notification would. */
function draw() {
  if (buttonUi) unmount(buttonUi)
  if (panelUi) unmount(panelUi)
  buttonUi = mount(Button)
  panelUi = mount(Panel)
  return { button: buttonUi.tree, panel: panelUi.tree }
}

/** Simulate typing: replace the editor's text nodes, put the caret at the end, fire input. */
const typeInto = (editor, value) => {
  editor.children = []
  const parts = String(value).split('\n')
  let lastText = null
  parts.forEach((line, index) => {
    if (index > 0) editor.appendChild(new El('br'))
    if (line !== '') {
      lastText = new TextNode(line)
      editor.appendChild(lastText)
    }
  })
  // A real browser leaves the caret after the last typed character.
  const range = document.createRange()
  if (lastText) range.setStart(lastText, lastText.nodeValue.length)
  else range.selectNodeContents(editor)
  range.collapse(true)
  setSelection(range)
  editor.listeners.input[0]({})
}

const pick = (root, label) => {
  const out = []
  const walk = (node) => {
    if (!node || node.nodeType === 3) return
    for (const child of node.children) {
      if (!child || child.nodeType === 3) continue
      if (child.attrs['aria-label'] === label) out.push(child)
      walk(child)
    }
  }
  walk(root)
  return out[0] || null
}

const byClass = (root, cls) => {
  const out = []
  const walk = (node) => {
    if (!node || node.nodeType === 3) return
    for (const child of node.children) {
      if (!child || child.nodeType === 3) continue
      if ((child.attrs.class || '').split(' ').includes(cls)) out.push(child)
      walk(child)
    }
  }
  walk(root)
  return out
}

;(async () => {
  // ------------------------------------------------------------- open at button
  let ui = draw()
  assert.strictEqual(ui.panel, null, 'panel closed initially')

  ui.button.listeners.click[0]({ currentTarget: ui.button })
  ui = draw()
  assert.ok(ui.panel, 'panel opens from the launcher')
  const box = ui.panel.style
  assert.strictEqual(box.width, '400px', 'default width')
  assert.strictEqual(box.height, '460px', 'default height')
  assert.strictEqual(Number(box.left.replace('px', '')) + 400, 900, 'panel right edge hugs the button')
  assert.strictEqual(box.top, '48px', 'panel opens just below the button')

  let tabs = byClass(ui.panel, 'mn-tab')
  assert.strictEqual(tabs.length, 1, 'one tab created on first open')
  assert.ok(ui.panel.querySelector('.mn-editor'), 'editor exists')

  // Layout invariants that keep "+" reachable with many tabs.
  const strip = byClass(ui.panel, 'mn-tabs')[0]
  const tools = byClass(ui.panel, 'mn-tools')[0]
  assert.ok(strip && tools, 'tab strip and tools row both exist')
  const addBtn = pick(ui.panel, 'note.add')
  assert.ok(strip.contains(addBtn), 'add button sits after the last tab (Notepad style)')
  assert.ok(!tools.contains(addBtn), 'add button left the tools row')
  const zoomBox = byClass(ui.panel, 'mn-zoom')[0]
  assert.ok(zoomBox, 'zoom control lives in the tools row')
  assert.strictEqual(byClass(ui.panel, 'mn-zoom-btn').length, 3, 'zoom has -, %, +')

  // -------------------------------------------------------------------- typing
  typeInto(ui.panel.querySelector('.mn-editor'), '会议纪要\n第二行')
  await settled()
  let saved = JSON.parse(storage.get('dsh-mini-notes.v2'))
  assert.strictEqual(saved.notes[0].text, '会议纪要\n第二行')
  assert.strictEqual(saved.open, true)
  assert.ok(saved.box.w === 400 && saved.box.h === 460)

  ui = draw()
  tabs = byClass(ui.panel, 'mn-tab')
  assert.strictEqual(tabs[0].children[0].children[0].textContent, '会议纪要', 'tab shows the first line')

  // ---------------------------------------------------------------- add pages
  pick(ui.panel, 'note.add').listeners.click[0]()
  ui = draw()
  tabs = byClass(ui.panel, 'mn-tab')
  assert.strictEqual(tabs.length, 2, 'second page added')
  assert.strictEqual(tabs[1].attrs['data-active'], '1', 'new page becomes active')
  typeInto(ui.panel.querySelector('.mn-editor'), '第二页内容')
  await settled()

  byClass(ui.panel, 'mn-tab')[0].listeners.click[0]()
  ui = draw()
  assert.strictEqual(ui.panel.querySelector('.mn-editor').textContent, '会议纪要\n第二行', 'page 1 text preserved')
  assert.strictEqual(byClass(ui.panel, 'mn-tab')[0].attrs['data-active'], '1', 'page 1 active again')

  // ------------------------------------------------------------ tab reordering
  {
    const strip = byClass(ui.panel, 'mn-tabs')[0]
    const order = () => byClass(ui.panel, 'mn-tab').map((tab) => tab.children[0].children[0].textContent)
    assert.deepStrictEqual(order().length, 2, 'two tabs to reorder')
    // Give the fake tabs a horizontal layout: 100px each starting at x=200.
    const layout = (list) =>
      list.forEach((tab, i) => {
        tab.getBoundingClientRect = () => ({ left: 200 + i * 100, width: 100, right: 300 + i * 100, top: 0, height: 30 })
      })
    layout(byClass(ui.panel, 'mn-tab'))

    const first = byClass(ui.panel, 'mn-tab')[0]
    first.listeners.pointerdown[0]({ button: 0, target: first, clientX: 210, pointerId: 7, currentTarget: first, setPointerCapture() {} })
    ui = draw()
    layout(byClass(ui.panel, 'mn-tab'))
    const dragging = byClass(ui.panel, 'mn-tab')[0]
    assert.strictEqual(dragging.attrs['data-dragging'], '1', 'dragged tab is marked')
    dragging.listeners.pointermove[0]({ clientX: 380 })
    ui = draw()
    const marked = byClass(ui.panel, 'mn-tab')
    assert.strictEqual(marked[1].attrs['data-drop'], '1', 'the slot under the pointer shows the drop marker')
    marked[0].listeners.pointerup[0]({ pointerId: 7, currentTarget: marked[0] })
    ui = draw()
    await settled()
    const reordered = order()
    assert.strictEqual(reordered.length, 2)
    assert.notDeepStrictEqual(reordered, ['会议纪要', '第二页内容'], 'tab order changed')
    saved = JSON.parse(storage.get('dsh-mini-notes.v2'))
    assert.strictEqual(saved.notes[0].text, '第二页内容', 'first tab is now the second page')
    assert.strictEqual(saved.notes[1].text, '会议纪要\n第二行', 'second tab is now the first page')
    const draggedId = saved.notes.find((note) => note.text.startsWith('会议纪要')).id
    assert.strictEqual(saved.activeId, draggedId, 'the dragged tab stays active wherever it landed')

    // A plain click on a tab (no movement) still selects it.
    const other = byClass(ui.panel, 'mn-tab')[1]
    const otherId = saved.notes[1].id
    other.listeners.pointerdown[0]({ button: 0, target: other, clientX: 400, pointerId: 8, currentTarget: other, setPointerCapture() {} })
    other.listeners.pointerup[0]({ pointerId: 8, currentTarget: other })
    byClass(ui.panel, 'mn-tab')[1].listeners.click[0]()
    ui = draw()
    await settled()
    saved = JSON.parse(storage.get('dsh-mini-notes.v2'))
    assert.strictEqual(saved.activeId, otherId, 'a click without movement still selects the tab')
    assert.strictEqual(saved.notes.length, 2, 'a click does not reorder')
  }

  // -------------------------------------------------------------- drag + resize
  const bar = byClass(ui.panel, 'mn-bar')[0]
  const left = Number(ui.panel.style.left.replace('px', ''))
  const top = Number(ui.panel.style.top.replace('px', ''))
  bar.listeners.pointerdown[0]({
    button: 0,
    target: bar,
    clientX: 500,
    clientY: 100,
    pointerId: 1,
    currentTarget: bar,
    preventDefault() {}
  })
  bar.listeners.pointermove[0]({ clientX: 440, clientY: 130 })
  ui = draw()
  assert.strictEqual(Number(ui.panel.style.left.replace('px', '')), left - 60, 'dragged horizontally')
  assert.strictEqual(Number(ui.panel.style.top.replace('px', '')), top + 30, 'dragged vertically')
  bar.listeners.pointerup[0]({ pointerId: 1, currentTarget: bar })

  const grip = byClass(ui.panel, 'mn-grip')[0]
  grip.listeners.pointerdown[0]({
    button: 0,
    target: grip,
    clientX: 700,
    clientY: 400,
    pointerId: 2,
    currentTarget: grip,
    preventDefault() {},
    stopPropagation() {}
  })
  grip.listeners.pointermove[0]({ clientX: 760, clientY: 460 })
  ui = draw()
  assert.strictEqual(ui.panel.style.width, '460px', 'resized wider')
  assert.strictEqual(ui.panel.style.height, '520px', 'resized taller')
  grip.listeners.pointerup[0]({ pointerId: 2, currentTarget: grip })
  await settled()
  saved = JSON.parse(storage.get('dsh-mini-notes.v2'))
  assert.strictEqual(saved.box.w, 460)
  assert.strictEqual(saved.box.h, 520)

  // -------------------------------------------------------------- pin behaviour
  pick(ui.panel, 'note.pin').listeners.click[0]()
  ui = draw()
  const outside = new El('div')
  document.body.appendChild(outside)
  documentListeners.pointerdown[0]({ target: outside })
  ui = draw()
  assert.ok(ui.panel, 'pinned panel survives an outside click')

  pick(ui.panel, 'note.unpin').listeners.click[0]()
  ui = draw()
  documentListeners.pointerdown[0]({ target: outside })
  ui = draw()
  assert.strictEqual(ui.panel, null, 'unpinned panel closes on an outside click')
  assert.strictEqual(ui.button.attrs['data-active'], undefined, 'launcher no longer marked active')

  // -------------------------------------------------------------- reopen + close
  ui.button.listeners.click[0]({ currentTarget: ui.button })
  ui = draw()
  assert.ok(ui.panel, 'reopening returns the same pages')
  assert.strictEqual(byClass(ui.panel, 'mn-tab').length, 2)

  const closes = () => byClass(ui.panel, 'mn-tab-close')
  closes()[0].listeners.click[0]({ stopPropagation() {} })
  ui = draw()
  assert.ok(ui.panel, 'panel survives while another page remains')
  closes()[0].listeners.click[0]({ stopPropagation() {} })
  ui = draw()
  await settled()
  saved = JSON.parse(storage.get('dsh-mini-notes.v2'))
  assert.strictEqual(saved.notes.length, 0, 'no pages left open')
  assert.strictEqual(saved.trash.length, 2, 'both closed pages went to the trash')
  assert.strictEqual(saved.open, true, 'panel stays open, showing the trash')
  assert.strictEqual(saved.view, 'trash')
  assert.ok(ui.panel, 'trash view is rendered instead of closing')

  // --------------------------------------------------------------- trash view
  let rows = byClass(ui.panel, 'mn-trash-row')
  assert.strictEqual(rows.length, 2, 'two rows in the trash')
  assert.ok(ui.panel.querySelector('.mn-trash-empty') === null, 'not the empty state')

  // Restore the older entry (the one whose text is page 1) by clicking its row.
  const restoreButtons = byClass(ui.panel, 'mn-trash-main')
  const wanted = restoreButtons.find((btn) => btn.children[0].children[0].textContent.startsWith('会议纪要'))
  assert.ok(wanted, 'trashed page text is preserved')
  wanted.listeners.click[0]()
  ui = draw()
  await settled()
  saved = JSON.parse(storage.get('dsh-mini-notes.v2'))
  assert.strictEqual(saved.notes.length, 1, 'restored page is back as a tab')
  assert.strictEqual(saved.notes[0].text, '会议纪要\n第二行', 'restored with its full text')
  assert.strictEqual(saved.trash.length, 1, 'restored entry left the trash')
  assert.strictEqual(saved.view, 'note', 'restore returns to the editor')
  assert.strictEqual(byClass(ui.panel, 'mn-tab').length, 1)

  // Back into the trash, then purge one row permanently.
  byClass(ui.panel, 'mn-tab-close')[0].listeners.click[0]({ stopPropagation() {} })
  ui = draw()
  assert.strictEqual(ui.panel.attrs['data-view'], 'trash', 'closing the last tab shows the trash')
  assert.strictEqual(byClass(ui.panel, 'mn-trash-row').length, 2, 'both pages are listed again')
  // A single purge opens the panel's own dialog, never a browser confirm.
  let confirmCalled = 0
  windowStub.confirm = () => {
    confirmCalled += 1
    return true
  }
  byClass(ui.panel, 'mn-trash-purge')[0].listeners.click[0]()
  ui = draw()
  const dialog = ui.panel.querySelector('.mn-confirm')
  assert.ok(dialog, 'panel renders its own confirm dialog')
  assert.strictEqual(confirmCalled, 0, 'window.confirm is never called')
  await settled()
  saved = JSON.parse(storage.get('dsh-mini-notes.v2'))
  assert.strictEqual(saved.trash.length, 2, 'nothing is deleted before confirming')

  // Cancel keeps the entry.
  ui.panel.querySelector('.mn-confirm-cancel').listeners.click[0]()
  ui = draw()
  assert.strictEqual(ui.panel.querySelector('.mn-confirm'), null, 'dialog dismissed')
  await settled()
  saved = JSON.parse(storage.get('dsh-mini-notes.v2'))
  assert.strictEqual(saved.trash.length, 2, 'cancelling keeps the entry')

  // Confirm deletes exactly one.
  byClass(ui.panel, 'mn-trash-purge')[0].listeners.click[0]()
  ui = draw()
  ui.panel.querySelector('.mn-confirm-ok').listeners.click[0]()
  ui = draw()
  await settled()
  saved = JSON.parse(storage.get('dsh-mini-notes.v2'))
  assert.strictEqual(saved.trash.length, 1, 'purge removed exactly one entry')
  assert.strictEqual(ui.panel.querySelector('.mn-confirm'), null, 'dialog closed after confirming')

  // No badge dot on the trash icon any more.
  assert.strictEqual(byClass(ui.panel, 'mn-badge').length, 0, 'trash icon has no dot badge')

  // Clear the rest: same in-panel dialog.
  byClass(ui.panel, 'mn-trash-clear')[0].listeners.click[0]()
  ui = draw()
  assert.ok(ui.panel.querySelector('.mn-confirm'), 'clear-all also asks in-panel')
  ui.panel.querySelector('.mn-confirm-ok').listeners.click[0]()
  ui = draw()
  await settled()
  saved = JSON.parse(storage.get('dsh-mini-notes.v2'))
  assert.strictEqual(saved.trash.length, 0, 'trash emptied')
  assert.strictEqual(confirmCalled, 0, 'no browser confirm was ever used')
  assert.ok(ui.panel.querySelector('.mn-trash-empty'), 'empty state shown')

  // ------------------------------------------------------------------ images
  {
    // Start from a clean single page on the note view.
    storage.set('dsh-mini-notes.v2', JSON.stringify({
      v: 2, notes: [{ id: 1, text: 'x', images: [] }], activeId: 1, seq: 1,
      open: true, pinned: true, box: { x: 40, y: 60, w: 400, h: 460 }, trash: [], view: 'note'
    }))
    const imgUi = loadFresh()
    assert.strictEqual(byClass(imgUi.panel, 'mn-fig').length, 0, 'no inline image initially')

    const file = { type: 'image/png', name: 'a.png' }
    const ed = imgUi.panel.querySelector('.mn-editor')
    ed.listeners.paste[0]({
      clipboardData: { files: [file], items: [] },
      preventDefault() {}
    })
    await settled()
    const afterPaste = { panel: mount(registered.get('mini-notes-layer').component).tree }
    const figs = () => byClass(afterPaste.panel, 'mn-fig')
    assert.strictEqual(figs().length, 1, 'pasted image becomes an inline figure')
    saved = JSON.parse(storage.get('dsh-mini-notes.v2'))
    assert.strictEqual(saved.notes[0].images.length, 1, 'image recorded on the page')
    assert.ok(saved.notes[0].text.includes('\uFFFC'), 'text carries a placeholder char where the image sits')
    assert.strictEqual(saved.notes[0].text.replace(/\uFFFC/g, ''), 'x', 'the existing text is preserved')
    const caretIndex = saved.notes[0].text.indexOf('\uFFFC')
    assert.strictEqual(caretIndex, 1, 'placeholder landed at the caret, after the text')
    const imageId = saved.notes[0].images[0].id
    assert.ok(storage.get(`dsh-mini-notes.img.${imageId}`).startsWith('data:image/'), 'bytes stored separately')
    assert.ok(!storage.get('dsh-mini-notes.v2').includes('base64'), 'page JSON stays free of image bytes')
    assert.strictEqual(saved.notes[0].images[0].w, 1600, 'downscaled to the 1600px cap')
    assert.strictEqual(saved.notes[0].images[0].h, 900)

    // The inline image renders at a readable width, not a 64px thumbnail.
    const fig = figs()[0]
    const shownWidth = Number(String(fig.style.width).replace('px', ''))
    assert.ok(shownWidth >= 160, `inline image is readable (got ${shownWidth}px)`)
    assert.ok(fig.children.some((c) => c.tagName === 'IMG'), 'figure holds the img')

    // Resizing by the right edge only changes the stored display width.
    const rightGrip = byClass(fig, 'mn-fig-grip-right')[0]
    assert.ok(rightGrip, 'right edge has a resize grip')
    fig._box = { left: 0, top: 0, width: shownWidth, height: 200, right: shownWidth, bottom: 200 }
    const listeners = []
    windowStub.addEventListener = (type, fn) => listeners.push({ type, fn })
    windowStub.removeEventListener = () => {}
    rightGrip.listeners.pointerdown[0]({ clientX: 400, preventDefault() {}, stopPropagation() {}, currentTarget: rightGrip })
    const moveFn = listeners.find((l) => l.type === 'pointermove').fn
    const upFn = listeners.find((l) => l.type === 'pointerup').fn
    moveFn({ clientX: 460 })
    upFn({ clientX: 460 })
    await settled()
    saved = JSON.parse(storage.get('dsh-mini-notes.v2'))
    const dw = saved.notes[0].images[0].dw
    assert.ok(dw > shownWidth, `drag widened the image (${shownWidth} -> ${dw})`)
    assert.ok(saved.notes[0].text.includes('\uFFFC'), 'resizing leaves the text untouched')

    // Clicking an inline image selects it (no zoom); Backspace deletes it.
    let panelTree = mount(registered.get('mini-notes-layer').component).tree
    let figNow = byClass(panelTree, 'mn-fig')[0]
    const imgEl = figNow.children.find((c) => c.tagName === 'IMG')
    imgEl.listeners.mousedown[0]({ preventDefault() {}, target: imgEl })
    assert.strictEqual(figNow.attrs['data-selected'], '1', 'clicking the image selects it')
    panelTree.querySelector('.mn-editor').listeners.keydown[0]({ key: 'Backspace', preventDefault() {} })
    const afterDelete = { panel: mount(registered.get('mini-notes-layer').component).tree }
    await settled()
    assert.strictEqual(byClass(afterDelete.panel, 'mn-fig').length, 0, 'Backspace deletes the selected image')
    saved = JSON.parse(storage.get('dsh-mini-notes.v2'))
    assert.strictEqual(saved.notes[0].images.length, 0, 'image removed from the page')
    assert.ok(!saved.notes[0].text.includes('\uFFFC'), 'its placeholder went with it')
    assert.strictEqual(storage.get(`dsh-mini-notes.img.${imageId}`), undefined, 'image bytes released')

    // Whole-page zoom: text and images scale, chrome does not.
    const zoomUi = mount(registered.get('mini-notes-layer').component).tree
    const zoomBtns = byClass(zoomUi, 'mn-zoom-btn')
    assert.strictEqual(zoomBtns.length, 3, 'zoom has -, %, +')
    assert.strictEqual(zoomUi.style['--mn-zoom'], '1', 'default zoom is 1')
    zoomBtns[2].listeners.click[0]() // +
    let zoomed = mount(registered.get('mini-notes-layer').component).tree
    assert.strictEqual(zoomed.style['--mn-zoom'], '1.1', 'zoom in raises the scale')
    byClass(zoomed, 'mn-zoom-btn')[1].listeners.click[0]() // the % resets
    zoomed = mount(registered.get('mini-notes-layer').component).tree
    assert.strictEqual(zoomed.style['--mn-zoom'], '1', 'clicking the percentage resets')
    byClass(zoomed, 'mn-zoom-btn')[0].listeners.click[0]() // -
    zoomed = mount(registered.get('mini-notes-layer').component).tree
    assert.ok(Number(zoomed.style['--mn-zoom']) < 1, 'zoom out lowers the scale')
    await settled()
    saved = JSON.parse(storage.get('dsh-mini-notes.v2'))
    assert.ok(saved.zoom < 1, 'zoom is persisted')
  }

  // Regression: after an image update (which repaints the editor), one Enter
  // must still produce one newline. The original readDom() trimmed a trailing
  // "\n", so the stored text and the DOM disagreed forever, and the Enter that
  // produced the newline was immediately undone — users had to press it twice.
  {
    storage.set('dsh-mini-notes.v2', JSON.stringify({
      v: 2, notes: [{ id: 1, text: '', images: [] }], activeId: 1, seq: 1,
      open: true, pinned: true, box: { x: 40, y: 60, w: 400, h: 460 },
      trash: [], view: 'note', zoom: 1
    }))
    const rp = loadFresh()
    const ed = rp.panel.querySelector('.mn-editor')
    typeInto(ed, 'aaa')
    await settled()

    // Paste an image — this is what forces the repaint.
    ed.listeners.paste[0]({
      clipboardData: { files: [{ type: 'image/png', name: 'a.png' }], items: [] },
      preventDefault() {}
    })
    await settled()
    let st = JSON.parse(storage.get('dsh-mini-notes.v2'))
    assert.strictEqual(st.notes[0].images.length, 1, 'image attached')

    // Repaint happens on the next render (as an image update does).
    const painted = mount(registered.get('mini-notes-layer').component).tree
    await settled()
    st = JSON.parse(storage.get('dsh-mini-notes.v2'))
    const before = st.notes[0].text

    // ONE Enter, on the freshly repainted editor.
    const ed2 = painted.querySelector('.mn-editor')
    ed2.listeners.keydown[0]({ key: 'Enter', preventDefault() {} })
    await settled()
    st = JSON.parse(storage.get('dsh-mini-notes.v2'))
    assert.strictEqual(
      st.notes[0].text,
      before + '\n',
      `one Enter after a repaint adds one newline (was ${JSON.stringify(before)}, now ${JSON.stringify(st.notes[0].text)})`
    )
  }

  // Regression: Enter must insert a line break, not truncate the page.
  // The editor originally captured a page snapshot at build time, so the second
  // edit was computed against stale text and the current line got overwritten.
  {
    storage.set('dsh-mini-notes.v2', JSON.stringify({
      v: 2, notes: [{ id: 1, text: '', images: [] }], activeId: 1, seq: 1,
      open: true, pinned: true, box: { x: 40, y: 60, w: 400, h: 460 },
      trash: [], view: 'note', zoom: 1
    }))
    const enterUi = loadFresh()
    const ed = enterUi.panel.querySelector('.mn-editor')

    // type the first line
    typeInto(ed, '第一行')
    await settled()
    let st = JSON.parse(storage.get('dsh-mini-notes.v2'))
    assert.strictEqual(st.notes[0].text, '第一行', 'first line typed')

    // press Enter -> a newline is appended
    ed.listeners.keydown[0]({ key: 'Enter', preventDefault() {} })
    await settled()
    st = JSON.parse(storage.get('dsh-mini-notes.v2'))
    assert.strictEqual(st.notes[0].text, '第一行\n', `Enter adds a newline (got ${JSON.stringify(st.notes[0].text)})`)

    // Second line typed into the SAME editor instance (no remount), then another
    // Enter. This is where the original bug lived: the editor's captured page
    // snapshot was stale, so text was spliced into old content and overwritten.
    typeInto(ed, '第一行\n第二行')
    await settled()
    st = JSON.parse(storage.get('dsh-mini-notes.v2'))
    assert.strictEqual(st.notes[0].text, '第一行\n第二行', 'second line kept the first')

    ed.listeners.keydown[0]({ key: 'Enter', preventDefault() {} })
    await settled()
    st = JSON.parse(storage.get('dsh-mini-notes.v2'))
    assert.strictEqual(
      st.notes[0].text,
      '第一行\n第二行\n',
      `second Enter on the same editor keeps both lines (got ${JSON.stringify(st.notes[0].text)})`
    )
  }

  // Regression: a page with an inline image must render it on reload.
  {
    storage.set('dsh-mini-notes.v2', JSON.stringify({
      v: 2,
      notes: [{ id: 1, text: 'before\uFFFCafter', images: [{ id: 'iabc', w: 800, h: 600, dw: 300 }] }],
      activeId: 1, seq: 1, open: true, pinned: true,
      box: { x: 40, y: 60, w: 400, h: 460 }, trash: [], view: 'note'
    }))
    storage.set('dsh-mini-notes.img.iabc', 'data:image/png;base64,AAAA')
    const reloadImg = loadFresh()
    assert.ok(reloadImg.panel, 'panel opens')
    assert.strictEqual(byClass(reloadImg.panel, 'mn-fig').length, 1, 'inline image renders right after reload')
    const figNow = byClass(reloadImg.panel, 'mn-fig')[0]
    const imgInFig = figNow.children.find((c) => c.tagName === 'IMG')
    assert.ok(imgInFig, `figure holds an img (children: ${figNow.children.map((c) => c.tagName)})`)
    assert.ok(String(imgInFig.src).startsWith('data:image/png'), 'restored image has its source')
  }

  // A panel left on the trash must survive a reload as open + trash.
  storage.set('dsh-mini-notes.v2', JSON.stringify({
    v: 2,
    notes: [],
    activeId: 0,
    seq: 4,
    open: true,
    pinned: false,
    box: { x: 40, y: 60, w: 400, h: 460 },
    trash: [{ id: 9, text: '被关掉的一页', at: Date.now() - 120000 }],
    view: 'trash'
  }))
  const reloaded = loadFresh()
  assert.ok(reloaded.panel, 'a trash-only panel reopens after reload')
  assert.strictEqual(reloaded.panel.attrs['data-view'], 'trash', 'reopens on the trash view')
  assert.strictEqual(byClass(reloaded.panel, 'mn-trash-row').length, 1, 'trashed page survived reload')
  assert.strictEqual(reloaded.panel.style.width, '400px', 'geometry restored')

  // Capacity: the trash keeps the newest 2000 entries.
  storage.set('dsh-mini-notes.v2', JSON.stringify({
    v: 2,
    notes: [{ id: 1, text: 'a' }, { id: 2, text: 'b' }],
    activeId: 1,
    seq: 3000,
    open: true,
    pinned: true,
    box: { x: 40, y: 60, w: 400, h: 460 },
    trash: [],
    view: 'note'
  }))
  const cappedStore = JSON.parse(storage.get('dsh-mini-notes.v2'))
  // The store keeps newest-first, so index 0 is the newest entry.
  const cappedTrash = Array.from({ length: 2005 }, (_, i) => ({ id: 9000 - i, text: `t${i}`, at: Date.now() - i * 1000 }))
  cappedStore.trash = cappedTrash
  cappedStore.notes = []
  cappedStore.activeId = 0
  cappedStore.view = 'trash'
  cappedStore.open = true
  storage.set('dsh-mini-notes.v2', JSON.stringify(cappedStore))
  const cappedAgain = loadFresh()
  assert.ok(cappedAgain.panel, 'panel with 2005 trashed rows still renders')
  assert.strictEqual(cappedAgain.panel.attrs['data-view'], 'trash', 'capacity test is on the trash view')
  const rowsAfterCap = byClass(cappedAgain.panel, 'mn-trash-row').length
  assert.strictEqual(rowsAfterCap, 2000, `trash capped at 2000 (rendered ${rowsAfterCap})`)
  // Oldest entries are the ones dropped: the newest survives.
  const firstRow = byClass(cappedAgain.panel, 'mn-trash-text')[0]
  assert.strictEqual(firstRow.children[0].textContent, 't0', 'newest trash entry is first')
  assert.ok(!byClass(cappedAgain.panel, 'mn-trash-text').some((el) => el.children[0].textContent === 't2004'), 'oldest entries were dropped')

  // Launcher closes the panel; reopening with an empty page list and an empty
  // trash creates a fresh page.
  pick(ui.panel, 'note.hide').listeners.click[0]()
  ui = draw()
  assert.strictEqual(ui.panel, null, 'panel hidden')
  ui.button.listeners.click[0]({ currentTarget: ui.button })
  ui = draw()
  assert.ok(ui.panel, 'panel reopens')
  await settled()
  saved = JSON.parse(storage.get('dsh-mini-notes.v2'))
  assert.strictEqual(saved.notes.length, 1, 'a blank page is created when nothing is left')
  assert.strictEqual(saved.view, 'note', 'reopens on the editor')

  console.log('smoke test passed')
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
