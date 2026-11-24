/**
 * 长对话滚动摘要。
 *
 * 触发条件（可配置）：累计轮数超过 `summaryTurns`（默认 60）或累计 token 估算超过
 * `summaryTokens`（默认 8000）。触发时：
 *   1. 把本轮涉及的消息抽取成一条简短摘要，写入记忆库（kind=note，标签 summary）；
 *   2. 原文另存为 `archives/<sessionId>.jsonl`（逐事件追加，含 user/assistant/tool）；
 *   3. 状态写入 `summaries/<sessionId>.json`（已覆盖到的轮次/seq、历次摘要）。
 *
 * 摘要是本地抽取式的：不调用模型、不联网，成本为零；细节以 JSONL 原文为准。
 */

import fs from 'node:fs'
import path from 'node:path'
import { formatLocalIso } from './store.js'

const ARCHIVE_DIRECTORY = 'archives'
const SUMMARY_DIRECTORY = 'summaries'
const MAX_ROLLS = 50
const ARCHIVED_EVENT_TYPES = new Set(['user/message', 'assistant/message', 'tool/call', 'tool/result'])
const SUMMARY_MAX_CHARS = 480

/** 粗略 token 估算：CJK 约 1.5 字/token，其它约 4 字符/token。 */
export function estimateTokens(text) {
	let cjk = 0
	let other = 0
	for (const char of String(text)) {
		const code = char.codePointAt(0) ?? 0
		if (
			(code >= 0x3040 && code <= 0x30ff) ||
			(code >= 0x3400 && code <= 0x4dbf) ||
			(code >= 0x4e00 && code <= 0x9fff) ||
			(code >= 0xf900 && code <= 0xfaff)
		) {
			cjk += 1
		} else {
			other += 1
		}
	}
	return Math.ceil(cjk * 1.5 + other / 4)
}

function clip(text, length) {
	const chars = Array.from(text)
	return chars.length <= length ? text : `${chars.slice(0, length - 1).join('')}…`
}

function oneLine(text, length) {
	return clip(String(text).replace(/\s+/g, ' ').trim(), length)
}

function textOf(content) {
	if (!Array.isArray(content)) return ''
	return content
		.filter((block) => block?.type === 'text' && typeof block.text === 'string')
		.map((block) => block.text)
		.join('\n')
		.trim()
}

function pickSamples(items, count) {
	if (items.length <= count) return items
	const indexes = new Set()
	if (count === 1) indexes.add(items.length - 1)
	else if (count === 2) {
		indexes.add(0)
		indexes.add(items.length - 1)
	} else {
		indexes.add(0)
		indexes.add(Math.floor(items.length / 2))
		indexes.add(items.length - 1)
	}
	return [...indexes].map((index) => items[index])
}

function buildSummary({ sessionId, fromTurn, toTurn, rounds, tokens, messages, tools, archive }) {
	const day = formatLocalIso().slice(0, 10)
	const users = messages.filter((message) => message.role === 'user')
	const assistants = messages.filter((message) => message.role === 'assistant')
	const lines = []
	for (const message of pickSamples(users, 3)) lines.push(`- 用户：${oneLine(message.text, 70)}`)
	for (const message of pickSamples(assistants, 2)) lines.push(`- 助手：${oneLine(message.text, 70)}`)
	if (tools.length > 0) lines.push(`- 工具：${tools.slice(0, 6).join('、')}`)
	const head =
		`会话摘要（第 ${fromTurn}–${toTurn} 轮，约 ${tokens} tokens，${day}，` +
		`session ${sessionId.slice(-8)}，原文 ${archive}）`
	return clip([head, ...lines].join('\n'), SUMMARY_MAX_CHARS)
}

/** 读取一份摘要状态文件；不存在或损坏时返回 undefined。 */
function readSummaryRecord(directory, sessionId) {
	try {
		const file = path.join(directory, SUMMARY_DIRECTORY, `${sessionId}.json`)
		const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
		return typeof parsed === 'object' && parsed !== null ? parsed : undefined
	} catch {
		return undefined
	}
}

