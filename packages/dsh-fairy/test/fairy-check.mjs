/**
 * Fairy Host 半边自检（不需要启动客户端）：
 *   node test/fairy-check.mjs
 * 覆盖：RPC 鉴权、会话创建/恢复、30 分钟问候规则、history 过滤、send、reset。
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as plugin from '../index.js'

const realNow = Date.now
let now = realNow()
Date.now = () => now

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-fairy-check-'))
const routes = new Map()
let route = null
let admit = () => ({ peer: { principal: { kind: 'owner' } } })
const created = []
const followed = []
const events = []
let agentStatus = 'idle'
let resolveError = false

const agent = {
  get status() {
    return agentStatus
  },
  followup(message) {
    followed.push(message)
    events.push({ type: 'user/message', seq: events.length + 1, time: now, data: message })
  },
  session: {
    id: 'session-fairy-1',
    snapshotEvents() {
      return events.slice()
    },
  },
  ctx: { on: () => () => {} },
}
const controller = {
  async resolveAgent() {
    if (resolveError) throw new Error('session not found')
    return { agent }
  },
  async create(request) {
    created.push(request)
    resolveError = false
    return { sessionId: `session-fairy-${created.length}`, agentPreset: request.agentPreset }
  },
}

const ctx = {
  logger: { warn: () => {}, info() {}, debug() {} },
  get: () => undefined,
  inject: (services, callback) => {
    if (services.includes('connection') && services.includes('webServer') && services.includes('sessionController')) {
      callback({
        effect: (factory) => { factory(); return () => {} },
        connection: { admit: () => admit() },
        webServer: { register: (r) => { routes.set(r.path, r); return () => {} } },
        sessionController: controller,
        attachments: {
          async admitPromptContent(content) {
            let index = 0
            return content.map((part) =>
              part.type === 'text'
                ? { type: 'text', text: part.text }
                : {
                    type: 'image',
                    attachment: {
                      attachmentId: `att-${index++}-${part.mediaType}`,
                      mediaType: part.mediaType,
                      bytes: 3,
                      width: 1,
                      height: 1,
                    },
                  },
            )
          },
          async readImage(ref) {
            return { ref, data: new Uint8Array([1, 2, 3]) }
          },
        },
      })
    }
  },
}
plugin.apply(ctx, { agentPreset: 'companion', directory: dir })
route = routes.get('/fairy')
assert.equal(route.kind, 'prefix')
assert.equal(route.path, '/fairy')
assert.ok(routes.get('/fairy-icon.png'))
assert.ok(routes.get('/fairy-sticker.jpg'))

async function call(endpoint, payload = {}, authorized = true) {
  admit = authorized ? () => ({ peer: { principal: { kind: 'owner' } } }) : () => ({ rejection: 401 })
  const request = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: `/fairy/${endpoint}`,
    setEncoding() {},
    async *[Symbol.asyncIterator]() {
      yield JSON.stringify({ type: 'client-request', rpcId: 'r1', method: endpoint, payload })
    },
  }
  const response = {
    status: 0,
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(body) { this.body = body ?? '' },
  }
  await route.handler(request, response)
  return { status: response.status, envelope: response.body.startsWith('{') ? JSON.parse(response.body) : undefined }
}

const minutes = (value) => value * 60 * 1000

// 未认证
{
  const { status } = await call('open', {}, false)
  assert.equal(status, 401)
}

// 首次 open：创建会话并主动问候
{
  const { envelope } = await call('open')
  assert.equal(envelope.result.ok, true)
  assert.equal(envelope.result.value.sessionId, 'session-fairy-1')
  assert.equal(envelope.result.value.greeted, true)
  assert.equal(created.length, 1)
  assert.equal(created[0].agentPreset, 'companion')
  assert.equal(followed.length, 1)
  assert.equal(followed[0].source.kind, 'fairy-open')
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'))
  assert.equal(state.sessionId, 'session-fairy-1')
  assert.equal(typeof state.lastGreetingAt, 'number')
}

// 1 分钟后再次进入：30 分钟内不重复打招呼
{
  now += minutes(1)
  const { envelope } = await call('open')
  assert.equal(envelope.result.value.greeted, false)
  assert.equal(envelope.result.value.reason, 'recent-greeting')
  assert.equal(followed.length, 1)
}

// 发消息后：history 只含用户/助手可见文本
{
  followed.length = 0
  const { envelope } = await call('send', { text: '你好呀' })
  assert.equal(envelope.result.ok, true)
  assert.equal(followed[0].source.kind, 'fairy-user')
  const history = await call('history')
  assert.equal(history.envelope.result.ok, true)
  assert.deepEqual(history.envelope.result.value.messages.map((message) => message.text), ['你好呀'])
  assert.equal(history.envelope.result.value.running, false)
}

// 距上次问候与用户消息都超过 30 分钟：可以再次问候
{
  now += minutes(32) // T+33：问候在 T，用户消息在 T+1，均已超过 30 分钟
  const { envelope } = await call('open')
  assert.equal(envelope.result.value.greeted, true)
}

// 距用户消息不足 30 分钟：即使问候窗口已过也不打
{
  now += minutes(1)
  await call('send', { text: '刚聊过一句' })
  const stateFile = path.join(dir, 'state.json')
  const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  saved.lastGreetingAt = 0 // 模拟很久以前问候过，仅剩「用户刚说过话」这一个条件
  fs.writeFileSync(stateFile, JSON.stringify(saved))
  const ctx2 = {
    logger: { warn: () => {}, info() {}, debug() {} },
    get: () => undefined,
    inject: (services, callback) => {
      if (services.includes('connection') && services.includes('webServer') && services.includes('sessionController')) {
        callback({
          effect: (factory) => { factory(); return () => {} },
          connection: { admit: () => admit() },
          webServer: { register: (r) => { routes.set(r.path, r); return () => {} } },
          sessionController: controller,
        })
      }
    },
  }
  plugin.apply(ctx2, { agentPreset: 'companion', directory: dir })
  route = routes.get('/fairy')
  const before = followed.length
  const { envelope } = await call('open')
  assert.equal(envelope.result.value.greeted, false)
  assert.equal(envelope.result.value.reason, 'recent-message')
  assert.equal(followed.length, before)
}

// 用户消息也超过 30 分钟：恢复问候
{
  now += minutes(31)
  const { envelope } = await call('open')
  assert.equal(envelope.result.value.greeted, true)
}

// 重启后仍记得上次问候时间（同一目录重新 apply）
{
  now += minutes(1)
  const before = followed.length
  const ctx3 = {
    logger: { warn: () => {}, info() {}, debug() {} },
    get: () => undefined,
    inject: (services, callback) => {
      if (services.includes('connection') && services.includes('webServer') && services.includes('sessionController')) {
        callback({
          effect: (factory) => { factory(); return () => {} },
          connection: { admit: () => admit() },
          webServer: { register: (r) => { routes.set(r.path, r); return () => {} } },
          sessionController: controller,
        })
      }
    },
  }
  plugin.apply(ctx3, { agentPreset: 'companion', directory: dir })
  route = routes.get('/fairy')
  const { envelope } = await call('open')
  assert.equal(envelope.result.value.greeted, false)
  assert.equal(envelope.result.value.reason, 'recent-greeting')
  assert.equal(followed.length, before)
}

// 表情包：稳定 10% 概率，同一消息多次读取结果一致
{
  for (let index = 0; index < 300; index += 1) {
    events.push({
      type: 'assistant/message',
      seq: 1000 + index,
      time: now,
      data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: `回复 ${index}` }], source: { kind: 'model', provider: 'p', model: 'm' } } },
    })
  }
  const first = await call('history')
  const counted = first.envelope.result.value.messages.filter((message) => typeof message.sticker === 'string').length
  assert.ok(counted >= 20 && counted <= 55, `sticker count ${counted}`)
  const second = await call('history')
  assert.deepEqual(
    second.envelope.result.value.messages.map((message) => message.sticker ?? null),
    first.envelope.result.value.messages.map((message) => message.sticker ?? null),
  )
  const sticker = routes.get('/fairy-sticker.jpg')
  const response = { status: 0, body: null, writeHead(status) { this.status = status }, end(body) { this.body = body } }
  await sticker.handler({ method: 'GET', headers: {} }, response)
  assert.equal(response.status, 200)
  assert.ok(response.body.length > 1000)
}

// 忙碌时不打断
{
  agentStatus = 'running'
  const { envelope } = await call('open')
  assert.equal(envelope.result.value.greeted, false)
  assert.equal(envelope.result.value.reason, 'busy')
  agentStatus = 'idle'
}

// 会话失效时自动新建
{
  resolveError = true
  const { envelope } = await call('open')
  assert.equal(envelope.result.ok, true)
  assert.equal(created.length >= 2, true)
}

// reset
{
  const { envelope } = await call('reset')
  assert.equal(envelope.result.ok, true)
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'))
  assert.equal(state.sessionId, undefined)
}

// 空消息被拒
{
  const { envelope } = await call('send', { text: '   ' })
  assert.equal(envelope.result.ok, false)
}

Date.now = realNow
fs.rmSync(dir, { recursive: true, force: true })
console.log('FAIRY PASS')
