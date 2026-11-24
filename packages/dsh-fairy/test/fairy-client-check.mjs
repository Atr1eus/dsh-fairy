/**
 * Fairy 客户端（Web）自检：模块 id、依赖、聊天面板与侧栏入口注册、locale 字典。
 *   node test/fairy-client-check.mjs
 */

import assert from 'node:assert/strict'

let loaded = null
globalThis.window = { __ModuleLoader__: { load: (entry) => { loaded = entry } } }
await import('../client.js')
assert.ok(loaded)
assert.equal(loaded.id, 'dsh-fairy')

const requested = []
const React = {
  createElement: (...args) => ({ args }),
  Fragment: () => null,
  useState: (value) => [value, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useRef: (value) => ({ current: value }),
}
const result = loaded.factory((name) => {
  requested.push(name)
  if (name === 'react') return React
  throw new Error(`unexpected require(${name})`)
})
assert.deepEqual(requested, ['react'])
assert.deepEqual(result.inject, ['slots', 'locale', 'connection'])

const registrations = []
const dicts = {}
const ctx = {
  effect: (factory) => { factory(); return () => {} },
  locale: {
    register: (ns, value) => { dicts[ns] = value },
    bind: () => (key) => key,
    subscribe: () => () => {},
  },
  slots: {
    inject: (owner, callback) => { callback() },
    register: (options, component) => {
      registrations.push({ options, component })
      return () => {}
    },
  },
}
result.apply(ctx)
assert.equal(registrations.length, 2)
const page = registrations.find((entry) => entry.options.name === 'main')
const entry = registrations.find((entry) => entry.options.name === 'sidebar.panellist')
assert.ok(page && entry)
assert.equal(page.options.key, 'fairy')
assert.equal(entry.options.id, 'fairy')
assert.equal(typeof page.component, 'function')
assert.equal(typeof entry.component, 'function')
assert.deepEqual(Object.keys(dicts['fairy'].zh).sort(), Object.keys(dicts['fairy'].en).sort())
console.log('FAIRY CLIENT PASS')
