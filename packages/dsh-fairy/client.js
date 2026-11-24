/**
 * Fairy 的 Web 客户端：侧边栏「Fairy」入口 + iMessage 风格聊天面板。
 *
 * - 入口在 sidebar.panellist（和「插件 / 自动化任务 / 本地记忆」同一组）；
 * - 页面是独立的 main 面板：蓝色/灰色气泡、时间分隔、无逐条头像、圆形发送键；
 * - 每次进入面板都会 /fairy/open，Host 在允许时让她主动打招呼；
 * - 只走同源本机 RPC，不发起外部请求。
 */

window.__ModuleLoader__.load({
	id: 'dsh-fairy',
	factory(require) {
		const React = require('react')
		const h = React.createElement
		const { useCallback, useEffect, useRef, useState } = React

		const NS = 'fairy'

		const zh = {
			entry: 'Fairy',
			title: 'Fairy',
			subtitle: '高级智能构造体',
			placeholder: '发信息…',
			send: '发送',
			typing: '正在输入…',
			stop: '停止',
			empty: '',
			error: '连线失败',
			retry: '重试',
			jump: '回到底部',
			today: '今天',
			newChat: '新对话',
			attach: '添加图片',
			allow: '允许一次',
			deny: '拒绝',
			approvalAsk: 'Fairy 需要你的允许：',
			lastActive: '上次活跃：',
			justNow: '刚刚',
			call: '呼叫',
			computer: 'Fairy 的电脑',
			ready: '已就绪',
			devices: '设备',
			thisMac: '这台 Mac',
			yesterday: '昨天',
		}
		const en = {
			entry: 'Fairy',
			title: 'Fairy',
			subtitle: 'Advanced intelligent construct',
			placeholder: 'iMessage',
			send: 'Send',
			typing: 'typing…',
			stop: 'Stop',
			empty: '',
			error: 'Connection failed',
			retry: 'Retry',
			jump: 'Jump to latest',
			today: 'Today',
			newChat: 'New chat',
			attach: 'Add image',
			allow: 'Allow once',
			deny: 'Deny',
			approvalAsk: 'Fairy needs your permission:',
			lastActive: 'Last active: ',
			justNow: 'just now',
			call: 'Call',
			computer: "Fairy's computer",
			ready: 'Ready',
			devices: 'Devices',
			thisMac: 'This Mac',
			yesterday: 'Yesterday',
		}

		const CSS = `
.fa-page { position: relative; height: 100%; display: flex; flex-direction: column; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); }
.fa-head { position: absolute; top: 0; left: 0; right: 0; z-index: 2; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 10px 16px 24px; pointer-events: none;
  background: linear-gradient(to bottom, var(--dsw-alias-bg-base) 0%, color-mix(in srgb, var(--dsw-alias-bg-base) 78%, transparent) 52%, transparent 100%); }
.fa-name { font-size: 14px; font-weight: 600; line-height: 18px; }
.fa-status { font-size: 12px; line-height: 14px; color: var(--dsw-alias-label-secondary); }
.fa-new { position: absolute; right: 14px; top: 12px; z-index: 2; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 999px; cursor: pointer; }
.fa-new:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.fa-stop-float { position: absolute; right: 82px; top: 12px; z-index: 2; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 999px; cursor: pointer; }
.fa-body { flex: 1; overflow-y: auto; padding: 104px 18px 132px; }
.fa-list { max-width: 780px; margin: 0 auto; display: flex; flex-direction: column; }
.fa-time-sep { align-self: center; margin: 16px 0 8px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.fa-time-sep:first-child { margin-top: 2px; }
.fa-row { display: flex; margin-top: 2px; }
.fa-row-her { justify-content: flex-start; }
.fa-row-me { justify-content: flex-end; }
.fa-row.fa-group-start { margin-top: 10px; }
.fa-stack { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; max-width: 76%; }
.fa-row-me .fa-stack { align-items: flex-end; }
.fa-bubble { position: relative; max-width: 100%; padding: 11px 17px; border-radius: 20px; font-size: 16px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.fa-bubble-her { background: #e9e9eb; color: #0b0b0c; }
body[data-ds-dark-theme] .fa-bubble-her { background: #2a2a2c; color: #f2f2f2; }
.fa-bubble-me { background: #0a84ff; color: #ffffff; }
.fa-sticker { width: 150px; max-width: 100%; border-radius: 16px; display: block; }
.fa-sticker-only { width: 180px; }
.fa-bubble.fa-same-her { border-top-left-radius: 8px; }
.fa-bubble.fa-same-me { border-top-right-radius: 8px; }
.fa-typing { display: inline-flex; align-items: center; gap: 4px; padding: 10px 14px; }
.fa-dot { width: 6px; height: 6px; border-radius: 50%; background: #8e8e93; animation: fa-bounce 1.2s infinite; }
.fa-dot:nth-child(2) { animation-delay: .15s; }
.fa-dot:nth-child(3) { animation-delay: .3s; }
@keyframes fa-bounce { 0%, 60%, 100% { opacity: .35; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-2px); } }
.fa-error { margin: 0 auto 8px; max-width: 720px; font-size: 12px; color: #ef4444; display: flex; gap: 8px; align-items: center; }
.fa-error button { font: inherit; font-size: 12px; color: inherit; background: transparent; border: 1px solid currentColor; border-radius: 999px; padding: 2px 10px; cursor: pointer; }
.fa-jump { position: absolute; right: 24px; bottom: 112px; width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-button-elevated-fill); color: var(--dsw-alias-label-secondary); font-size: 15px; line-height: 1; cursor: pointer; z-index: 2; box-shadow: 0 2px 6px rgba(0, 0, 0, .18); }
.fa-jump:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-button-floating-hover); }
.fa-composer { position: absolute; left: 0; right: 0; bottom: 0; z-index: 2; padding: 28px 14px 10px;
  background: linear-gradient(to top, var(--dsw-alias-bg-base) 0%, color-mix(in srgb, var(--dsw-alias-bg-base) 78%, transparent) 45%, transparent 100%); }
.fa-composer-inner { max-width: 780px; margin: 0 auto; display: flex; gap: 8px; align-items: flex-end; }
.fa-field { flex: 1; display: flex; align-items: center; gap: 4px; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l2); border-radius: 23px;
  background: var(--dsw-specific-input-major, var(--dsw-alias-button-elevated-fill));
  padding: 4px 4px 4px 10px; height: 46px; min-height: 46px; }
.fa-field:focus-within { border-color: var(--dsw-alias-border-l4); }
.fa-input { flex: 1; box-sizing: border-box; height: 36px; min-height: 36px; max-height: 36px; resize: none; border: 0; background: transparent; color: inherit; font: inherit; font-size: 15px; line-height: 1.5; padding: 6px 0; margin: 0; outline: none; align-self: center; }
.fa-input::placeholder { color: var(--dsw-alias-label-secondary); }
.fa-quick { flex: none; align-self: flex-end; box-sizing: border-box; height: 46px; padding: 0 16px; border-radius: 23px;
  display: inline-flex; align-items: center; gap: 7px;
  border: 1px solid rgba(0, 0, 0, .08);
  background: linear-gradient(180deg, #ffffff, #f1f1f4);
  color: #4a4a4f; font: inherit; font-size: 12px; font-weight: 600; letter-spacing: .14em; cursor: pointer;
  box-shadow: inset 0 1px 0 #ffffff, 0 1px 2px rgba(0, 0, 0, .06);
  transition: border-color .15s ease, background .15s ease, color .15s ease, transform .1s ease; }
.fa-quick::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: #b8515a;
  box-shadow: 0 0 0 2px rgba(184, 81, 90, .12); flex: none; }
.fa-quick:hover { color: #1f1f22; border-color: rgba(0, 0, 0, .16); background: linear-gradient(180deg, #ffffff, #f7f7f9); }
.fa-quick:active { transform: translateY(1px); }
.fa-quick-aug { color: #8a6a2a; }
.fa-quick-aug::before { background: #c9a054; box-shadow: 0 0 0 2px rgba(201, 160, 84, .14); }
.fa-quick-aug:hover { color: #4a3208; }
body[data-ds-dark-theme] .fa-quick { border-color: rgba(255, 255, 255, .09);
  background: linear-gradient(180deg, rgba(255, 255, 255, .055), rgba(255, 255, 255, .015)), #19191b;
  color: #d7d7db; box-shadow: inset 0 1px 0 rgba(255, 255, 255, .07), 0 1px 2px rgba(0, 0, 0, .30); }
body[data-ds-dark-theme] .fa-quick:hover { color: #f1f1f4; border-color: rgba(255, 255, 255, .16); background: linear-gradient(180deg, rgba(255, 255, 255, .09), rgba(255, 255, 255, .03)), #1c1c1f; }
body[data-ds-dark-theme] .fa-quick-aug { color: #d8bd88; }
body[data-ds-dark-theme] .fa-quick-aug:hover { color: #f0d6a2; }
.fa-send { width: 34px; height: 34px; align-self: center; border: 0; border-radius: 50%; background: #0a84ff; color: #fff; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; flex: none; padding: 0; }
.fa-send:disabled { background: var(--dsw-alias-state-idle-primary); color: #7c7c80; cursor: default; opacity: .8; }
.fa-drop { position: absolute; inset: 10px; z-index: 3; pointer-events: none; border: 2px dashed #0a84ff; border-radius: 18px; background: rgba(10,132,255,.08); display: flex; align-items: center; justify-content: center; color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 600; }
.fa-photo { max-width: 200px; max-height: 240px; border-radius: 16px; display: block; object-fit: cover; }
.fa-attach { width: 30px; height: 30px; align-self: center; border: 0; border-radius: 50%; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 20px; line-height: 1; cursor: pointer; flex: none; display: inline-flex; align-items: center; justify-content: center; padding: 0; }
.fa-attach:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.fa-attachments { max-width: 780px; margin: 0 auto 8px; display: flex; gap: 8px; flex-wrap: wrap; }
.fa-attachment { position: relative; width: 64px; height: 64px; border-radius: 12px; overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); }
.fa-attachment img { width: 100%; height: 100%; object-fit: cover; display: block; }
.fa-attachment button { position: absolute; top: 2px; right: 2px; width: 18px; height: 18px; border: 0; border-radius: 50%; background: #000000a6; color: #fff; font: inherit; font-size: 12px; line-height: 1; cursor: pointer; padding: 0; }
.fa-approvals { max-width: 780px; margin: 0 auto 8px; display: flex; flex-direction: column; gap: 6px; }
.fa-approval { border: 1px solid var(--dsw-alias-state-warn-primary); border-radius: 12px; background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-button-elevated-fill)); padding: 10px 12px; font-size: 13px; }
.fa-approval-title { font-weight: 600; }
.fa-approval-reason { margin-top: 4px; color: var(--dsw-alias-label-secondary); font-size: 12px; overflow-wrap: anywhere; }
.fa-approval-actions { display: flex; gap: 8px; margin-top: 8px; }
.fa-approval-actions button { font: inherit; font-size: 12px; padding: 4px 12px; border-radius: 999px; cursor: pointer; border: 1px solid var(--dsw-alias-border-l3); background: transparent; color: inherit; }
.fa-approval-actions .fa-allow { background: var(--dsw-alias-state-warn-primary); border-color: transparent; color: #1a1205; font-weight: 600; }
body[data-ds-dark-theme] .fa-send:disabled { background: #3a3a3c; color: #8e8e93; }
`

		const ICON_SRC = '/fairy-icon.png'
		const STICKER_SRC = '/fairy-sticker.jpg'

		/**
		 * 表情包池：名字 → 图片地址。
		 * 汤圆复用彩蛋里的 SVG，现编成 data URL，不走网络请求。
		 */
		function stickerSrc(name) {
			if (name === 'tangyuan') return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(AUG_SVG)}`
			return STICKER_SRC
		}

		function Avatar(props) {
			const size = props.size ?? 16
			return h('img', {
				className: 'fa-avatar',
				src: ICON_SRC,
				alt: '',
				width: size,
				height: size,
				draggable: false,
				style: { width: size, height: size },
			})
		}

		const sameMessages = (left, right) =>
			left.length === right.length &&
			left.every((message, index) => {
				const other = right[index]
				return (
					(message.id ?? message.seq) === (other.id ?? other.seq) &&
					message.role === other.role &&
					message.text === other.text &&
					(message.image?.id ?? '') === (other.image?.id ?? '')
				)
			})

		const pad = (value) => String(value).padStart(2, '0')
		const clock = (time) => {
			const date = new Date(time)
			return `${pad(date.getHours())}:${pad(date.getMinutes())}`
		}
		const timeAgo = (time) => {
			const minutes = Math.max(0, Math.round((Date.now() - time) / 60_000))
			if (minutes <= 1) return '刚刚'
			if (minutes < 60) return `${minutes} 分钟前`
			const hours = Math.round(minutes / 60)
			if (hours < 24) return `${hours} 小时前`
			return `${Math.round(hours / 24)} 天前`
		}

		const dayLabel = (time, t) => {
			const date = new Date(time)
			const now = new Date()
			const startOf = (value) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
			const days = Math.round((startOf(now) - startOf(date)) / 86_400_000)
			if (days === 0) return `${t('today')} ${clock(time)}`
			if (days === 1) return `${t('yesterday')} ${clock(time)}`
			return `${date.getMonth() + 1}月${date.getDate()}日 ${clock(time)}`
		}

		function createFairyPage(ctx) {
			return function FairyPage() {
				const t = ctx.locale.bind(NS)
				const [messages, setMessages] = useState([])
				const [pending, setPending] = useState([])
				const [running, setRunning] = useState(false)
				const [draft, setDraft] = useState('')
				const [sending, setSending] = useState(false)
				const [error, setError] = useState('')
				const [ready, setReady] = useState(false)
				const listRef = useRef(null)
				const busyRef = useRef(false)
				const aliveRef = useRef(true)
				const stickRef = useRef(true)
				const [atBottom, setAtBottom] = useState(true)
				const [attachments, setAttachments] = useState([])
				const [approvals, setApprovals] = useState([])
				const [dragging, setDragging] = useState(false)
				const fileRef = useRef(null)

				const call = (endpoint, payload) => ctx.connection.rpc.call('/fairy', endpoint, payload ?? {})

				const refresh = useCallback(async () => {
					if (busyRef.current || !aliveRef.current) return
					busyRef.current = true
					try {
						const result = await call('history')
						if (!aliveRef.current) return
						if (result?.ok !== true) throw new Error(result?.error?.message ?? 'history failed')
						const next = result.value.messages
						setMessages((previous) => (sameMessages(previous, next) ? previous : next))
						setPending((previous) =>
							previous.length === 0
								? previous
								: previous.filter(
										(entry) => !next.some((message) => message.clientId === entry.clientId),
									),
						)
						const nextApprovals = Array.isArray(result.value.approvals) ? result.value.approvals : []
						setApprovals((previous) =>
							previous.length === nextApprovals.length &&
							previous.every((entry, index) => entry.key === nextApprovals[index].key)
								? previous
								: nextApprovals,
						)
						setRunning((previous) => (previous === result.value.running ? previous : result.value.running))
						setError('')
						setReady(true)
					} catch (failure) {
						if (aliveRef.current) setError(String(failure.message ?? failure))
					} finally {
						busyRef.current = false
					}
				}, [ctx])

				const open = useCallback(async () => {
					try {
						setError('')
						const result = await call('open')
						if (result?.ok !== true) throw new Error(result?.error?.message ?? 'open failed')
						await refresh()
					} catch (failure) {
						setError(String(failure.message ?? failure))
					}
				}, [ctx, refresh])

				const startNew = useCallback(async () => {
					try {
						setError('')
						const result = await call('reset')
						if (result?.ok !== true) throw new Error(result?.error?.message ?? 'reset failed')
						setMessages([])
						setPending([])
						setDraft('')
						await open()
					} catch (failure) {
						setError(String(failure.message ?? failure))
					}
				}, [ctx, open])

				useEffect(() => {
					aliveRef.current = true
					void open()
					const timer = setInterval(() => void refresh(), 1000)
					return () => {
						aliveRef.current = false
						clearInterval(timer)
					}
				}, [open, refresh])

				const lastKey =
					pending.length > 0
						? pending[pending.length - 1].key
						: messages.length === 0
							? ''
							: `m-${messages[messages.length - 1].seq}`
				useEffect(() => {
					if (!stickRef.current) return
					const node = listRef.current
					if (node !== null) node.scrollTop = node.scrollHeight
				}, [lastKey, running])

				const onScroll = () => {
					const node = listRef.current
					if (node === null) return
					const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 80
					stickRef.current = nearBottom
					setAtBottom(nearBottom)
				}

				const jumpToBottom = () => {
					stickRef.current = true
					setAtBottom(true)
					const node = listRef.current
					if (node !== null) node.scrollTop = node.scrollHeight
				}

				const stop = async () => {
					try {
						await call('cancel')
					} catch {
						/* 忽略：下一次轮询会纠正状态 */
					}
					await refresh()
				}

				const send = async (override) => {
					const text = (typeof override === 'string' ? override : draft).trim()
					const photos = attachments.slice()
					if ((text === '' && photos.length === 0) || sending) return
					const clientId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
					const entry = {
						key: clientId,
						clientId,
						text,
						time: Date.now(),
						images: photos.map((photo) => ({ previewUrl: photo.previewUrl })),
					}
					// 先本地回显（含图片预览），再发 RPC；确认后由 refresh 自动移除临时气泡。
					setPending((previous) => [...previous, entry])
					setDraft('')
					setAttachments([])
					stickRef.current = true
					setAtBottom(true)
					setSending(true)
					setError('')
					try {
						const result = await call('send', {
							text,
							clientId,
							images: photos.map(({ mediaType, data, name }) => ({ mediaType, data, name })),
						})
						if (result?.ok !== true) throw new Error(result?.error?.message ?? 'send failed')
						await refresh()
					} catch (failure) {
						setPending((previous) => previous.filter((item) => item.key !== entry.key))
						setDraft(text)
						setAttachments(photos)
						setError(String(failure.message ?? failure))
					} finally {
						setSending(false)
					}
				}

				const pickImage = () => fileRef.current?.click()

				const addFiles = async (files) => {
					for (const file of files) {
						if (file.type !== '' && !file.type.startsWith('image/')) continue
						if (file.size > 10 * 1024 * 1024) {
							setError('图片太大（单张上限 10MB）')
							continue
						}
						const dataUrl = await new Promise((resolve, reject) => {
							const reader = new FileReader()
							reader.onload = () => resolve(String(reader.result ?? ''))
							reader.onerror = () => reject(reader.error ?? new Error('read failed'))
							reader.readAsDataURL(file)
						})
						const comma = dataUrl.indexOf(',')
						if (comma < 0) continue
						const lower = file.name.toLowerCase()
						const mediaType =
							file.type ||
							(lower.endsWith('.jpg') || lower.endsWith('.jpeg')
								? 'image/jpeg'
								: lower.endsWith('.webp')
									? 'image/webp'
									: lower.endsWith('.gif')
										? 'image/gif'
										: 'image/png')
						setAttachments((previous) =>
							previous.length >= 4
								? previous
								: [
										...previous,
										{
											key: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
											name: file.name,
											mediaType,
											data: dataUrl.slice(comma + 1),
											previewUrl: dataUrl,
										},
									],
						)
					}
				}

				const onPickImage = async (event) => {
					const files = Array.from(event.target.files ?? [])
					event.target.value = ''
					await addFiles(files)
				}

				const imageFilesOf = (transfer) => {
					const direct = Array.from(transfer?.files ?? []).filter(
						(file) => file.type === '' || file.type.startsWith('image/'),
					)
					if (direct.length > 0) return direct
					const items = Array.from(transfer?.items ?? [])
					return items
						.filter((item) => item.kind === 'file')
						.map((item) => item.getAsFile())
						.filter((file) => file !== null && (file.type === '' || file.type.startsWith('image/')))
				}

				const onPaste = async (event) => {
					const files = imageFilesOf(event.clipboardData)
					if (files.length === 0) return
					event.preventDefault()
					await addFiles(files)
				}

				const onDragOver = (event) => {
					if (!event.dataTransfer?.types?.includes('Files')) return
					event.preventDefault()
					setDragging(true)
				}

				const onDragLeave = (event) => {
					if (event.currentTarget.contains(event.relatedTarget)) return
					setDragging(false)
				}

				const onDrop = async (event) => {
					event.preventDefault()
					setDragging(false)
					await addFiles(imageFilesOf(event.dataTransfer))
				}

				const removeAttachment = (key) =>
					setAttachments((previous) => previous.filter((item) => item.key !== key))

				const decide = async (key, allow) => {
					setApprovals((previous) => previous.filter((entry) => entry.key !== key))
					try {
						const result = await call('approve', { key, allow })
						if (result?.ok !== true) throw new Error(result?.error?.message ?? 'approve failed')
						await refresh()
					} catch (failure) {
						setError(String(failure.message ?? failure))
					}
				}

				const onKeyDown = (event) => {
					if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent?.isComposing) {
						event.preventDefault()
						void send()
					}
				}

				const display = [
					...messages.map((message) => ({ ...message, key: message.id ?? `m-${message.seq}`, pending: false })),
					...pending.map((entry) => ({
						seq: entry.key,
						role: 'user',
						text: entry.text,
						time: entry.time,
						key: entry.key,
						pending: true,
						images: entry.images,
					})),
				]
				const rows = []
				let previous
				for (const message of display) {
					const gap = previous === undefined || message.time - previous.time > 5 * 60 * 1000
					if (gap) rows.push(h('div', { className: 'fa-time-sep', key: `t-${message.key}` }, dayLabel(message.time, t)))
					const same = previous !== undefined && previous.role === message.role && !gap
					rows.push(
						h(
							'div',
							{
								key: message.key,
								className: `fa-row ${message.role === 'user' ? 'fa-row-me' : 'fa-row-her'}${same ? '' : ' fa-group-start'}`,
							},
							h(
								'div',
								{ className: 'fa-stack' },
								message.image !== undefined
									? h('img', {
											className: 'fa-photo',
											src: `/fairy-image/${encodeURIComponent(message.image.id)}`,
											alt: '',
											draggable: false,
										})
									: null,
								...(message.images ?? []).map((image, index) =>
									h('img', {
										key: `photo-${index}`,
										className: 'fa-photo',
										src: image.previewUrl,
										alt: '',
										draggable: false,
									}),
								),
								message.text === ''
									? null
									: h(
											'div',
											{
												className:
													`fa-bubble ${message.role === 'user' ? 'fa-bubble-me' : 'fa-bubble-her'}` +
													(same ? (message.role === 'user' ? ' fa-same-me' : ' fa-same-her') : ''),
											},
											message.text,
										),
								message.sticker
									? h('img', {
											className: message.text === '' ? 'fa-sticker fa-sticker-only' : 'fa-sticker',
											src: stickerSrc(message.sticker),
											alt: '',
											draggable: false,
										})
									: null,
							),
						),
					)
					previous = message
				}

				const canSend = (draft.trim() !== '' || attachments.length > 0) && !sending
				return h(
					'div',
					{
						className: 'fa-page',
						onDragOver,
						onDragLeave,
						onDrop,
					},
					h('style', { key: 'style' }, CSS),
					dragging ? h('div', { className: 'fa-drop' }, '松开，把图片放进对话') : null,
					h(
						'header',
						{ className: 'fa-head' },
						h(Avatar, { size: 44 }),
						h('div', { className: 'fa-name' }, t('title')),
						running ? h('div', { className: 'fa-status' }, t('typing')) : h('div', { className: 'fa-status' }, t('subtitle')),
					),
					h(
						'button',
						{ type: 'button', className: 'fa-new', title: t('newChat'), onClick: () => void startNew() },
						t('newChat'),
					),
					running
						? h(
								'button',
								{ type: 'button', className: 'fa-stop-float', onClick: () => void stop() },
								t('stop'),
							)
						: null,
					h(
						'div',
						{
							className: 'fa-body',
							ref: listRef,
							onScroll,
							style: { paddingBottom: attachments.length > 0 || approvals.length > 0 ? 210 : 132 },
						},
						error !== ''
							? h(
									'div',
									{ className: 'fa-error' },
									`${t('error')}：${error}`,
									h('button', { type: 'button', onClick: () => void open() }, t('retry')),
								)
							: null,
						h(
							'div',
							{ className: 'fa-list' },
							...rows,
							running
								? h(
										'div',
										{ className: 'fa-row fa-row-her fa-group-start', key: 'typing' },
										h(
											'div',
											{ className: 'fa-bubble fa-bubble-her fa-typing' },
											h('span', { className: 'fa-dot' }),
											h('span', { className: 'fa-dot' }),
											h('span', { className: 'fa-dot' }),
										),
									)
								: null,
						),
					),
					atBottom
						? null
						: h(
								'button',
								{ type: 'button', className: 'fa-jump', onClick: jumpToBottom, title: t('jump') },
								'↓',
							),
					h(
						'footer',
						{ className: 'fa-composer' },
						approvals.length > 0
							? h(
									'div',
									{ className: 'fa-approvals' },
									approvals.map((entry) =>
										h(
											'div',
											{ className: 'fa-approval', key: entry.key },
											h('div', { className: 'fa-approval-title' }, `${t('approvalAsk')} ${entry.toolName}`),
											entry.reason !== '' ? h('div', { className: 'fa-approval-reason' }, entry.reason) : null,
											h(
												'div',
												{ className: 'fa-approval-actions' },
												h(
													'button',
													{ type: 'button', className: 'fa-allow', onClick: () => void decide(entry.key, true) },
													t('allow'),
												),
												h(
													'button',
													{ type: 'button', onClick: () => void decide(entry.key, false) },
													t('deny'),
												),
											),
										),
									),
								)
							: null,
						attachments.length > 0
							? h(
									'div',
									{ className: 'fa-attachments' },
									attachments.map((attachment) =>
										h(
											'div',
											{ className: 'fa-attachment', key: attachment.key },
											h('img', { src: attachment.previewUrl, alt: '', draggable: false }),
											h(
												'button',
												{ type: 'button', onClick: () => removeAttachment(attachment.key), title: t('deny') },
												'×',
											),
										),
									),
								)
							: null,
						h(
							'div',
							{ className: 'fa-composer-inner' },
							h(
								'button',
								{
									type: 'button',
									className: 'fa-quick',
									title: '放一只蜘蛛侠下来',
									onClick: (event) => {
										event.preventDefault()
										dropSpiders(1)
									},
								},
								'mj',
							),
							h(
								'button',
								{
									type: 'button',
									className: 'fa-quick fa-quick-aug',
									title: '弹一颗汤圆出来',
									onClick: (event) => {
										event.preventDefault()
										playAug()
									},
								},
								'aug',
							),
							h(
								'div',
								{ className: 'fa-field' },
								h(
									'button',
									{ type: 'button', className: 'fa-attach', title: t('attach'), onClick: pickImage },
									'+',
								),
								h('input', {
									type: 'file',
									accept: 'image/*',
									multiple: true,
									style: { display: 'none' },
									ref: fileRef,
									onChange: onPickImage,
								}),
								h('textarea', {
									className: 'fa-input',
									value: draft,
									placeholder: t('placeholder'),
									rows: 1,
									onChange: (event) => setDraft(event.target.value),
									onKeyDown,
									onPaste,
								}),
								h(
									'button',
									{
										type: 'button',
										className: 'fa-send',
										'aria-label': t('send'),
										onClick: () => void send(),
										disabled: !canSend,
									},
									h(
										'svg',
										{ width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
										h('path', {
											d: 'M12 19V5M12 5l-6 6M12 5l6 6',
											stroke: 'currentColor',
											strokeWidth: 2.4,
											strokeLinecap: 'round',
											strokeLinejoin: 'round',
										}),
									),
								),
							),
						),
					),
				)
			}
		}

		function FairyPanelIcon(props) {
			const size = props?.size ?? 18
			return h('img', {
				src: ICON_SRC,
				alt: '',
				width: size,
				height: size,
				draggable: false,
				style: {
					width: size,
					height: size,
					borderRadius: '50%',
					objectFit: 'cover',
					display: 'block',
					background: '#0d1b30',
				},
			})
		}

		// ——— 彩蛋：输入框发「mj」掉一个蜘蛛侠；「mjmj」连发就掉一串，带绳子的摆动物理 ———
		const EGG_CSS = `
.fa-mj-rig { position: fixed; top: 0; width: 0; height: 0; z-index: 2147483000; pointer-events: none; }
.fa-mj-rope { position: absolute; top: 0; left: -1px; width: 2px; height: 0; transform-origin: 50% 0;
  background: linear-gradient(180deg, rgba(226,232,240,.12), rgba(236,236,245,.9));
  box-shadow: 0 0 6px rgba(236,236,245,.18); }
.fa-mj-body { position: absolute; top: 100%; left: 1px; transform: translateX(-50%); transform-origin: 50% 0; }
.fa-mj-body svg { display: block; }
.fa-mj-bubble { position: absolute; left: 112px; top: 96px; padding: 6px 11px; border-radius: 13px;
  background: #111827; color: #f8fafc; font-size: 12px; line-height: 1.4; white-space: nowrap;
  box-shadow: 0 6px 18px rgba(0,0,0,.3); opacity: 0; animation: fa-mj-bubble .26s ease 1s forwards; }
@keyframes fa-mj-bubble { from { opacity: 0; transform: translateY(5px) scale(.94); } to { opacity: 1; transform: none; } }
`
		const SPIDEY_SVG = [
			'<svg width="120" height="200" viewBox="0 0 120 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">',
			// 腿（蓝）+ 靴子（红）：倒挂着，脚在最上
			'<path d="M52 92C46 72 38 46 38 12M68 92C74 72 82 46 82 12" stroke="#1e3a8a" stroke-width="15"',
			' stroke-linecap="round" fill="none"/>',
			'<ellipse cx="38" cy="11" rx="7.5" ry="5.6" fill="#c62828" stroke="#111" stroke-width="2.2"/>',
			'<ellipse cx="82" cy="11" rx="7.5" ry="5.6" fill="#c62828" stroke="#111" stroke-width="2.2"/>',
			'<path d="M38 15v4M82 15v4" stroke="#111" stroke-width="1.6" stroke-linecap="round" opacity=".5"/>',
			// 躯干：上宽下窄，红底 + 暗部
			'<path d="M60 84c13 8 17 26 16 46-1 14-4 22-8 27-3 4-6 6-8 6s-5-2-8-6c-4-5-7-13-8-27-1-20 3-38 16-46z"',
			' fill="#c62828" stroke="#111" stroke-width="2.6" stroke-linejoin="round"/>',
			'<path d="M46 132c-1-18 2-33 8-42-3 16-4 30-3 42z" fill="#8f1d1d" opacity=".55"/>',
			// 手臂：一条贴身下垂，一条微张
			'<path d="M49 126c-5 8-7 15-6 21M71 126c6 8 9 14 8 20" stroke="#1e3a8a" stroke-width="11"',
			' stroke-linecap="round" fill="none"/>',
			'<circle cx="43" cy="149" r="6" fill="#c62828" stroke="#111" stroke-width="2.2"/>',
			'<circle cx="79" cy="148" r="6" fill="#c62828" stroke="#111" stroke-width="2.2"/>',
			// 胸前蜘蛛纹
			'<path d="M60 112c3 2 4 5 4 8s-1 6-4 8c-3-2-4-5-4-8s1-6 4-8z" fill="#111" opacity=".85"/>',
			'<path d="M56 116l-7-4M56 121l-8 1M64 116l7-4M64 121l8 1" stroke="#111" stroke-width="1.5" stroke-linecap="round" opacity=".8"/>',
			// 网纹
			'<path d="M52 96c4 7 6 16 6 26M68 96c-4 7-6 16-6 26M48 118h24M50 130h20M54 142h12"',
			' stroke="#8f1d1d" stroke-width="1.3" stroke-linecap="round" opacity=".75"/>',
			// 头：略侧，白眼罩
			'<g transform="translate(60 170)">',
			'<path d="M0-24c14 0 23 10 23 23S13 24 0 24-23 14-23-1s9-23 23-23z" fill="#c62828" stroke="#111" stroke-width="2.6"/>',
			'<ellipse cx="-9" cy="-4" rx="9.6" ry="6.6" transform="rotate(-22 -9 -4)" fill="#f8fafc" stroke="#111" stroke-width="2.4"/>',
			'<ellipse cx="9.5" cy="-4.5" rx="9.6" ry="6.6" transform="rotate(22 9.5 -4.5)" fill="#f8fafc" stroke="#111" stroke-width="2.4"/>',
			'</g>',
			'</svg>',
		].join('')

		const EGG_GRAVITY = 2600
		const eggInstances = new Set()
		let eggRaf = 0
		let eggLast = 0

		function eggTick(timestamp) {
			const dt = eggLast === 0 ? 1 / 60 : Math.min((timestamp - eggLast) / 1000, 1 / 30)
			eggLast = timestamp
			for (const instance of eggInstances) instance.step(dt)
			eggRaf = eggInstances.size > 0 ? requestAnimationFrame(eggTick) : 0
		}

		function eggStart() {
			if (eggRaf !== 0) return
			eggLast = 0
			eggRaf = requestAnimationFrame(eggTick)
		}

		function createSpidey(anchorX) {
			const rig = document.createElement('div')
			rig.className = 'fa-mj-rig'
			rig.style.left = `${anchorX}px`
			const rope = document.createElement('div')
			rope.className = 'fa-mj-rope'
			const body = document.createElement('div')
			body.className = 'fa-mj-body'
			body.innerHTML = `${SPIDEY_SVG}<div class="fa-mj-bubble">mj</div>`
			rope.appendChild(body)
			rig.appendChild(rope)
			document.body.appendChild(rig)

			const length = 90 + Math.random() * 18
			const state = { time: 0, phase: 'drop', theta: 0, omega: 0, length: 0, target: length }
			const stop = () => {
				eggInstances.delete(instance)
			}
			const release = () => {
				state.phase = 'leave'
				state.time = 0
				const from = state.theta
				rope.style.transition = 'height .2s cubic-bezier(.35,.9,.3,1), transform .42s cubic-bezier(.3,1.6,.5,1)'
				rope.style.height = '0px'
				rope.style.transform = `rotate(${from + Math.sign(from || 1) * 0.16}rad)`
				body.style.transition = 'opacity .24s ease .06s'
				body.style.opacity = '0'
				window.setTimeout(() => {
					rig.remove()
					stop()
				}, 640)
			}
			const instance = {
				step(dt) {
					state.time += dt
					if (state.phase === 'drop') {
						const progress = Math.min(state.time / 0.52, 1)
						const eased = 1 - (1 - progress) ** 3
						state.length = state.target * eased
						rope.style.height = `${state.length}px`
						if (progress >= 1) {
							state.phase = 'swing'
							state.omega = (Math.random() > 0.5 ? 1 : -1) * 0.9
							state.time = 0
						}
						return
					}
					if (state.phase === 'swing') {
						state.omega += (-(EGG_GRAVITY / state.length) * Math.sin(state.theta) - 1.05 * state.omega) * dt
						state.theta += state.omega * dt
						rope.style.transform = `rotate(${state.theta}rad)`
						if (state.time >= 2.1) release()
					}
				},
			}
			eggInstances.add(instance)
			eggStart()
			return instance
		}

		function dropSpiders(count) {
			const total = Math.max(1, Math.min(count, 4))
			const spread = 104
			const center = window.innerWidth / 2
			for (let index = 0; index < total; index += 1) {
				const offset = (index - (total - 1) / 2) * spread
				window.setTimeout(() => createSpidey(center + offset), index * 170)
			}
		}

		// ——— 彩蛋：发「aug」整屏弹出一颗饭团，然后消失 ———
		const AUG_CSS = `
.fa-aug-layer { position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center;
  justify-content: center; pointer-events: none; }
.fa-aug-wrap { position: relative; width: min(78vw, 78vh); height: min(78vw, 78vh); transform-origin: 50% 50%;
  animation: fa-aug-in .8s cubic-bezier(.16,1.42,.4,1) both; }
.fa-aug-wrap img { display: block; width: 100%; height: 100%; object-fit: contain;
  filter: drop-shadow(0 24px 60px rgba(0,0,0,.34)); }
.fa-aug-bubble { position: absolute; left: 68%; top: 4%; padding: 1.2vmin 2vmin; border-radius: 2.4vmin;
  background: #111827; color: #f8fafc; font-size: 3vmin; line-height: 1.35; white-space: nowrap;
  box-shadow: 0 12px 30px rgba(0,0,0,.38); opacity: 0; animation: fa-aug-bubble .32s ease .5s forwards; }
.fa-aug-bubble::after { content: ''; position: absolute; left: 2.1vmin; bottom: -1.1vmin;
  border: 1.2vmin solid transparent; border-top-color: #111827; border-bottom: 0; }
@keyframes fa-aug-bubble { from { opacity: 0; transform: translateY(6px) scale(.96); } to { opacity: 1; transform: none; } }
.fa-aug-leave .fa-aug-wrap { animation: fa-aug-out .6s cubic-bezier(.4,0,.75,.5) both; }
@keyframes fa-aug-in {
  0%   { transform: scale(.06); opacity: 0; }
  40%  { opacity: 1; }
  70%  { transform: scale(1.05); }
  100% { transform: scale(1); opacity: 1; } }
@keyframes fa-aug-out {
  0%   { transform: scale(1); opacity: 1; }
  100% { transform: scale(.12); opacity: 0; } }
`
		const AUG_SVG = [
			'<svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" aria-hidden="true">',
			'<g stroke="#403a33" stroke-linejoin="round" stroke-linecap="round">',
			'<ellipse cx="64" cy="57" rx="56" ry="13" fill="#f8f4e8" stroke-width="3"/>',
			'<circle cx="64" cy="59" r="34" fill="#ffffff" stroke-width="3.2"/>',
			'<path d="M8 57C8 64 33 70 64 70s56-6 56-13c-2 33-26 45-56 45S10 90 8 57z" fill="#f8c93f" stroke-width="3.2"/>',
			'<path d="M52 101h24v3a3.6 3.6 0 0 1-3.6 3.6H55.6A3.6 3.6 0 0 1 52 104z" fill="#f8c93f" stroke-width="2.8"/>',
			'<path d="M20 76c9 7 26 11 44 11s35-4 44-11" fill="none" stroke="#ffda6b" stroke-width="3.6" opacity=".85"/>',
			'<path d="M56 42.5 44 48" fill="none" stroke-width="4"/>',
			'<path d="M72 42.5 84 48" fill="none" stroke-width="4"/>',
			'<path d="M55 54.2q4.5 5.2 9 0q4.5 5.2 9 0" fill="none" stroke-width="2.7"/>',
			'<ellipse cx="40.5" cy="56" rx="8.4" ry="4.6" fill="#f9a9b7" stroke="none" opacity=".9"/>',
			'<ellipse cx="87.5" cy="56" rx="8.4" ry="4.6" fill="#f9a9b7" stroke="none" opacity=".9"/>',
			'</g>',
			'</svg>',
		].join('')
		const AUG_LINES = ['aug', '你龙哥就是龙', '我砍 我再砍', '不赖', '[汤圆]']

		function playAug() {
			const layer = document.createElement('div')
			layer.className = 'fa-aug-layer'
			const img = document.createElement('img')
			img.alt = ''
			img.draggable = false
			img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(AUG_SVG)}`
			const wrap = document.createElement('div')
			wrap.className = 'fa-aug-wrap'
			wrap.appendChild(img)
			const line = AUG_LINES[Math.floor(Math.random() * AUG_LINES.length)]
			if (line !== '[汤圆]') {
				const bubble = document.createElement('div')
				bubble.className = 'fa-aug-bubble'
				bubble.textContent = line
				wrap.appendChild(bubble)
			}
			layer.appendChild(wrap)
			document.body.appendChild(layer)
			window.setTimeout(() => layer.classList.add('fa-aug-leave'), 2150)
			window.setTimeout(() => layer.remove(), 2820)
		}

		function composerText(element) {
			if (!element) return ''
			if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') return String(element.value ?? '')
			if (element.isContentEditable) return String(element.innerText ?? '')
			return ''
		}

		function installEasterEggs() {
			if (typeof document === 'undefined' || window.__fairyEasterEggs === true) return
			window.__fairyEasterEggs = true

			const style = document.createElement('style')
			style.dataset.fairyEasterEggs = 'true'
			style.textContent = `${EGG_CSS}\n${AUG_CSS}`
			document.head.appendChild(style)

			let lastSpider = 0
			let lastAug = 0
			document.addEventListener(
				'keydown',
				(event) => {
					if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
					let text = composerText(document.activeElement).trim()
					if (text === '') {
						for (const node of document.querySelectorAll('textarea')) {
							if (node.offsetParent !== null && composerText(node).trim() !== '') {
								text = composerText(node).trim()
								break
							}
						}
					}
					const now = Date.now()
					if (/^aug$/i.test(text)) {
						if (now - lastAug < 1200) return
						lastAug = now
						playAug()
						return
					}
					const match = /^(?:m\s*j)+$/i.exec(text)
					if (match === null) return
					if (now - lastSpider < 900) return
					lastSpider = now
					const pairs = (match[0].match(/m\s*j/gi) ?? []).length
					dropSpiders(pairs)
				},
				true,
			)
		}

		const inject = ['slots', 'locale', 'connection']

		function apply(ctx) {
			try {
				installEasterEggs()
			} catch (error) {
				console.warn('[fairy] easter eggs failed', error)
			}
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'fairy: dictionaries')
			const t = ctx.locale.bind(NS)
			const FairyPage = createFairyPage(ctx)
			ctx.slots.inject('main', () =>
				ctx.slots.register({ name: 'main', key: 'fairy', order: 20, locale: NS }, FairyPage),
			)
			ctx.slots.inject('sidebar.panellist', () =>
				ctx.slots.register(
					{ name: 'sidebar.panellist', id: 'fairy', order: 5, locale: NS, label: () => t('entry') },
					FairyPanelIcon,
				),
			)
		}

		return { inject, apply }
	},
})
