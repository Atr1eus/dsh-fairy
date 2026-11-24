/**
 * 本地自检脚本（不依赖 DSH 运行时，只用 node 内置模块）：
 *   node test/self-check.mjs
 *
 * 覆盖：写入/去重/上限/淘汰/检索/注入预算/手工 pin/index 重建/滚动摘要。
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MemoryStore, MEMORY_FILE, INDEX_FILE } from '../lib/store.js'
import { SessionSummaryEngine } from '../lib/session-summary.js'

const results = []
function check(name, fn) {
	try {
		fn()
		results.push(`PASS ${name}`)
	} catch (error) {
		results.push(`FAIL ${name}: ${error?.message ?? error}`)
		throw error
	}
}

function tempDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memory-check-'))
}

function newStore(directory, extra = {}) {
	return new MemoryStore({ directory, maxEntries: 5000, maxContentLength: 500, ...extra })
}

const directory = tempDir()

check('写入一条记忆并生成 memory.md / index.json', () => {
	const store = newStore(directory)
	const result = store.remember({ content: '用户偏好中文沟通', kind: 'preference', tags: ['语言', '偏好'], sessionId: 'session-a' })
	assert.equal(result.created, true)
	assert.match(result.entry.id, /^mem_[0-9a-f]{12}$/)
	const text = fs.readFileSync(path.join(directory, MEMORY_FILE), 'utf8')
	assert.match(text, /^- \[preference\] \(.+\) 用户偏好中文沟通 #语言 #偏好 <!-- session=session-a -->$/m)
	assert.ok(fs.existsSync(path.join(directory, INDEX_FILE)))
})

check('完全相同正文去重并返回已有 id', () => {
	const store = newStore(directory)
	const first = store.remember({ content: '用户偏好中文沟通', kind: 'note' })
	assert.equal(first.created, false)
	assert.equal(store.total(), 1)
})

check('正文超过 500 字被拒绝', () => {
	const store = newStore(directory)
	assert.throws(() => store.remember({ content: '字'.repeat(501) }), /超过上限/)
	assert.equal(store.total(), 1)
})

check('检索大小写不敏感、按命中数排序', () => {
	const store = newStore(directory)
	store.remember({ content: 'DSH 插件开发笔记', kind: 'note' })
	store.remember({ content: 'dsh 插件 插件 插件 优先', kind: 'note' })
	const result = store.recall({ query: 'DSH 插件' })
	assert.equal(result.total, 3)
	assert.equal(result.entries.length, 2)
	assert.ok(result.entries[0].entry.content.includes('插件 插件'))
})

check('删除 index.json 后仍可完整重建（id 不变）', () => {
	const before = newStore(directory).entries().map((entry) => entry.id).sort()
	fs.rmSync(path.join(directory, INDEX_FILE))
	const after = newStore(directory).entries().map((entry) => entry.id).sort()
	assert.deepEqual(after, before)
	assert.ok(fs.existsSync(path.join(directory, INDEX_FILE)))
})

check('手工加 !pinned 后重载生效，并优先注入', () => {
	const file = path.join(directory, MEMORY_FILE)
	const text = fs.readFileSync(file, 'utf8')
	fs.writeFileSync(file, text.replace('用户偏好中文沟通', '用户偏好中文沟通 !pinned'))
	const snapshot = newStore(directory).injection({ recentLimit: 8, budgetChars: 1200 })
	const lines = snapshot.text.split('\n')
	assert.ok(lines.some((line) => line.includes('用户偏好中文沟通')))
	assert.ok(snapshot.text.startsWith('[Local memory'))
})

check('pinned 被淘汰保护，超出上限时淘汰最旧的非 pinned', () => {
	const dir = tempDir()
	const store = newStore(dir, { maxEntries: 3 })
	store.remember({ content: 'pin 我', kind: 'fact' })
	const first = newStore(dir).entries()[0]
	store.setPinned(first.id, true)
	store.remember({ content: '第二' })
	store.remember({ content: '第三' })
	store.remember({ content: '第四' })
	const entries = newStore(dir).entries()
	assert.equal(entries.length, 3)
	assert.ok(entries.some((entry) => entry.content === 'pin 我'))
	assert.ok(!entries.some((entry) => entry.content === '第二'))
})

check('50 条记忆的注入文本不超过 1200 字符，并注明未展示条数', () => {
	const dir = tempDir()
	const store = newStore(dir)
	for (let index = 0; index < 50; index += 1) {
		store.remember({ content: `第 ${index + 1} 条记忆：这是一段用来测试注入预算的中文内容，包含一些细节。`, kind: 'fact' })
	}
	store.setPinned(store.entries()[3].id, true)
	const snapshot = store.injection({ recentLimit: 8, budgetChars: 1200 })
	assert.ok(snapshot.text.length <= 1200, `length=${snapshot.text.length}`)
	assert.ok(snapshot.omitted > 0)
	assert.ok(snapshot.text.includes('未展示'))
	assert.ok(snapshot.text.includes('第 4 条记忆'))
})

check('自定义预算 300 字符仍然不超限', () => {
	const dir = tempDir()
	const store = newStore(dir)
	for (let index = 0; index < 20; index += 1) store.remember({ content: `记忆 ${index} 的内容稍微长一点点，用来触发截断。` })
	const snapshot = store.injection({ recentLimit: 8, budgetChars: 300 })
	assert.ok(snapshot.text.length <= 300)
})

check('滚动摘要：第 60 轮后生成摘要、归档原文并写入记忆', () => {
	const dir = tempDir()
	const store = newStore(dir)
	const engine = new SessionSummaryEngine({
		directory: dir,
		store,
		turnThreshold: 60,
		tokenThreshold: 8000,
		log: () => {},
	})
	const session = { id: 'session-rolling-test', header: { delegationDepth: 0 } }
	let seq = 1
	const emit = (type, data) => engine.observe(session, { type, seq: seq++, time: Date.now(), data })
	for (let turn = 1; turn <= 60; turn += 1) {
		emit('user/message', { turn, content: [{ type: 'text', text: `第 ${turn} 轮用户提问：帮我看看论文格式` }] })
		emit('assistant/message', { turn, step: 1, message: { content: [{ type: 'text', text: `第 ${turn} 轮助手回答：已经处理好了` }] } })
		emit('tool/call', { turn, name: 'bash', arguments: '{}' })
		emit('turn/end', { turn, reason: { kind: 'completed' } })
	}
	const summaryFile = path.join(dir, 'summaries', 'session-rolling-test.json')
	assert.ok(fs.existsSync(summaryFile), '缺少 summaries 文件')
	const record = JSON.parse(fs.readFileSync(summaryFile, 'utf8'))
	assert.equal(record.rolls.length, 1)
	assert.equal(record.rolls[0].from_turn, 1)
	assert.equal(record.rolls[0].to_turn, 60)
	const archive = path.join(dir, 'archives', 'session-rolling-test.jsonl')
	assert.ok(fs.existsSync(archive))
	const lines = fs.readFileSync(archive, 'utf8').trim().split('\n')
	assert.ok(lines.length >= 60 * 3)
	assert.equal(store.entries().filter((entry) => entry.tags.includes('summary')).length, 1)
	const summaryEntry = store.entries().find((entry) => entry.tags.includes('summary'))
	assert.match(summaryEntry.content, /^会话摘要（第 1–60 轮/)
	assert.ok(fs.readFileSync(path.join(dir, MEMORY_FILE), 'utf8').includes('会话摘要'))
})

check('滚动摘要：下一个 60 轮生成第二条，覆盖轮次推进', () => {
	const dir = tempDir()
	const store = newStore(dir)
	const engine = new SessionSummaryEngine({ directory: dir, store, turnThreshold: 60, tokenThreshold: 8000, log: () => {} })
	const session = { id: 'session-rolling-two', header: { delegationDepth: 0 } }
	let seq = 1
	const emit = (type, data) => engine.observe(session, { type, seq: seq++, time: Date.now(), data })
	for (let turn = 1; turn <= 120; turn += 1) {
		emit('user/message', { turn, content: [{ type: 'text', text: `第 ${turn} 轮提问` }] })
		emit('assistant/message', { turn, step: 1, message: { content: [{ type: 'text', text: `第 ${turn} 轮回答` }] } })
		emit('turn/end', { turn, reason: { kind: 'completed' } })
	}
	const record = JSON.parse(fs.readFileSync(path.join(dir, 'summaries', 'session-rolling-two.json'), 'utf8'))
	assert.equal(record.rolls.length, 2)
	assert.equal(record.rolls[1].from_turn, 61)
	assert.equal(record.rolls[1].to_turn, 120)
	assert.equal(record.coveredTurn, 120)
})

check('token 阈值：8k 以内不触发，超过触发', () => {
	const dir = tempDir()
	const store = newStore(dir)
	const engine = new SessionSummaryEngine({ directory: dir, store, turnThreshold: 999, tokenThreshold: 1000, log: () => {} })
	const session = { id: 'session-token-test', header: { delegationDepth: 0 } }
	let seq = 1
	const emit = (type, data) => engine.observe(session, { type, seq: seq++, time: Date.now(), data })
	emit('user/message', { turn: 1, content: [{ type: 'text', text: '短问题' }] })
	emit('turn/end', { turn: 1, reason: { kind: 'completed' } })
	assert.ok(!fs.existsSync(path.join(dir, 'summaries', 'session-token-test.json')))
	emit('user/message', { turn: 2, content: [{ type: 'text', text: '长'.repeat(2000) }] })
	emit('turn/end', { turn: 2, reason: { kind: 'completed' } })
	assert.ok(fs.existsSync(path.join(dir, 'summaries', 'session-token-test.json')))
})

check('子代理会话（delegationDepth > 0）不参与滚动摘要', () => {
	const dir = tempDir()
	const store = newStore(dir)
	const engine = new SessionSummaryEngine({ directory: dir, store, turnThreshold: 1, tokenThreshold: 1, log: () => {} })
	const session = { id: 'session-sub', header: { delegationDepth: 1 } }
	engine.observe(session, { type: 'user/message', seq: 1, time: Date.now(), data: { turn: 1, content: [{ type: 'text', text: '子代理' }] } })
	engine.observe(session, { type: 'turn/end', seq: 2, time: Date.now(), data: { turn: 1 } })
	assert.ok(!fs.existsSync(path.join(dir, 'summaries', 'session-sub.json')))
})

console.log(results.join('\n'))
console.log(`\n全部通过：${results.length} 项`)