function atomicWrite(file, contents) {
	const temporary = `${file}.${process.pid}.tmp`
	fs.writeFileSync(temporary, contents, { encoding: 'utf8', mode: 0o600 })
	fs.renameSync(temporary, file)
}

/** 长对话滚动摘要引擎；每个会话在内存里维护一段待摘要内容。 */
export class SessionSummaryEngine {
	constructor(options) {
		this.directory = options.directory
		this.store = options.store
		this.turnThreshold = options.turnThreshold ?? 60
		this.tokenThreshold = options.tokenThreshold ?? 8000
		this.enabled = options.enabled !== false
		this.log = options.log ?? (() => {})
		this.sessions = new Map()
	}

	observe(session, event) {
		if (!this.enabled) return
		if (typeof session?.id !== 'string' || typeof event?.type !== 'string') return
		const depth = session.header?.delegationDepth ?? 0
		if (depth > 0) return
		const state = this.stateOf(session.id)
		if (typeof event.seq !== 'number' || event.seq <= state.lastSeq) return
		state.lastSeq = event.seq
		if (event.type === 'turn/end') {
			state.pendingRounds += 1
			if (state.pendingRounds >= this.turnThreshold || state.pendingTokens >= this.tokenThreshold) {
				this.roll(session.id, state, event.data?.turn, event.seq)
			}
			return
		}
		if (!ARCHIVED_EVENT_TYPES.has(event.type)) return
		this.archive(session.id, event)
		if (event.type === 'user/message') {
			const text = textOf(event.data?.content)
			if (text !== '') this.pushMessage(state, event, 'user', text)
		} else if (event.type === 'assistant/message') {
			const text = textOf(event.data?.message?.content)
			if (text !== '') this.pushMessage(state, event, 'assistant', text)
		} else if (event.type === 'tool/call') {
			const name = event.data?.name
			if (typeof name === 'string') state.tools.add(name)
		}
	}

	stateOf(sessionId) {
		const existing = this.sessions.get(sessionId)
		if (existing !== undefined) return existing
		const record = readSummaryRecord(this.directory, sessionId)
		const state = {
			sessionId,
			coveredSeq: typeof record?.coveredSeq === 'number' ? record.coveredSeq : 0,
			coveredTurn: typeof record?.coveredTurn === 'number' ? record.coveredTurn : 0,
			lastSeq: this.lastArchivedSeq(sessionId),
			pendingRounds: 0,
			pendingTokens: 0,
			startTurn: undefined,
			messages: [],
			tools: new Set(),
		}
		this.sessions.set(sessionId, state)
		return state
	}

	lastArchivedSeq(sessionId) {
		try {
			const file = path.join(this.directory, ARCHIVE_DIRECTORY, `${sessionId}.jsonl`)
			const text = fs.readFileSync(file, 'utf8')
			const lines = text.split('\n')
			for (let index = lines.length - 1; index >= 0; index -= 1) {
				const line = lines[index]
				if (line === undefined || line.trim() === '') continue
				try {
					const record = JSON.parse(line)
					if (typeof record.seq === 'number') return record.seq
				} catch {
					/* 忽略损坏的末行 */
				}
				return 0
			}
		} catch {
			/* 还没有归档文件 */
		}
		return 0
	}

	archive(sessionId, event) {
		try {
			const directory = path.join(this.directory, ARCHIVE_DIRECTORY)
			fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
			const record = {
				session_id: sessionId,
				type: event.type,
				seq: event.seq,
				time: event.time,
				data: event.data,
			}
			fs.appendFileSync(path.join(directory, `${sessionId}.jsonl`), `${JSON.stringify(record)}\n`, { mode: 0o600 })
		} catch (error) {
			this.log(`归档原文失败：${String(error?.message ?? error)}`)
		}
	}

