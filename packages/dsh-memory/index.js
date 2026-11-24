/**
 * DSH「本地记忆」Host 插件（v2）。
 *
 * 刻意保持「零依赖」：只 import Node 内置模块和本包的相对路径，
 * 不 import @deepseek-ai/* —— 这样插件以 link/任意 profile 安装时都不会
 * 受模块解析或版本差异影响。
 *
 * 能力：
 * - `remember` / `recall` 两个工具，读写 ~/.dsh/memory/memory.md；
 * - 每个新会话（agent 创建）时把 pinned + 最近记忆注入 system prompt（≤ budgetChars）；
 * - 长对话滚动摘要：超过 N 轮或 M token 时生成本地抽取式摘要写入记忆库，
 *   原文逐事件另存为 ~/.dsh/memory/archives/<session>.jsonl；
 * - 给 Web 面板用的本机 RPC 通道 `/local-memory`（需要浏览器登录态）。
 *
 * 不联网、不做遥测、不读写记忆目录之外的用户文件。
 */

import { KINDS, MemoryStore, summarizeContent, resolveMemoryDirectory } from './lib/store.js'
import { SessionSummaryEngine } from './lib/session-summary.js'
import { readUiState, writeUiState } from './lib/ui-state.js'

export const name = 'local-memory'
export const inject = ['tools']

const SECTION_NAME = 'memory:local-context'
const SECTION_ORDER = 100
const RPC_CHANNEL = '/local-memory'
const REMEMBER_KIND_HINT =
	'fact（关于用户的稳定事实）、preference（用户偏好）、event（发生过的事）、note（其他笔记）；默认 note。'

const DEFAULT_CONFIG = {
	directory: '',
	recentLimit: 8,
	budgetChars: 1200,
	maxEntries: 5000,
	maxContentLength: 500,
	injectContext: true,
	summaryEnabled: true,
	summaryTurns: 60,
	summaryTokens: 8000,
}

const REMEMBER_PARAMETERS = {
	type: 'object',
	properties: {
		content: {
			type: 'string',
			description: 'The memory itself, written as a standalone statement (max 500 characters).',
		},
		kind: {
			type: 'string',
			enum: KINDS,
			description: `Classification: ${REMEMBER_KIND_HINT}`,
		},
		tags: {
			type: 'array',
			items: { type: 'string' },
			description: 'Optional short tags used by lexical recall, e.g. ["preference", "work"].',
		},
	},
	required: ['content'],
}

const REMEMBER_OUTPUT = {
	type: 'object',
	additionalProperties: false,
	properties: {
		id: { type: 'string' },
		created: { type: 'boolean' },
		kind: { type: 'string' },
		created_at: { type: 'string' },
		total: { type: 'integer' },
		path: { type: 'string' },
	},
	required: ['id', 'created', 'kind', 'created_at', 'total', 'path'],
}

const RECALL_PARAMETERS = {
	type: 'object',
	properties: {
		query: {
			type: 'string',
			description: 'Keywords to look for; multiple words are matched independently.',
		},
		limit: {
			type: 'number',
			description: 'Maximum number of entries to return (default 5, max 20).',
		},
	},
	required: ['query'],
}

const RECALL_OUTPUT = {
	type: 'object',
	additionalProperties: false,
	properties: {
		count: { type: 'integer' },
		total: { type: 'integer' },
		entries: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				properties: {
					id: { type: 'string' },
					kind: { type: 'string' },
					created_at: { type: 'string' },
					content: { type: 'string' },
					pinned: { type: 'boolean' },
					tags: { type: 'array', items: { type: 'string' } },
				},
				required: ['id', 'kind', 'created_at', 'content', 'pinned', 'tags'],
			},
		},
	},
	required: ['count', 'total', 'entries'],
}

