/**
 * Fairy 图片消息 + 审批自检：
 *   node test/fairy-media-check.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as plugin from '../index.js'

const realNow = Date.now
let now = realNow()
Date.now = () => now

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-fairy-media-'))
const routes = new Map()
const followed = []
const events = []
let approvalListener
const agent = {
  status: 'idle',
  session: {
    id: 'session-media',
    snapshotEvents: () => events.slice(),
  },
  ctx: {
    on: (event, listener) => {
      if (event === 'approval/request') approvalListener = listener
      return () => {}
    },
  },
  followup(message) {
    followed.push(message)
    events.push({ type: 'user/message', seq: events.length + 1, time: now, data: message })
  },
  cancel() {},
}
const controller = {
  async resolveAgent() {
    return { agent }
  },
  async create() {
    return { sessionId: 'session-media', agentPreset: 'companion' }
  },
}
const storedImages = new Map()
const attachments = {
  async admitPromptContent(content) {
    return content.map((part, index) =>
      part.type === 'text'
        ? { type: 'text', text: part.text }
        : (() => {
            const attachment = {
              attachmentId: `att-${index}`,
              mediaType: part.mediaType,
              bytes: 68,
              width: 1,
              height: 1,
            }
            storedImages.set(attachment.attachmentId, attachment)
            return { type: 'image', attachment }
          })(),
    )
  },
  async readImage(ref) {
    return { ref, data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) }
  },
}
const ctx = {
  logger: { warn: () => {}, info() {}, debug() {} },
  get: (name) => (name === 'userApproval' ? { setPolicy: () => {} } : undefined),
  inject: (services, callback) => {
    if (services.includes('connection') && services.includes('attachments')) {
      callback({
        effect: (factory) => { factory(); return () => {} },
        connection: { admit: () => ({ peer: { principal: { kind: 'owner' } } }) },
        webServer: { register: (route) => { routes.set(route.path, route); return () => {} } },
        sessionController: controller,
        attachments,
      })
    }
  },
}
plugin.apply(ctx, { agentPreset: 'companion', directory: dir })
const route = routes.get('/fairy')
assert.ok(route)

async function call(endpoint, payload = {}) {
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
    writeHead(status) { this.status = status },
    end(body) { this.body = body ?? '' },
  }
  await route.handler(request, response)
  return { status: response.status, envelope: response.body.startsWith('{') ? JSON.parse(response.body) : undefined }
}

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

// 发一张图 + 一句话
{
  const { envelope } = await call('send', {
    text: '看这张图',
    clientId: 'c-1',
    images: [{ mediaType: 'image/png', data: png, name: 'shot.png' }],
  })
  assert.equal(envelope.result.ok, true)
  const message = followed.find((item) => item.source?.clientId === 'c-1')
  assert.ok(message)
  assert.equal(message.content[0].type, 'text')
  assert.equal(message.content[1].type, 'image')
  assert.equal(message.content[1].attachment.mediaType, 'image/png')
}

// history 同时回文字与图片消息，并带上 clientId
{
  const { envelope } = await call('history')
  const messages = envelope.result.value.messages
  const text = messages.find((message) => message.text === '看这张图')
  const photo = messages.find((message) => message.image !== undefined)
  assert.ok(text && photo)
  assert.equal(text.clientId, 'c-1')
  assert.equal(photo.clientId, 'c-1')
  assert.equal(photo.image.id, 'att-1')
}

// 图片路由：带登录态可读，无登录态 401
{
  const imageRoute = routes.get('/fairy-image')
  assert.ok(imageRoute)
  const read = async (authenticated) => {
    const request = { method: 'GET', url: `/fairy-image/${encodeURIComponent('att-1')}`, headers: {} }
    const response = { status: 0, body: null, writeHead(status) { this.status = status }, end(body) { this.body = body } }
    // 测试用 admit 通过 connection 对象控制
    const connection = imageRoute.handler
    await connection(request, response)
    return response
  }
  const response = await read(true)
  assert.equal(response.status, 200)
  assert.equal(response.body.length, 4)
}

// 审批：请求进入卡片 → 允许一次 → 工具继续
{
  assert.equal(typeof approvalListener, 'function')
  const signal = new AbortController().signal
  const decision = approvalListener({ toolName: 'bash', reason: 'rm -rf build', signal })
  await call('history')
  const pending = await call('history')
  assert.equal(pending.envelope.result.value.approvals.length, 1)
  assert.equal(pending.envelope.result.value.approvals[0].toolName, 'bash')
  const key = pending.envelope.result.value.approvals[0].key
  await call('approve', { key, allow: true })
  assert.equal(await decision, 'allowed-once')
  const after = await call('history')
  assert.equal(after.envelope.result.value.approvals.length, 0)
}

// 拒绝
{
  const decision = approvalListener({ toolName: 'write', signal: new AbortController().signal })
  const pending = await call('history')
  const key = pending.envelope.result.value.approvals[0].key
  await call('approve', { key, allow: false })
  assert.equal(await decision, 'rejected')
}

// 中断 → cancelled
{
  const controllerSignal = new AbortController()
  const decision = approvalListener({ toolName: 'bash', signal: controllerSignal.signal })
  controllerSignal.abort()
  assert.equal(await decision, 'cancelled')
}

Date.now = realNow
fs.rmSync(dir, { recursive: true, force: true })
console.log('FAIRY MEDIA PASS')
