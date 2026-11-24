/**
 * 面板连接状态（本地文件）。
 *
 * 客户端模块在浏览器里成功注册侧边栏/主面板后，会通过本机 RPC 上报一次心跳。
 * 这既是「界面确实加载了」的证据，也让面板可以显示「界面已连接」。
 * 只记录时间与布尔值，不含任何用户内容。
 */

import fs from 'node:fs'
import path from 'node:path'
import { formatLocalIso } from './store.js'

const UI_STATE_FILE = 'ui-state.json'

export function readUiState(directory) {
	try {
		const parsed = JSON.parse(fs.readFileSync(path.join(directory, UI_STATE_FILE), 'utf8'))
		if (parsed === null || typeof parsed !== 'object') return undefined
		return {
			last_ready_at: typeof parsed.last_ready_at === 'string' ? parsed.last_ready_at : '',
			sidebar: parsed.sidebar === true,
			main: parsed.main === true,
			sidebar_rendered: parsed.sidebar_rendered === true,
			locale: typeof parsed.locale === 'string' ? parsed.locale : '',
		}
	} catch {
		return undefined
	}
}

export function writeUiState(directory, value) {
	const file = path.join(directory, UI_STATE_FILE)
	const previous = readUiState(directory) ?? {}
	// 合并上报：注册与侧栏渲染相互独立，后到的只更新自己那一项。
	const payload = {
		last_ready_at: formatLocalIso(),
		sidebar: value?.sidebar === true || previous.sidebar === true,
		main: value?.main === true || previous.main === true,
		sidebar_rendered: value?.sidebar_rendered === true || previous.sidebar_rendered === true,
		locale: typeof value?.locale === 'string' && value.locale !== '' ? value.locale : previous.locale ?? '',
	}
	const temporary = `${file}.${process.pid}.tmp`
	fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
	fs.renameSync(temporary, file)
	return payload
}