/** 配置没有 schemastery 校验，这里做一次温和的类型规整。 */
function resolveConfig(raw) {
	const source = raw !== null && typeof raw === 'object' ? raw : {}
	const integer = (value, fallback, minimum, maximum) => {
		const number = typeof value === 'number' ? value : Number.NaN
		if (!Number.isFinite(number)) return fallback
		const rounded = Math.trunc(number)
		return Math.min(maximum, Math.max(minimum, rounded))
	}
	return {
		directory: typeof source.directory === 'string' ? source.directory : DEFAULT_CONFIG.directory,
		recentLimit: integer(source.recentLimit, DEFAULT_CONFIG.recentLimit, 0, 50),
		budgetChars: integer(source.budgetChars, DEFAULT_CONFIG.budgetChars, 0, 8000),
		maxEntries: integer(source.maxEntries, DEFAULT_CONFIG.maxEntries, 1, 1000000),
		maxContentLength: integer(source.maxContentLength, DEFAULT_CONFIG.maxContentLength, 1, 100000),
		injectContext: source.injectContext !== false,
		summaryEnabled: source.summaryEnabled !== false,
		summaryTurns: integer(source.summaryTurns, DEFAULT_CONFIG.summaryTurns, 1, 1000000),
		summaryTokens: integer(source.summaryTokens, DEFAULT_CONFIG.summaryTokens, 100, 100000000),
	}
}

