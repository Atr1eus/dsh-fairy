/**
 * Fairy 的 Host 半边（零依赖）：
 * - 维护唯一一间 Fairy 会话（可恢复、可重建）；
 * - 提供 `/fairy` 本机 RPC：open / history / send / reset（浏览器登录态校验）；
 * - 每次打开且 Fairy 空闲时投递一句「主动打招呼」上下文；
 * - history 只回传用户与助手可见文本，供自绘的聊天气泡使用。
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

export const name = 'fairy'
export const inject = []

const CHANNEL = '/fairy'
const ICON_ROUTE = '/fairy-icon.png'
const STICKER_ROUTE = '/fairy-sticker.jpg'
const IMAGE_ROUTE = '/fairy-image'
let iconBytes
try {
	iconBytes = fs.readFileSync(new URL('./icon.png', import.meta.url))
} catch {
	iconBytes = undefined
}
let stickerBytes
try {
	stickerBytes = fs.readFileSync(new URL('./sticker.jpg', import.meta.url))
} catch {
	stickerBytes = undefined
}
const STATE_FILE = 'state.json'
const GREETING_WINDOW_MS = 30 * 60 * 1000
const HISTORY_LIMIT = 200
const GREETING =
	'（主人刚刚打开和你的对话。主动开口打个招呼：一两句就好，可以结合此刻的时间和你记得的事，' +
	'然后自然地问问他今天想聊点什么，或者有没有想让你做的事。）'

function resolveStateDirectory(value) {
	const raw = typeof value === 'string' ? value.trim() : ''
	if (raw !== '') {
		if (raw === '~') return os.homedir()
		if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2))
		return path.resolve(raw)
	}
	const home = process.env.DSH_HOME?.trim()
	const base = home !== undefined && home !== '' ? home : path.join(os.homedir(), '.dsh')
	return path.join(base, 'fairy')
}

function readState(file) {
	try {
		const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
		return parsed !== null && typeof parsed === 'object' ? parsed : {}
	} catch {
		return {}
	}
}

function writeState(file, value) {
	fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
	const temporary = `${file}.${process.pid}.tmp`
	fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
	fs.renameSync(temporary, file)
}

function textOf(content) {
	if (!Array.isArray(content)) return ''
	return content
		.filter((block) => block?.type === 'text' && typeof block.text === 'string')
		.map((block) => block.text)
		.join('\n')
		.trim()
}

function userMessage(text, kind) {
	return {
		id: crypto.randomUUID(),
		role: 'user',
		content: [{ type: 'text', text }],
		source: { kind },
	}
}

/** 表情包池：anime = 那张瞪眼吐舌的图，tangyuan 由客户端用 SVG 现画。 */
const STICKER_POOL = ['anime', 'tangyuan']
const STICKER_MARKS = { 汤圆: 'tangyuan', 表情包: 'anime' }

/**
 * 是否在这条回复后面带一张表情包：按 (session, seq) 做稳定哈希，约 12%。
 * 用哈希而不是 Math.random，保证轮询刷新时同一消息的判定不变。
 */
function stickerFor(sessionId, seq) {
	const digest = crypto.createHash('sha1').update(`sticker:${sessionId}:${seq}`).digest()
	if (digest[0] % 100 >= 12) return undefined
	return STICKER_POOL[digest[1] % STICKER_POOL.length]
}

/**
 * 表情包标记：`[汤圆]` / `[表情包]`。
 * - 整条回复只有标记 → 正文清空，只发一张表情包；
 * - 标记单独占最后一行 → 正文保留，末尾挂一张表情包；
 * - 标记夹在句子中间 → 当普通文字，不动。
 */
function parseStickerReply(text, sessionId, seq) {
	const pick = (mark) => {
		if (mark !== '表情包') return STICKER_MARKS[mark]
		const digest = crypto.createHash('sha1').update(`only:${sessionId}:${seq}`).digest()
		return STICKER_POOL[digest[0] % STICKER_POOL.length]
	}
	const only = /^\[(汤圆|表情包)\]$/.exec(text)
	if (only !== null) return { text: '', sticker: pick(only[1]) }
	const tail = /(?:^|\n)\s*\[(汤圆|表情包)\]\s*$/.exec(text)
	if (tail !== null) return { text: text.slice(0, tail.index).trim(), sticker: pick(tail[1]) }
	return undefined
}

/** sessionController.resolveAgent 返回 `{agent}` 或 `{error}`。 */
function unwrapAgent(found) {
	if (found === undefined || found === null) throw new Error('Fairy 会话不可用')
	if ('error' in found) throw found.error
	return found.agent ?? found
}