	pushMessage(state, event, role, text) {
		if (state.startTurn === undefined && typeof event.data?.turn === 'number') state.startTurn = event.data.turn
		state.messages.push({ role, text, turn: event.data?.turn })
		state.pendingTokens += estimateTokens(text)
	}

	roll(sessionId, state, turn, seq) {
		if (typeof turn !== 'number') turn = state.coveredTurn + state.pendingRounds
		const fromTurn = state.startTurn ?? state.coveredTurn + 1
		const archive = `${ARCHIVE_DIRECTORY}/${sessionId}.jsonl`
		const content = buildSummary({
			sessionId,
			fromTurn,
			toTurn: turn,
			rounds: state.pendingRounds,
			tokens: state.pendingTokens,
			messages: state.messages,
			tools: [...state.tools],
			archive,
		})
		let entryId
		try {
			const result = this.store.remember({
				content,
				kind: 'note',
				tags: ['summary', `session-${sessionId.slice(-8)}`, `turns-${fromTurn}-${turn}`],
				sessionId,
			})
			entryId = result.entry.id
		} catch (error) {
			this.log(`写入会话摘要失败：${String(error?.message ?? error)}`)
		}
		try {
			const record = readSummaryRecord(this.directory, sessionId) ?? { session_id: sessionId, rolls: [] }
			const rolls = Array.isArray(record.rolls) ? record.rolls : []
			rolls.push({
				from_turn: fromTurn,
				to_turn: turn,
				rounds: state.pendingRounds,
				tokens: state.pendingTokens,
				summary: content,
				entry_id: entryId,
				archive,
				time: formatLocalIso(),
			})
			record.session_id = sessionId
			record.coveredSeq = seq
			record.coveredTurn = turn
			record.updated_at = formatLocalIso()
			record.rolls = rolls.slice(-MAX_ROLLS)
			const directory = path.join(this.directory, SUMMARY_DIRECTORY)
			fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
			atomicWrite(path.join(directory, `${sessionId}.json`), `${JSON.stringify(record, null, 2)}\n`)
		} catch (error) {
			this.log(`写入摘要状态失败：${String(error?.message ?? error)}`)
		}
		state.coveredSeq = seq
		state.coveredTurn = turn
		state.pendingRounds = 0
		state.pendingTokens = 0
		state.startTurn = undefined
		state.messages = []
		state.tools = new Set()
	}

	/** 面板用：列出所有会话摘要（新的在前）。 */
	summaries() {
		const directory = path.join(this.directory, SUMMARY_DIRECTORY)
		let names = []
		try {
			names = fs.readdirSync(directory).filter((name) => name.endsWith('.json'))
		} catch {
			return []
		}
		const result = []
		for (const name of names) {
			const sessionId = name.slice(0, -'.json'.length)
			const record = readSummaryRecord(this.directory, sessionId)
			if (record === undefined) continue
			result.push({
				session_id: sessionId,
				updated_at: typeof record.updated_at === 'string' ? record.updated_at : '',
				covered_turn: record.coveredTurn ?? 0,
				rolls: Array.isArray(record.rolls)
					? record.rolls.slice(-5).map((roll) => ({
							from_turn: roll.from_turn,
							to_turn: roll.to_turn,
							rounds: roll.rounds,
							tokens: roll.tokens,
							time: roll.time,
							archive: roll.archive,
						}))
					: [],
			})
		}
		return result.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
	}

	/** 面板用：列出原文归档（文件、大小、是否可读）。 */
	archives() {
		const directory = path.join(this.directory, ARCHIVE_DIRECTORY)
		let names = []
		try {
			names = fs.readdirSync(directory).filter((name) => name.endsWith('.jsonl'))
		} catch {
			return []
		}
		const result = []
		for (const name of names) {
			try {
				const stat = fs.statSync(path.join(directory, name))
				result.push({ session_id: name.slice(0, -'.jsonl'.length), bytes: stat.size, updated_at: formatLocalIso(stat.mtime) })
			} catch {
				/* 跳过不可读文件 */
			}
		}
		return result.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
	}
}
