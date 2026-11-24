/**
 * 「本地记忆」的 Web 客户端：侧边栏入口 + 主面板。
 *
 * 数据只通过本机 RPC 通道 `/local-memory` 读取（浏览器 Cookie 认证），
 * 不直接访问文件系统，不发起任何外部网络请求。
 */

window.__ModuleLoader__.load({
	id: 'dsh-memory',
	factory(require) {
		const React = require('react')
		const h = React.createElement
		const { useCallback, useEffect, useMemo, useState } = React

		const NS = 'local-memory'

		const zh = {
			panel: '本地记忆',
			title: '本地记忆',
			subtitle: '保存在本机的纯文本记忆库，可随时手工编辑 memory.md',
			refresh: '刷新',
			searchPlaceholder: '搜索关键词，例如：偏好、论文、mac',
			search: '搜索',
			reset: '重置',
			addTitle: '新增一条记忆',
			contentPlaceholder: '一条自包含的记忆，最多 500 字',
			kind: '类型',
			kindFact: '事实',
			kindPreference: '偏好',
			kindEvent: '事件',
			kindNote: '笔记',
			tags: '标签',
			tagsPlaceholder: '用空格分隔，例如：偏好 工作',
			save: '保存',
			saving: '保存中…',
			empty: '还没有记忆。让助手记住点什么，或在上方手工添加。',
			noMatch: '没有找到匹配的记忆。',
			pinned: '已固定',
			pin: '固定',
			unpin: '取消固定',
			remove: '删除',
			confirmRemove: '确定删除这条记忆吗？此操作会直接改写 memory.md。',
			total: '共 {n} 条',
			loading: '加载中…',
			error: '操作失败',
			summaries: '长对话摘要',
			summariesHint: '超过 {turns} 轮或约 {tokens} tokens 时自动生成，原文另存为 JSONL',
			noSummaries: '暂时没有自动摘要。',
			archives: '原文归档',
			noArchives: '暂时没有归档文件。',
			turns: '轮',
			tokens: 'tokens',
			roll: '第 {from}–{to} 轮',
			session: '会话',
			entries: '记忆条目',
			uiConnected: '面板已连接',
			uiPending: '面板尚未从页面收到心跳',
			saved: '已保存',
			removed: '已删除',
		}

		const en = {
			panel: 'Memory',
			title: 'Local memory',
			subtitle: 'Plain-text memories stored on this machine; edit memory.md whenever you like.',
			refresh: 'Refresh',
			searchPlaceholder: 'Search keywords, e.g. preference, thesis, mac',
			search: 'Search',
			reset: 'Reset',
			addTitle: 'Add a memory',
			contentPlaceholder: 'One self-contained memory, up to 500 characters',
			kind: 'Kind',
			kindFact: 'Fact',
			kindPreference: 'Preference',
			kindEvent: 'Event',
			kindNote: 'Note',
			tags: 'Tags',
			tagsPlaceholder: 'Space separated, e.g. preference work',
			save: 'Save',
			saving: 'Saving…',
			empty: 'No memories yet. Ask the assistant to remember something, or add one above.',
			noMatch: 'No matching memories.',
			pinned: 'Pinned',
			pin: 'Pin',
			unpin: 'Unpin',
			remove: 'Delete',
			confirmRemove: 'Delete this memory? This rewrites memory.md immediately.',
			total: '{n} entries',
			loading: 'Loading…',
			error: 'Request failed',
			summaries: 'Rolling summaries',
			summariesHint: 'Generated automatically past {turns} turns or about {tokens} tokens; originals are archived as JSONL',
			noSummaries: 'No automatic summary yet.',
			archives: 'Archived transcripts',
			noArchives: 'No archive file yet.',
			turns: 'turns',
			tokens: 'tokens',
			roll: 'Turns {from}–{to}',
			session: 'Session',
			entries: 'Entries',
			uiConnected: 'Panel connected',
			uiPending: 'No heartbeat from the page yet',
			saved: 'Saved',
			removed: 'Deleted',
		}

		const KIND_COLORS = {
			fact: '#3b82f6',
			preference: '#a855f7',
			event: '#f59e0b',
			note: '#10b981',
		}

		const CSS = `
.lm-page { height: 100%; overflow: auto; padding: 28px 32px 64px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); }
.lm-inner { max-width: 880px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }
.lm-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.lm-title { font-size: 22px; font-weight: 650; margin: 0; }
.lm-sub { margin: 6px 0 0; font-size: 13px; color: var(--dsw-alias-label-secondary); line-height: 1.5; }
.lm-muted { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.lm-card { border: 1px solid var(--dsw-alias-border-l3); border-radius: 12px; padding: 16px; background: var(--dsw-alias-button-elevated-fill); }
.lm-row { display: flex; gap: 8px; align-items: center; }
.lm-input, .lm-textarea, .lm-select { width: 100%; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l3); border-radius: 8px; background: transparent; color: inherit; font: inherit; font-size: 13px; padding: 8px 10px; outline: none; }
.lm-input:focus, .lm-textarea:focus, .lm-select:focus { border-color: var(--dsw-alias-state-business-primary); }
.lm-textarea { min-height: 64px; resize: vertical; line-height: 1.5; }
.lm-btn { border: 1px solid var(--dsw-alias-border-l3); border-radius: 8px; background: transparent; color: inherit; font: inherit; font-size: 13px; padding: 7px 12px; cursor: pointer; white-space: nowrap; }
.lm-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.lm-btn:disabled { opacity: .45; cursor: default; }
.lm-btn-primary { background: var(--dsw-alias-state-business-primary); border-color: transparent; color: var(--dsw-alias-label-primary-inverted); }
.lm-btn-danger { color: #ef4444; border-color: rgba(239,68,68,.35); }
.lm-error { color: #ef4444; font-size: 12px; }
.lm-list { display: flex; flex-direction: column; gap: 10px; }
.lm-entry { display: flex; gap: 12px; align-items: flex-start; border: 1px solid var(--dsw-alias-border-l3); border-radius: 10px; padding: 12px; }
.lm-entry-main { flex: 1; min-width: 0; }
.lm-entry-text { font-size: 13px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.lm-entry-meta { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 6px; }
.lm-badge { font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid currentColor; }
.lm-tag { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.lm-entry-actions { display: flex; flex-direction: column; gap: 6px; }
.lm-section-title { font-size: 15px; font-weight: 600; margin: 0 0 4px; }
.lm-summary { border-top: 1px solid var(--dsw-alias-border-l3); padding-top: 10px; margin-top: 10px; font-size: 12px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.lm-summary:first-child { border-top: 0; padding-top: 0; margin-top: 0; }
.lm-pinned { color: var(--dsw-alias-state-business-primary); }
`

		function createApi(ctx) {
			return async function call(endpoint, payload) {
				const result = await ctx.connection.rpc.call('/local-memory', endpoint, payload ?? {})
				if (result === undefined || result === null || result.ok !== true) {
					const message = result?.error?.message ?? 'unknown error'
					throw new Error(message)
				}
				return result.value
			}
		}

		function formatTime(iso) {
			if (typeof iso !== 'string' || iso.length < 16) return iso ?? ''
			return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`
		}

		function shortId(id) {
			return typeof id === 'string' ? id.slice(-8) : ''
		}

		function formatBytes(bytes) {
			if (!Number.isFinite(bytes)) return ''
			if (bytes < 1024) return `${bytes} B`
			if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
			return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
		}

		function useLocale(ctx) {
			const [version, setVersion] = useState(0)
			useEffect(() => ctx.locale.subscribe(() => setVersion((value) => value + 1)), [ctx])
			void version
			return ctx.locale.bind(NS)
		}

		function MemoryIcon(props) {
			const size = props.size ?? 18
			return h(
				'svg',
				{
					width: size,
					height: size,
					viewBox: '0 0 24 24',
					fill: 'none',
					'aria-hidden': true,
					style: { display: 'block', color: 'currentColor' },
				},
				h('path', {
					d: 'M12 3.4 20.6 7.7 12 12 3.4 7.7z',
					stroke: 'currentColor',
					strokeWidth: 1.6,
					strokeLinejoin: 'round',
				}),
				h('path', {
					d: 'M3.4 12 12 16.3 20.6 12',
					stroke: 'currentColor',
					strokeWidth: 1.6,
					strokeLinecap: 'round',
					strokeLinejoin: 'round',
				}),
				h('path', {
					d: 'M3.4 16.3 12 20.6 20.6 16.3',
					stroke: 'currentColor',
					strokeWidth: 1.6,
					strokeLinecap: 'round',
					strokeLinejoin: 'round',
					opacity: 0.55,
				}),
			)
		}

		function createSidebarIcon(ctx) {
			return function SidebarIcon(props) {
				useEffect(() => {
					try {
						ctx.connection.rpc
							.call('/local-memory', 'ui-ready', { sidebar_rendered: true })
							.catch(() => {})
					} catch (error) {
						void error
					}
				}, [])
				return h(
					'span',
					{ style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center' } },
					h(MemoryIcon, { size: props.size }),
				)
			}
		}

		function Badge(props) {
			const color = KIND_COLORS[props.kind] ?? KIND_COLORS.note
			return h('span', { className: 'lm-badge', style: { color } }, props.label)
		}

		function createMemoryPage(ctx) {
			return function MemoryPage() {
				const t = useLocale(ctx)
				const api = useMemo(() => createApi(ctx), [ctx])
				const [loading, setLoading] = useState(true)
				const [busy, setBusy] = useState(false)
				const [error, setError] = useState('')
				const [notice, setNotice] = useState('')
				const [state, setState] = useState(null)
				const [view, setView] = useState(null)
				const [query, setQuery] = useState('')
				const [form, setForm] = useState({ content: '', kind: 'note', tags: '' })

				const load = useCallback(async () => {
					setError('')
					try {
						const next = await api('state')
						setState(next)
						setView(next.entries)
					} catch (failure) {
						setError(String(failure.message ?? failure))
					} finally {
						setLoading(false)
					}
				}, [api])

				useEffect(() => {
					void load()
				}, [load])

				const run = useCallback(
					async (task) => {
						if (busy) return
						setBusy(true)
						setError('')
						setNotice('')
						try {
							await task()
						} catch (failure) {
							setError(String(failure.message ?? failure))
						} finally {
							setBusy(false)
						}
					},
					[busy],
				)

				const search = () => run(async () => {
					const result = await api('search', { query })
					setView(result.entries)
				})

				const resetSearch = () => run(async () => {
					setQuery('')
					await load()
				})

				const save = () => run(async () => {
					const content = form.content.trim()
					if (content === '') return
					await api('add', {
						content,
						kind: form.kind,
						tags: form.tags.split(/[\s,，]+/u).filter(Boolean),
					})
					setForm({ content: '', kind: form.kind, tags: '' })
					await load()
					setNotice(t('saved'))
				})

				const togglePin = (entry) => run(async () => {
					await api('pin', { id: entry.id, pinned: !entry.pinned })
					await load()
				})

				const remove = (entry) => {
					if (!window.confirm(t('confirmRemove'))) return
					void run(async () => {
						await api('remove', { id: entry.id })
						await load()
						setNotice(t('removed'))
					})
				}

				const kindLabel = (kind) => t(`kind${kind.slice(0, 1).toUpperCase()}${kind.slice(1)}`)
				const entries = view ?? []
				const total = state?.total ?? entries.length

				return h(
					'div',
					{ className: 'lm-page' },
					h('style', null, CSS),
					h(
						'div',
						{ className: 'lm-inner' },
						h(
							'header',
							{ className: 'lm-header' },
							h(
								'div',
								null,
								h('h1', { className: 'lm-title' }, t('title')),
								h('p', { className: 'lm-sub' }, t('subtitle')),
								h(
									'p',
									{ className: 'lm-muted', style: { marginTop: 8 } },
									`${t('total', { n: total })}${state?.directory ? ` · ${state.directory}` : ''}`,
								),
							),
							h(
								'button',
								{ type: 'button', className: 'lm-btn', onClick: () => void load(), disabled: busy || loading },
								t('refresh'),
							),
						),
						error !== '' ? h('div', { className: 'lm-error' }, `${t('error')}：${error}`) : null,
						notice !== '' ? h('div', { className: 'lm-muted' }, notice) : null,
						loading
							? h('div', { className: 'lm-muted' }, t('loading'))
							: h(
									'section',
									{ className: 'lm-card' },
									h(
										'div',
										{ className: 'lm-row' },
										h('input', {
											className: 'lm-input',
											value: query,
											placeholder: t('searchPlaceholder'),
											onChange: (event) => setQuery(event.target.value),
											onKeyDown: (event) => {
												if (event.key === 'Enter') search()
											},
										}),
										h('button', { type: 'button', className: 'lm-btn lm-btn-primary', onClick: search, disabled: busy }, t('search')),
										h('button', { type: 'button', className: 'lm-btn', onClick: resetSearch, disabled: busy }, t('reset')),
									),
								),
						h(
							'section',
							{ className: 'lm-card' },
							h('h2', { className: 'lm-section-title' }, t('addTitle')),
							h('textarea', {
								className: 'lm-textarea',
								value: form.content,
								placeholder: t('contentPlaceholder'),
								maxLength: 500,
								onChange: (event) => setForm({ ...form, content: event.target.value }),
							}),
							h(
								'div',
								{ className: 'lm-row', style: { marginTop: 10 } },
								h(
									'select',
									{
										className: 'lm-select',
										value: form.kind,
										onChange: (event) => setForm({ ...form, kind: event.target.value }),
										style: { width: 120 },
									},
									['fact', 'preference', 'event', 'note'].map((kind) => h('option', { key: kind, value: kind }, kindLabel(kind))),
								),
								h('input', {
									className: 'lm-input',
									value: form.tags,
									placeholder: t('tagsPlaceholder'),
									onChange: (event) => setForm({ ...form, tags: event.target.value }),
								}),
								h(
									'button',
									{
										type: 'button',
										className: 'lm-btn lm-btn-primary',
										onClick: save,
										disabled: busy || form.content.trim() === '',
									},
									busy ? t('saving') : t('save'),
								),
							),
						),
						h(
							'section',
							null,
							h('h2', { className: 'lm-section-title', style: { marginBottom: 10 } }, t('entries')),
							entries.length === 0
								? h('div', { className: 'lm-muted' }, query.trim() === '' ? t('empty') : t('noMatch'))
								: h(
										'div',
										{ className: 'lm-list' },
										entries.map((entry) =>
											h(
												'div',
												{ className: 'lm-entry', key: entry.id },
												h(
													'div',
													{ className: 'lm-entry-main' },
													h('div', { className: 'lm-entry-text' }, entry.content),
													h(
														'div',
														{ className: 'lm-entry-meta' },
														h(Badge, { kind: entry.kind, label: kindLabel(entry.kind) }),
														h('span', { className: 'lm-muted' }, formatTime(entry.created_at)),
														entry.pinned ? h('span', { className: 'lm-pinned' }, `★ ${t('pinned')}`) : null,
														entry.tags.map((tag) => h('span', { className: 'lm-tag', key: tag }, `#${tag}`)),
														h('span', { className: 'lm-tag' }, entry.id),
													),
												),
												h(
													'div',
													{ className: 'lm-entry-actions' },
													h(
														'button',
														{ type: 'button', className: 'lm-btn', onClick: () => void togglePin(entry), disabled: busy },
														entry.pinned ? t('unpin') : t('pin'),
													),
													h(
														'button',
														{ type: 'button', className: 'lm-btn lm-btn-danger', onClick: () => remove(entry), disabled: busy },
														t('remove'),
													),
												),
											),
										),
									),
						),
						h(
							'section',
							{ className: 'lm-card' },
							h('h2', { className: 'lm-section-title' }, t('summaries')),
							h(
								'div',
								{ className: 'lm-muted', style: { marginBottom: 10 } },
								t('summariesHint', { turns: state?.thresholds?.turns ?? 60, tokens: state?.thresholds?.tokens ?? 8000 }),
							),
							(state?.summaries ?? []).length === 0
								? h('div', { className: 'lm-muted' }, t('noSummaries'))
								: (state?.summaries ?? []).map((summary) =>
										h(
											'div',
											{ className: 'lm-summary', key: summary.session_id },
											h(
												'div',
												{ className: 'lm-row', style: { justifyContent: 'space-between' } },
												h('span', null, `${t('session')} ${shortId(summary.session_id)} · ${t('roll', { from: summary.rolls?.[summary.rolls.length - 1]?.from_turn ?? 0, to: summary.rolls?.[summary.rolls.length - 1]?.to_turn ?? summary.covered_turn })}`),
												h('span', { className: 'lm-muted' }, formatTime(summary.updated_at)),
											),
											h(
												'div',
												{ className: 'lm-muted', style: { marginTop: 4 } },
												(summary.rolls ?? [])
													.map((roll) => `${roll.from_turn}–${roll.to_turn} ${t('turns')} / ${roll.tokens} ${t('tokens')}`)
													.join(' · '),
											),
										),
									),
							h('h2', { className: 'lm-section-title', style: { marginTop: 18 } }, t('archives')),
							(state?.archives ?? []).length === 0
								? h('div', { className: 'lm-muted' }, t('noArchives'))
								: (state?.archives ?? []).map((archive) =>
										h(
											'div',
											{ className: 'lm-summary', key: archive.session_id },
											h('span', null, `${t('session')} ${shortId(archive.session_id)} · archives/${archive.session_id}.jsonl · ${formatBytes(archive.bytes)}`),
										),
									),
						),
					),
				)
			}

		}


		const inject = ['slots', 'locale', 'connection']

		function apply(ctx) {
			// 心跳：页面加载本模块后向 Host 上报注册状态；多次采样，避免槽位声明恰好在注册前。
			const timers = []
			let attempts = 0
			const beat = () => {
				attempts += 1
				const payload = { sidebar: false, main: false, locale: '' }
				try {
					const sidebar = ctx.slots.entries('sidebar.panellist')
					payload.sidebar = Array.isArray(sidebar) && sidebar.some((entry) => entry?.options?.id === 'local-memory')
				} catch (error) {
					void error
				}
				try {
					const main = ctx.slots.entries('main')
					payload.main = Array.isArray(main) && main.some((entry) => entry?.options?.key === 'local-memory')
				} catch (error) {
					void error
				}
				const retry = () => {
					if (attempts < 12) timers.push(setTimeout(beat, 5000))
				}
				try {
					ctx.connection.rpc.call('/local-memory', 'ui-ready', payload).catch(retry)
				} catch (error) {
					void error
					retry()
				}
			}
			for (const delay of [0, 1200, 4000]) timers.push(setTimeout(beat, delay))
			ctx.effect(() => () => {
				for (const timer of timers) clearTimeout(timer)
			}, 'local-memory: ui heartbeat')

			try {
				ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'local-memory: dictionaries')
			} catch (error) {
				console.warn('[local-memory] locale registration failed', error)
			}
			const t = ctx.locale.bind(NS)
			const MemoryPage = createMemoryPage(ctx)
			try {
				ctx.slots.inject('main', () =>
					ctx.slots.register(
						{ name: 'main', key: 'local-memory', order: 20, locale: NS },
						MemoryPage,
					),
				)
				ctx.slots.inject('sidebar.panellist', () =>
					ctx.slots.register(
						{ name: 'sidebar.panellist', id: 'local-memory', order: 20, locale: NS, label: () => t('panel') },
						createSidebarIcon(ctx),
					),
				)
			} catch (error) {
				console.warn('[local-memory] slot registration failed', error)
			}
		}

		return { inject, apply }
	},
})
