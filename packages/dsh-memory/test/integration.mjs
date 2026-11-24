import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as plugin from '../index.js'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memory-int-'))
const logs = []
const tools = new Map()
const listeners = new Map()
const effects = []
let rpcRoute = null
const sections = []

const ctx = {
  logger: { warn: (...args) => logs.push(args.join(' ')), info() {}, debug() {} },
  tools: { register: (definition) => { tools.set(definition.name, definition) } },
  on: (type, listener) => {
    const list = listeners.get(type) ?? []
    list.push(listener)
    listeners.set(type, list)
    return () => {}
  },
  effect: (factory) => { const dispose = factory(); effects.push(dispose); return dispose },
  inject: (services, callback) => {
    if (services.includes('connection') && services.includes('webServer')) {
      callback({
        effect: (factory) => { factory(); return () => {} },
        connection: { admit: () => ({ peer: { principal: { kind: 'owner' } } }) },
        webServer: {
          register: (route) => { rpcRoute = route; return () => {} },
        },
      })
    }
  },
}

const config = {
  directory: dir,
  recentLimit: 8,
  budgetChars: 1200,
  maxEntries: 5000,
  maxContentLength: 500,
  injectContext: true,
  summaryEnabled: true,
  summaryTurns: 60,
  summaryTokens: 8000,
}

plugin.apply(ctx, config)
assert.deepEqual([...tools.keys()].sort(), ['recall', 'remember'])
for (const definition of tools.values()) {
  assert.equal(typeof definition.output.render, 'function')
  assert.equal(typeof definition.execute, 'function')
  assert.equal(typeof definition.parameters, 'object')
  assert.equal(definition.parameters.type, 'object')
  assert.ok(Array.isArray(definition.parameters.required))
}

const exec = { agent: { session: { id: 'session-int-1' } } }
const saved = await tools.get('remember').execute({ content: '用户在做毕业论文，偏好中文沟通', kind: 'preference', tags: ['论文', '偏好'] }, exec)
assert.equal(saved.created, true)
assert.match(saved.id, /^mem_/)
assert.ok(fs.readFileSync(path.join(dir, 'memory.md'), 'utf8').includes('用户在做毕业论文'))
assert.equal(saved.sessionId, undefined)
assert.ok(fs.readFileSync(path.join(dir, 'memory.md'), 'utf8').includes('session=session-int-1'))

const duplicate = await tools.get('remember').execute({ content: '用户在做毕业论文，偏好中文沟通' }, exec)
assert.equal(duplicate.created, false)
assert.equal(duplicate.id, saved.id)

const found = await tools.get('recall').execute({ query: '论文 中文' })
assert.equal(found.count, 1)
assert.equal(found.entries[0].id, saved.id)

// 注入：模拟新 agent 创建，捕获 systemPrompt.section 的文本
const agent = {
  id: 'agent-1',
  ctx: {
    inject: (services, callback) => {
      assert.deepEqual(services, ['systemPrompt'])
      callback({ systemPrompt: { section: (section) => { sections.push(section); return () => {} } } })
      return { dispose: () => {} }
    },
  },
}
for (const listener of listeners.get('agent/created') ?? []) listener({ agent })
assert.equal(sections.length, 1)
assert.equal(sections[0].name, 'memory:local-context')
assert.equal(sections[0].order, 100)
assert.equal(sections[0].interpolate, false)
assert.ok(sections[0].text.includes('用户在做毕业论文'))
assert.ok(sections[0].text.startsWith('[Local memory'))
assert.ok(sections[0].text.length <= 1200)

// RPC 面板通道（直接调用注册的 HTTP 路由，模拟浏览器 Cookie 认证后的请求）
assert.equal(rpcRoute.kind, 'prefix')
assert.equal(rpcRoute.path, '/local-memory')
const callRpc = async (endpoint, payload = {}) => {
  const message = JSON.stringify({ type: 'client-request', rpcId: 'rpc-1', method: endpoint, payload })
  const request = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: `/local-memory/${endpoint}`,
    setEncoding() {},
    async *[Symbol.asyncIterator]() { yield message },
  }
  const response = { status: 0, body: '', writeHead(status, headers) { this.status = status; this.headers = headers }, end(body) { this.body = body ?? '' } }
  await rpcRoute.handler(request, response)
  assert.equal(response.status, 200)
  const envelope = JSON.parse(String(response.body))
  assert.equal(envelope.type, 'server-response')
  assert.equal(envelope.rpcId, 'rpc-1')
  return envelope.result
}
const state = await callRpc('state')
assert.equal(state.ok, true)
assert.equal(state.value.total, 1)
assert.equal(state.value.entries[0].content, '用户在做毕业论文，偏好中文沟通')
assert.equal(state.value.directory, dir)
const added = await callRpc('add', { content: '面板新增的记忆', kind: 'note', tags: ['panel'] })
assert.equal(added.ok, true)
const pinned = await callRpc('pin', { id: added.value.id, pinned: true })
assert.equal(pinned.value.pinned, true)
const searched = await callRpc('search', { query: '面板' })
assert.equal(searched.value.entries.length, 1)
const removed = await callRpc('remove', { id: added.value.id })
assert.equal(removed.value.total, 1)
const failed = await callRpc('remove', { id: 'mem_missing' })
assert.equal(failed.ok, false)
const ready = await callRpc('ui-ready', { sidebar: true, main: true })
assert.equal(ready.ok, true)
assert.equal(ready.value.sidebar, true)

// 滚动摘要：通过 session/event 监听器喂 60 轮
const session = { id: 'session-int-rolling', header: { delegationDepth: 0 } }
let seq = 1
const emit = (type, data) => {
  for (const listener of listeners.get('session/event') ?? []) listener(session, { type, seq: seq++, time: Date.now(), data })
}
for (let turn = 1; turn <= 60; turn += 1) {
  emit('user/message', { turn, content: [{ type: 'text', text: `第 ${turn} 轮的问题内容` }] })
  emit('assistant/message', { turn, step: 1, message: { content: [{ type: 'text', text: `第 ${turn} 轮的回答内容` }] } })
  emit('turn/end', { turn, reason: { kind: 'completed' } })
}
const summaryFile = path.join(dir, 'summaries', 'session-int-rolling.json')
assert.ok(fs.existsSync(summaryFile))
const archived = fs.readFileSync(path.join(dir, 'archives', 'session-int-rolling.jsonl'), 'utf8').trim().split('\n')
assert.ok(archived.length >= 120)
const finalState = await callRpc('state')
assert.equal(finalState.value.summaries.length, 1)
assert.equal(finalState.value.archives.length, 1)

// 清理时不应抛错
for (const dispose of effects) if (typeof dispose === 'function') dispose()

console.log('INTEGRATION PASS')
fs.rmSync(dir, { recursive: true, force: true })
console.log('tools:', [...tools.keys()].join(', '))
console.log('injection chars:', sections[0].text.length)
console.log('archive lines:', archived.length)
console.log('memory entries:', finalState.value.total)
console.log('logs:', logs)