export function apply(ctx, rawConfig) {
	const agentPreset =
		typeof rawConfig?.agentPreset === 'string' && rawConfig.agentPreset !== '' ? rawConfig.agentPreset : 'companion'
	const directory = resolveStateDirectory(typeof rawConfig?.directory === 'string' ? rawConfig.directory : '')
	const stateFile = path.join(directory, STATE_FILE)
	let state = readState(stateFile)
	let lastGreetingAt = 0
	let pending = undefined
	const imageRefs = new Map()
	const pendingApprovals = new Map()
	const approvalDisposers = new Map()

	const warn = (message) => {
		try {
			ctx.logger.warn(`fairy: ${message}`)
		} catch {
			/* 日志失败不影响功能 */
		}
	}
	const debug = (event, extra) => {
		try {
			fs.appendFileSync(
				path.join(directory, 'debug.log'),
				`${new Date().toISOString()} ${event} ${JSON.stringify(extra ?? {})}\n`,
			)
		} catch {
			/* 诊断日志失败不影响功能 */
		}
	}

	const firstWorkspaceId = () => {
		try {
			const list = ctx.get('workspaceRegistry')?.list?.()
			return Array.isArray(list) && list.length > 0 ? list[0].id : undefined
		} catch {
			return undefined
		}
	}

	/**
	 * 给 Fairy 这个 agent 装一个 approval 回答者：
	 * 请求会进入 pendingApprovals，客户端轮询到后弹卡片，用户点「允许/拒绝」再 resolve。
	 * prepend 让它先于普通会话的审批 UI 接手，避免请求落到看不见的界面里。
	 */
	const installApprovals = (agent) => {
		const sessionId = agent.session.id
		if (approvalDisposers.has(sessionId)) return
		try {
			ctx.get('userApproval')?.setPolicy?.(agent, 'ask')
		} catch (error) {
			debug('approval-policy', { message: String(error?.message ?? error) })
		}
		let dispose
		try {
			dispose = agent.ctx.on(
				'approval/request',
				(request) =>
				new Promise((resolve) => {
					const key = crypto.randomUUID()
					let settled = false
					const finish = (outcome) => {
						if (settled) return
						settled = true
						pendingApprovals.delete(key)
						try {
							request.signal?.removeEventListener('abort', onAbort)
						} catch {
							/* ignore */
						}
						resolve(outcome)
					}
					const onAbort = () => finish('cancelled')
					pendingApprovals.set(key, {
						key,
						toolName: typeof request.toolName === 'string' ? request.toolName : 'tool',
						reason: typeof request.reason === 'string' ? request.reason : '',
						resolve: finish,
					})
					try {
						request.signal?.addEventListener('abort', onAbort, { once: true })
					} catch {
						/* ignore */
					}
					debug('approval-request', { key, toolName: request.toolName })
				}),
				{ prepend: true },
			)
			approvalDisposers.set(sessionId, dispose)
			debug('approval-installed', { sessionId })
		} catch (error) {
			debug('approval-install-error', { message: String(error?.message ?? error) })
		}
	}

	const ensureAgent = async (controller) => {
		const existing = typeof state.sessionId === 'string' ? state.sessionId : undefined
		if (existing !== undefined) {
			try {
				const agent = unwrapAgent(await controller.resolveAgent(existing))
				installApprovals(agent)
				return agent
			} catch (error) {
				warn(`旧会话不可用，将新建：${String(error?.message ?? error)}`)
			}
		}
		// 先试「不挂工作区、只做后台会话」；不支持再退回旧写法。
		let created
		try {
			created = await controller.create({ agentPreset, cwd: os.homedir() })
		} catch (error) {
			warn(`后台会话创建失败，退回工作区会话：${String(error?.message ?? error)}`)
			const workspaceId = firstWorkspaceId()
			created = await controller.create({
				agentPreset,
				...(workspaceId === undefined ? {} : { workspaceId }),
			})
		}
		state = { sessionId: created.sessionId, createdAt: new Date().toISOString() }
		writeState(stateFile, state)
		debug('session-created', { sessionId: created.sessionId })
		const agent = unwrapAgent(await controller.resolveAgent(created.sessionId))
		installApprovals(agent)
		return agent
	}

	/** 最近一条「真实用户」消息的时间（问候上下文不算）。 */
	const lastUserMessageAt = (agent) => {
		let latest
		for (const event of agent.session.snapshotEvents()) {
			if (event.type !== 'user/message') continue
			const kind = event.data?.source?.kind
			if (kind !== 'user' && kind !== 'fairy-user') continue
			if (typeof event.time === 'number' && (latest === undefined || event.time > latest)) latest = event.time
		}
		return latest
	}

	/**
	 * 问候规则（30 分钟窗口）：
	 * - Fairy 正在回复时不打断；
	 * - 距上一次问候 < 30 分钟 → 不再打；
	 * - 距用户上一条消息 < 30 分钟 → 不再打（刚聊过就别重复开场）。
	 */
	const greet = (agent, sessionId) => {
		if (agent.status !== 'idle') return { greeted: false, reason: 'busy' }
		const now = Date.now()
		const lastGreeting = typeof state.lastGreetingAt === 'number' ? state.lastGreetingAt : lastGreetingAt
		if (now - lastGreeting < GREETING_WINDOW_MS) return { greeted: false, reason: 'recent-greeting' }
		const lastUser = lastUserMessageAt(agent)
		if (lastUser !== undefined && now - lastUser < GREETING_WINDOW_MS) return { greeted: false, reason: 'recent-message' }
		try {
			agent.followup(userMessage(GREETING, 'fairy-open'))
		} catch (error) {
			debug('greet-error', { sessionId, message: String(error?.message ?? error) })
			throw error
		}
		lastGreetingAt = now
		state = { ...state, lastGreetingAt: now }
		try {
			writeState(stateFile, state)
		} catch (error) {
			warn(`无法保存问候时间：${String(error?.message ?? error)}`)
		}
		return { greeted: true, reason: 'ok' }
	}

	const history = (agent, sessionId) => {
		const events = agent.session.snapshotEvents()
		const messages = []
		for (const event of events) {
			if (event.type === 'user/message') {
				const kind = event.data?.source?.kind
				if (kind !== 'user' && kind !== 'fairy-user') continue
				const blocks = Array.isArray(event.data?.content) ? event.data.content : []
				const text = textOf(blocks)
				const clientId = typeof event.data?.source?.clientId === 'string' ? event.data.source.clientId : undefined
				if (text !== '') messages.push({ id: String(event.seq), seq: event.seq, role: 'user', text, time: event.time, ...(clientId === undefined ? {} : { clientId }) })
				blocks.forEach((block, index) => {
					if (block?.type !== 'image' || block.attachment === undefined) return
					const attachment = block.attachment
					imageRefs.set(attachment.attachmentId, attachment)
					messages.push({
						id: `${event.seq}-i${index}`,
						seq: event.seq + (index + 1) / 1000,
						role: 'user',
						text: '',
						time: event.time,
						...(clientId === undefined ? {} : { clientId }),
						image: {
							id: attachment.attachmentId,
							mediaType: attachment.mediaType,
							width: attachment.width,
							height: attachment.height,
						},
					})
				})
				continue
			}
			if (event.type === 'assistant/message') {
				const raw = textOf(event.data?.message?.content)
				const parsed = parseStickerReply(raw, sessionId, event.seq)
				const text = parsed === undefined ? raw : parsed.text
				const sticker = parsed === undefined ? stickerFor(sessionId, event.seq) : parsed.sticker
				if (text !== '' || sticker !== undefined) {
					messages.push({
						id: String(event.seq),
						seq: event.seq,
						role: 'assistant',
						text,
						time: event.time,
						sticker,
					})
				}
			}
		}
		return {
			sessionId,
			running: agent.status === 'running',
			messages: messages.slice(-HISTORY_LIMIT),
			approvals: [...pendingApprovals.values()].map(({ key, toolName, reason }) => ({ key, toolName, reason })),
		}
	}

	/** 与 Client Connection 同款 RPC 信封；鉴权复用 connection.admit()。 */
	ctx.inject(['connection', 'webServer', 'sessionController', 'attachments'], (scope) => {
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
					if (raw.length > 60_000_000) throw new Error('body too large')
				}
			} catch {
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
			const endpoint = pathname.startsWith(`${CHANNEL}/`) ? pathname.slice(CHANNEL.length + 1) : ''
			const payload = message?.payload ?? {}
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
				if (endpoint === 'open') {
					if (pending === undefined) {
						pending = (async () => {
							const agent = await ensureAgent(scope.sessionController)
							const greeting = greet(agent, state.sessionId)
							debug('open', { sessionId: state.sessionId, greeted: greeting.greeted, reason: greeting.reason, status: agent.status })
							return { sessionId: state.sessionId, greeted: greeting.greeted, reason: greeting.reason }
						})().finally(() => {
							pending = undefined
						})
					}
					send({ ok: true, value: await pending })
					return
				}
				if (endpoint === 'history') {
					const agent = await ensureAgent(scope.sessionController)
					send({ ok: true, value: history(agent, state.sessionId) })
					return
				}
				if (endpoint === 'send') {
					const text = String(payload.text ?? '').trim()
					const images = Array.isArray(payload.images) ? payload.images : []
					if (text === '' && images.length === 0) throw new Error('消息不能为空')
					const content = []
					if (text !== '') content.push({ type: 'text', text })
					for (const image of images) {
						if (typeof image?.data !== 'string' || typeof image?.mediaType !== 'string') {
							throw new Error('图片格式不正确')
						}
						content.push({
							type: 'image',
							mediaType: image.mediaType,
							data: image.data,
							...(typeof image.name === 'string' && image.name !== '' ? { name: image.name } : {}),
						})
					}
					const admitted = await scope.attachments.admitPromptContent(content)
					const clientId =
						typeof payload.clientId === 'string' && payload.clientId !== '' && payload.clientId.length <= 80
							? payload.clientId
							: undefined
					const agent = await ensureAgent(scope.sessionController)
					agent.followup({
						id: crypto.randomUUID(),
						role: 'user',
						content: admitted,
						source: { kind: 'fairy-user', ...(clientId === undefined ? {} : { clientId }) },
					})
					send({ ok: true, value: { sessionId: state.sessionId } })
					return
				}
				if (endpoint === 'approve') {
					const key = typeof payload.key === 'string' ? payload.key : ''
					const entry = pendingApprovals.get(key)
					if (entry === undefined) throw new Error('这条请求已经失效')
					entry.resolve(payload.allow === true ? 'allowed-once' : 'rejected')
					debug('approval-decided', { key, allow: payload.allow === true })
					send({ ok: true, value: { key } })
					return
				}
				if (endpoint === 'ping') {
					const agent = await ensureAgent(scope.sessionController)
					if (agent.status !== 'idle') {
						send({ ok: true, value: { pinged: false, reason: 'busy' } })
						return
					}
					agent.followup(userMessage('（主人点了「呼叫」，回应一声，简短自然一点。）', 'fairy-ping'))
					debug('ping', { sessionId: state.sessionId })
					send({ ok: true, value: { pinged: true } })
					return
				}
				if (endpoint === 'cancel') {
					const agent = await ensureAgent(scope.sessionController)
					agent.cancel({ kind: 'user' }, { keepInbox: true })
					debug('cancel', { sessionId: state.sessionId })
					send({ ok: true, value: { cancelled: true } })
					return
				}
				if (endpoint === 'reset') {
					state = {}
					writeState(stateFile, state)
					send({ ok: true, value: { sessionId: null } })
					return
				}
				send({ ok: false, error: { code: 'fairy/unknown-endpoint', message: `未知操作 ${endpoint}`, details: {} } })
			} catch (error) {
				debug('error', { endpoint, message: String(error?.message ?? error) })
				warn(`请求 ${endpoint} 失败：${String(error?.message ?? error)}`)
				send({ ok: false, error: { code: 'fairy/failed', message: String(error?.message ?? error), details: {} } })
			}
		}
		scope.effect(() => scope.webServer.register({ kind: 'prefix', path: CHANNEL, handler: route }), 'fairy: chat rpc route')
		scope.effect(
			() => () => {
				for (const entry of pendingApprovals.values()) entry.resolve('cancelled')
				pendingApprovals.clear()
				for (const dispose of approvalDisposers.values()) dispose()
				approvalDisposers.clear()
			},
			'fairy: approval cleanups',
		)
		scope.effect(
			() =>
				scope.webServer.register({
					kind: 'prefix',
					path: IMAGE_ROUTE,
					handler: async (req, res) => {
						const admission = scope.connection.admit(req)
						if ('rejection' in admission) {
							res.writeHead(admission.rejection)
							res.end()
							return
						}
						const pathname = (req.url ?? '').split('?', 1)[0]
						const id = decodeURIComponent(pathname.slice(IMAGE_ROUTE.length + 1))
						const ref = imageRefs.get(id)
						if (ref === undefined) {
							res.writeHead(404)
							res.end()
							return
						}
						try {
							const read = await scope.attachments.readImage(ref)
							res.writeHead(200, {
								'content-type': ref.mediaType,
								'cache-control': 'private, max-age=3600',
							})
							res.end(req.method === 'HEAD' ? undefined : Buffer.from(read.data))
						} catch {
							res.writeHead(404)
							res.end()
						}
					},
				}),
			'fairy: chat image route',
		)
		scope.effect(
			() =>
				scope.webServer.register({
					kind: 'exact',
					path: STICKER_ROUTE,
					handler: (req, res) => {
						if (stickerBytes === undefined) {
							res.writeHead(404)
							res.end()
							return
						}
						res.writeHead(200, {
							'content-type': 'image/jpeg',
							'cache-control': 'public, max-age=86400',
						})
						res.end(req.method === 'HEAD' ? undefined : stickerBytes)
					},
				}),
			'fairy: sticker route',
		)
		scope.effect(
			() =>
				scope.webServer.register({
					kind: 'exact',
					path: ICON_ROUTE,
					handler: (req, res) => {
						if (iconBytes === undefined) {
							res.writeHead(404)
							res.end()
							return
						}
						res.writeHead(200, {
							'content-type': 'image/png',
							'cache-control': 'public, max-age=86400',
						})
						res.end(req.method === 'HEAD' ? undefined : iconBytes)
					},
				}),
			'fairy: icon route',
		)
	})
}