export function apply(ctx, rawConfig) {
	const config = resolveConfig(rawConfig)
	const memoryDirectory = resolveMemoryDirectory(config.directory)
	const warn = (message) => {
		try {
			ctx.logger.warn(`local-memory: ${message}`)
		} catch {
			/* 日志失败不影响功能 */
		}
	}
	const store = new MemoryStore({
		directory: memoryDirectory,
		maxEntries: config.maxEntries,
		maxContentLength: config.maxContentLength,
		log: (file, error) => warn(`写入 ${file} 失败：${String(error?.message ?? error)}`),
	})

	try {
		const entries = store.entries()
		if (entries.length > 0) warn(`已加载 ${entries.length} 条本地记忆`)
	} catch (error) {
		warn(`记忆库初始化失败：${String(error?.message ?? error)}`)
	}

	const summaries = new SessionSummaryEngine({
		directory: memoryDirectory,
		store,
		enabled: config.summaryEnabled,
		turnThreshold: config.summaryTurns,
		tokenThreshold: config.summaryTokens,
		log: warn,
	})
	ctx.on('session/event', (session, event) => {
		try {
			summaries.observe(session, event)
		} catch (error) {
			warn(`滚动摘要失败：${String(error?.message ?? error)}`)
		}
	})

	ctx.tools.register({
		name: 'remember',
		description:
			'Save one durable memory to the user\'s private local memory store (plain files under ~/.dsh/memory, never uploaded). ' +
			'Use it for facts, preferences, events, or notes that would help in a future session. ' +
			'Content must be one self-contained line (max 500 characters). Identical content is deduplicated.',
		parameters: REMEMBER_PARAMETERS,
		output: {
			schema: REMEMBER_OUTPUT,
			render: (_args, value) => [
				{
					type: 'text',
					text: value.created
						? `已记住（${value.kind}，id: ${value.id}）。当前共 ${value.total} 条本地记忆，保存在 ${value.path}。`
						: `这条记忆已存在（id: ${value.id}），未重复写入。当前共 ${value.total} 条。`,
				},
			],
		},
		async execute(args, exec) {
			if (args === null || typeof args !== 'object' || typeof args.content !== 'string') {
				throw new Error('remember 需要字符串类型的 content。')
			}
			if (args.kind !== undefined && !KINDS.includes(args.kind)) {
				throw new Error(`kind 必须是 ${KINDS.join(' / ')} 之一。`)
			}
			if (args.tags !== undefined && (!Array.isArray(args.tags) || args.tags.some((tag) => typeof tag !== 'string'))) {
				throw new Error('tags 必须是字符串数组。')
			}
			const { entry, created } = store.remember({
				content: args.content,
				kind: args.kind,
				tags: args.tags,
				sessionId: sessionIdOf(exec),
			})
			return {
				id: entry.id,
				created,
				kind: entry.kind,
				created_at: entry.createdAtText,
				total: store.total(),
				path: store.memoryPath,
			}
		},
	})

	ctx.tools.register({
		name: 'recall',
		description:
			'Search the user\'s private local long-term memory saved in earlier sessions (facts, preferences, events, notes). ' +
			'Lexical keyword search, case-insensitive; results are ordered by number of keyword hits, then newest first. ' +
			'Use it when the user references past sessions, personal details, or something you may have saved before.',
		parameters: RECALL_PARAMETERS,
		output: {
			schema: RECALL_OUTPUT,
			render: (_args, value) => {
				if (value.count === 0) {
					return [
						{
							type: 'text',
							text: `没有找到匹配的记忆（本地记忆共 ${value.total} 条）。`,
						},
					]
				}
				const lines = value.entries.map(
					(entry) =>
						`- [${entry.kind}] ${entry.created_at} ${entry.content}` +
						`${entry.pinned ? '（固定）' : ''} (id: ${entry.id})`,
				)
				return [
					{
						type: 'text',
						text: `找到 ${value.count} 条（本地记忆共 ${value.total} 条）：\n${lines.join('\n')}`,
					},
				]
			},
		},
		async execute(args) {
			if (args === null || typeof args !== 'object' || typeof args.query !== 'string') {
				throw new Error('recall 需要字符串类型的 query。')
			}
			const result = store.recall({ query: args.query, limit: args.limit })
			return {
				count: result.entries.length,
				total: result.total,
				entries: result.entries.map(({ entry }) => ({
					id: entry.id,
					kind: entry.kind,
					created_at: entry.createdAtText,
					content: summarizeContent(entry.content),
					pinned: entry.pinned,
					tags: entry.tags,
				})),
			}
		},
	})

	/** 注入到新会话首轮 system prompt 的上下文；每个 agent 只计算一次快照。 */
	const disposers = new Map()
	const installContext = (agent) => {
		if (!config.injectContext) return
		if (disposers.has(agent.id)) return
		try {
			const snapshot = store.injection({ recentLimit: config.recentLimit, budgetChars: config.budgetChars })
			if (snapshot.text === '') return
			const fiber = agent.ctx.inject(['systemPrompt'], (scope) => {
				scope.systemPrompt.section({
					name: SECTION_NAME,
					order: SECTION_ORDER,
					text: snapshot.text,
					interpolate: false,
				})
			})
			disposers.set(agent.id, () => {
				try {
					fiber.dispose()
				} catch {
					/* 已被 agent 作用域释放 */
				}
			})
		} catch (error) {
			warn(`注入记忆上下文失败：${String(error?.message ?? error)}`)
		}
	}
	const forgetContext = (agent) => {
		const dispose = disposers.get(agent.id)
		if (dispose === undefined) return
		disposers.delete(agent.id)
		dispose()
	}

	ctx.on('agent/created', ({ agent }) => {
		installContext(agent)
	})
	ctx.on('agent/disposed', ({ agent }) => {
		forgetContext(agent)
	})
	ctx.effect(
		() => () => {
			for (const dispose of disposers.values()) dispose()
			disposers.clear()
		},
		'local-memory: dispose injected contexts',
	)

	const handleRpc = async (endpoint, payload) => {
		switch (endpoint) {
			case 'state': {
				const entries = store.entries()
				return {
					ok: true,
					value: {
						directory: memoryDirectory,
						total: entries.length,
						entries: entries.map(panelEntry).reverse(),
						summaries: summaries.summaries(),
						archives: summaries.archives(),
						ui: readUiState(memoryDirectory) ?? null,
						thresholds: { turns: config.summaryTurns, tokens: config.summaryTokens },
					},
				}
			}
			case 'search': {
				const query = String(payload?.query ?? '').trim()
				if (query === '') {
					const entries = store.entries()
					return { ok: true, value: { total: entries.length, entries: entries.map(panelEntry).reverse() } }
				}
				const result = store.recall({ query, limit: payload?.limit ?? 200 })
				return {
					ok: true,
					value: { total: result.total, entries: result.entries.map(({ entry }) => panelEntry(entry)) },
				}
			}
			case 'add': {
				const result = store.remember({
					content: String(payload?.content ?? ''),
					kind: typeof payload?.kind === 'string' ? payload.kind : 'note',
					tags: Array.isArray(payload?.tags) ? payload.tags : [],
					sessionId: 'web-panel',
				})
				return { ok: true, value: { id: result.entry.id, created: result.created, total: store.total() } }
			}
			case 'pin': {
				const entry = store.setPinned(String(payload?.id ?? ''), payload?.pinned === true)
				return { ok: true, value: { id: entry.id, pinned: entry.pinned, total: store.total() } }
			}
			case 'remove': {
				const total = store.remove(String(payload?.id ?? ''))
				return { ok: true, value: { total } }
			}
			case 'ui-ready': {
				const ui = writeUiState(memoryDirectory, payload)
				return { ok: true, value: ui }
			}
			default:
				return { ok: false, error: { code: 'local-memory/unknown-endpoint', message: `未知操作 ${endpoint}`, details: {} } }
		}
	}

	/**
	 * Web 面板使用的本机 RPC 路由 `/local-memory`。
	 *
	 * 不复用 connection.rpc.handle（该入口在当前版本要求连接插件自身 inject webServer），
	 * 而是直接注册 webServer 前缀路由，并复用 connection.admit() 做浏览器登录态校验；
	 * 协议与 Connection 单播 RPC 一致：POST JSON {type,rpcId,method,payload} →
	 * {type:'server-response',rpcId,result:{ok,value|error}}。
	 */
	ctx.inject(['connection', 'webServer'], (scope) => {
		const route = async (req, res) => {
			const admission = scope.connection.admit(req)
			if ('rejection' in admission) {
				res.writeHead(admission.rejection)
				res.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden')
				return
			}
			if (req.method !== 'POST') {
				res.writeHead(405)
				res.end()
				return
			}
			const contentType = String(req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase()
			if (contentType !== 'application/json') {
				res.writeHead(415)
				res.end('content type must be application/json')
				return
			}
			let raw = ''
			try {
				req.setEncoding('utf8')
				for await (const chunk of req) {
					raw += chunk
					if (raw.length > 1_000_000) throw new Error('body too large')
				}
			} catch (error) {
				res.writeHead(413)
				res.end()
				return
			}
			let message
			try {
				message = JSON.parse(raw)
			} catch {
				res.writeHead(400)
				res.end('body is not JSON')
				return
			}
			const pathname = (req.url ?? '').split('?', 1)[0]
			const endpoint = pathname.startsWith(`${RPC_CHANNEL}/`) ? pathname.slice(RPC_CHANNEL.length + 1) : ''
			const send = (result) => {
				res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
				res.end(JSON.stringify({ type: 'server-response', rpcId: message?.rpcId ?? 'invalid-request', result }))
			}
			if (
				message === null ||
				typeof message !== 'object' ||
				message.type !== 'client-request' ||
				typeof message.rpcId !== 'string' ||
				typeof message.method !== 'string' ||
				message.method !== endpoint ||
				endpoint === ''
			) {
				send({ ok: false, error: { code: 'gateway/bad-request', message: 'invalid client-request message', details: {} } })
				return
			}
			try {
				send(await handleRpc(endpoint, message.payload))
			} catch (error) {
				send({ ok: false, error: { code: 'local-memory/failed', message: String(error?.message ?? error), details: {} } })
			}
		}
		scope.effect(() => scope.webServer.register({ kind: 'prefix', path: RPC_CHANNEL, handler: route }), 'local-memory: panel rpc route')
	})


}

function panelEntry(entry) {
	return {
		id: entry.id,
		kind: entry.kind,
		content: entry.content,
		created_at: entry.createdAtText,
		tags: entry.tags,
		pinned: entry.pinned,
	}
}

function sessionIdOf(exec) {
	const session = exec?.agent?.session
	if (session === undefined || session === null) return undefined
	if (typeof session.id === 'string') return session.id
	if (typeof session.header?.id === 'string') return session.header.id
	return undefined
}
