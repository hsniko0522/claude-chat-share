import { atom, read, update } from 'claude-code'
import type { Register, EngineInterface, RenderChildren } from 'claude-code'

import type { Status, InboxItem, LastShare } from '../types'
import {
  buildBundle, composeLinks, findGmail, sendViaGmail, openUrl, revealFile,
  scanInbox, importBundle, currentTitle, trashExport, env, findSharePaths, historyForChat,
  binScriptPath, openWithExplorer, type BinScript,
} from './core'
import { t, isLang, type Lang } from './i18n'

const PANE = 'chat-share'

// 这个会话里已经载入过的 .claudeshare：之后的消息里再出现同一路径不重复导入
const loadedFiles = new Set<string>()

const lang = atom({ plugin: 'chat-share', key: 'lang' } as const, 'zh' as Lang)
const title = atom({ plugin: 'chat-share', key: 'title' } as const, '')
const emails = atom({ plugin: 'chat-share', key: 'emails' } as const, [] as string[])
const draft = atom({ plugin: 'chat-share', key: 'draft' } as const, '')
const lastShare = atom({ plugin: 'chat-share', key: 'lastShare' } as const, null as LastShare | null)
const sentDir = atom({ plugin: 'chat-share', key: 'sentDir' } as const, null as string | null)
const isConfirmingDelete = atom({ plugin: 'chat-share', key: 'isConfirmingDelete' } as const, false)
const status = atom({ plugin: 'chat-share', key: 'status' } as const, { kind: 'idle', text: '' } as Status)
const inbox = atom({ plugin: 'chat-share', key: 'inbox' } as const, [] as InboxItem[])
const importPath = atom({ plugin: 'chat-share', key: 'importPath' } as const, '')
const targetDir = atom({ plugin: 'chat-share', key: 'targetDir' } as const, '')
const recent = atom({ plugin: 'chat-share', key: 'recent' } as const, [] as string[])
const doubleClick = atom({ plugin: 'chat-share', key: 'doubleClick' } as const, 'na' as 'win' | 'na')
const newShares = atom({ plugin: 'chat-share', key: 'newShares' } as const, [] as InboxItem[])

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/
const RECENT_KEY = 'recentEmails' // $.store：跨会话保存，重启、换会话都还在
const LANG_KEY = 'lang'
const RECENT_MAX = 12

type $ = EngineInterface

// ---------------------------------------------------------------- 状态小工具
async function setStatus($: $, kind: Status['kind'], text: string) {
  await update($, status, () => ({ kind, text }))
}

async function strings($: $) {
  return t(await read($, lang))
}

async function loadLang($: $): Promise<Lang> {
  const v = await $.store.get(LANG_KEY).catch(() => undefined)
  return isLang(v) ? v : 'zh'
}

async function registerCommand($: $, l: Lang) {
  await $.command.register({ name: 'share-chat', description: t(l).commandDesc })
}

async function switchLang($: $, l: Lang) {
  await $.store.set(LANG_KEY, l)
  await update($, lang, () => l)
  await setStatus($, 'idle', '') // 旧提示是另一种语言写的，切换时清掉
  await update($, isConfirmingDelete, () => false)
  await registerCommand($, l)
}

/** 读出记住的邮箱（存的不是邮箱列表就当没有） */
async function loadRecent($: $): Promise<string[]> {
  const v = await $.store.get(RECENT_KEY).catch(() => undefined)
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && EMAIL.test(x)) : []
}

/** 记住这次的收件人：最近用的排前面，最多记 RECENT_MAX 个 */
async function rememberEmails($: $, to: string[]) {
  const merged = [...new Set([...to, ...(await loadRecent($))])].slice(0, RECENT_MAX)
  await $.store.set(RECENT_KEY, merged)
  await update($, recent, () => merged)
}

async function forgetEmail($: $, mail: string) {
  const left = (await loadRecent($)).filter(x => x !== mail)
  await $.store.set(RECENT_KEY, left)
  await update($, recent, () => left)
}

// ---------------------------------------------------------------- 动作
async function openPane($: $) {
  const l = await loadLang($)
  await update($, lang, () => l)
  await $.ui.open({ id: PANE, title: t(l).paneTitle, focus: true })
  // 默认放到用户目录；会话自己的临时文件夹会随会话删除，不适合放导入的对话
  const cur = await read($, targetDir)
  if (!cur || /[\\/]scratch-workspaces[\\/]/.test(cur)) {
    const { home } = await env($)
    await update($, targetDir, () => home)
  }
  const list = await scanInbox($)
  await update($, inbox, () => list)
  const remembered = await loadRecent($)
  await update($, recent, () => remembered)
  const tt = await currentTitle($).catch(() => '')
  await update($, title, () => tt)
  const sp = await binScriptPath($, 'setup-double-click.cmd').catch(() => undefined)
  await update($, doubleClick, () => (sp ? 'win' : 'na'))
  // 打开过面板，就算看过了下载文件夹里的这些对话
  await markInboxSeen($, list)
}

/**
 * 双击打开要改 Windows 的文件关联，而 app 里运行的命令改不到真正的设置（会被关在 app 自己的一份里）。
 * 所以人点按钮时，交给资源管理器打开 mod 自带的 .cmd，和亲手双击它一样：弹出窗口，按提示完成。
 */
async function runBinScript($: $, name: BinScript) {
  const L = await strings($)
  const ok = await openWithExplorer($, name).catch(() => false)
  if (ok) await setStatus($, 'ok', name === 'setup-double-click.cmd' ? L.dblLaunched : L.dblUndoLaunched)
  else await setStatus($, 'error', L.dblNotFound)
}

async function openSetupFolder($: $) {
  const sp = await binScriptPath($, 'setup-double-click.cmd').catch(() => undefined)
  if (sp) await revealFile($, sp)
}

// ---------------------------------------------------------------- 收到新对话的提醒
const SEEN_KEY = 'seenShares' // $.store：看过的 .claudeshare（文件名 + 修改时间）
const shareKey = (f: InboxItem) => `${f.name}|${Math.round(f.mtimeMs)}`

async function loadSeen($: $): Promise<string[]> {
  const v = await $.store.get(SEEN_KEY).catch(() => undefined)
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

async function markInboxSeen($: $, list: InboxItem[]) {
  const seen = new Set(await loadSeen($))
  for (const f of list) seen.add(shareKey(f))
  await $.store.set(SEEN_KEY, [...seen].slice(-200))
  await update($, newShares, () => [])
}

/** 看下载文件夹里有没有没看过的 .claudeshare；有新的就更新提醒，toast 只在出现新文件时弹 */
async function checkNewShares($: $, toast: boolean) {
  const list = await scanInbox($)
  const seen = new Set(await loadSeen($))
  const fresh = list.filter(f => !seen.has(shareKey(f)))
  const before = new Set((await read($, newShares)).map(shareKey))
  await update($, newShares, () => fresh)
  const added = fresh.filter(f => !before.has(shareKey(f)))
  if (toast && added.length) $.ui.toast((await strings($)).newShareToast(fresh.length, added[0]!.name))
}

async function addDraft($: $, raw?: string) {
  const L = await strings($)
  const text = (raw ?? (await read($, draft))).trim()
  if (!text) return
  const list = text.split(/[\s,;，；]+/).filter(Boolean)
  const bad = list.filter(m => !EMAIL.test(m))
  if (bad.length) return setStatus($, 'error', L.badEmail(bad.join(', ')))
  await update($, emails, cur => [...new Set([...cur, ...list])])
  await update($, draft, () => '')
  await setStatus($, 'idle', '')
}

async function isBusy($: $): Promise<boolean> {
  return (await read($, status)).kind === 'busy'
}

// 发送：有已连接的 Gmail 就直接发（附件自动附上）；
// 没有就打开写好收件人/标题/正文的写信页 + 选中文件的文件夹，附件由人拖进邮件
async function doSend($: $) {
  if (await isBusy($)) return
  const l = await read($, lang)
  const L = t(l)
  await addDraft($)
  const to = await read($, emails)
  if (to.length === 0) return setStatus($, 'error', L.needRecipient)
  const list = to.join(l === 'zh' ? '、' : ', ')
  await update($, isConfirmingDelete, () => false)
  try {
    await setStatus($, 'busy', L.packing)
    const b = await buildBundle($, l)
    const pkg = b.files[0]!.path
    const links = composeLinks(b, to)
    await rememberEmails($, to)
    await update($, sentDir, () => b.dir)

    const gmail = await findGmail($)
    if (gmail) {
      await setStatus($, 'busy', L.sending(list))
      const skipped = await sendViaGmail($, gmail, b, to)
      await update($, lastShare, () => null)
      await setStatus($, 'ok',
        L.sent(list, b.files.length - skipped.length) +
        (skipped.length ? ' ' + L.sentSkipped(skipped.join(', ')) : '') + '\n' + L.copyAt(b.dir))
      $.ui.toast(L.toastSent)
      return
    }

    await update($, lastShare, () => ({ pkg, ...links }))
    await revealFile($, pkg)
    await openUrl($, links.gmail)
    await setStatus($, 'warn', L.manualNeeded(b.files.length))
    $.ui.toast(L.toastManual)
  } catch (err) {
    await setStatus($, 'error', L.sendFailed((err as Error).message))
  }
}

async function doSave($: $) {
  if (await isBusy($)) return
  const l = await read($, lang)
  const L = t(l)
  try {
    await setStatus($, 'busy', L.packing)
    const b = await buildBundle($, l)
    await revealFile($, b.files[0]!.path)
    await setStatus($, 'ok', L.saved(b.files.length, b.dir))
  } catch (err) {
    await setStatus($, 'error', L.exportFailed((err as Error).message))
  }
}

async function doDelete($: $) {
  const l = await read($, lang)
  const L = t(l)
  const dir = await read($, sentDir)
  await update($, isConfirmingDelete, () => false)
  if (!dir) return
  try {
    await trashExport($, dir, l)
    await update($, sentDir, () => null)
    await update($, lastShare, () => null)
    await setStatus($, 'ok', L.deleted)
  } catch (err) {
    await setStatus($, 'error', L.deleteFailed((err as Error).message))
  }
}

async function doImport($: $, file: string) {
  if (await isBusy($)) return
  const l = await read($, lang)
  const L = t(l)
  file = file.trim().replace(/^"|"$/g, '')
  if (!file) return
  try {
    await setStatus($, 'busy', L.importing)
    const dir = (await read($, targetDir)).trim().replace(/^"|"$/g, '')
    const { message } = await importBundle($, file, dir, l)
    await setStatus($, 'ok', message)
    $.ui.toast(L.toastImported)
  } catch (err) {
    await setStatus($, 'error', L.importFailed((err as Error).message))
  }
}

function fmtSize(n: number) {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}

const STATUS_COLOR = { ok: 'success', warn: 'warning', error: 'error', busy: 'subtle', idle: 'subtle' } as const

// ---------------------------------------------------------------- 注册
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const l = await loadLang($)
    await update($, lang, () => l)
    await registerCommand($, l)
    const started = await next(e)
    // 打开时看一次下载文件夹，之后每分钟看一次：收到新的 .claudeshare 就提醒
    void checkNewShares($, true).catch(() => undefined)
    $.clock.every(60_000, () => void checkNewShares($, true).catch(() => undefined))
    return started
  })

  on('command.run', { command: 'share-chat' }, async $ => {
    await openPane($)
    return { text: (await strings($)).commandOpened }
  })

  // 在 Code 会话里带着 .claudeshare 发送（拖进来的文件以路径出现在消息文字里）：
  //   A. 后台把完整对话导入硬盘，下次重启 Claude 后出现在侧边栏
  //   B. 把对话记录附在这条消息后面交给 Claude，当场接着聊，不用重启
  on('prompt.submit', async ($, e, next) => {
    if (e.origin?.kind !== 'composer') return next(e) // 只处理人在输入框里发的消息
    const paths = findSharePaths([e.text, ...(e.context ?? [])].join('\n'))
    if (!paths.length) return next(e)
    let file: string | undefined
    for (const p of paths) {
      if (!loadedFiles.has(p.toLowerCase()) && (await $.fs.exists(p))) {
        file = p
        break
      }
    }
    if (!file) return next(e)
    const l = await loadLang($)
    const L = t(l)
    try {
      const { home } = await env($)
      const r = await importBundle($, file, home, l)
      const h = historyForChat(r, file, l)
      loadedFiles.add(file.toLowerCase())
      const notice = L.loadedNotice(r.title, h.messages, !!r.localId) + (h.trimmed ? ' ' + L.loadedTrimmed : '')
      await $.session.append({ message: { type: 'system', content: [{ type: 'text', text: notice }] } }).catch(() => undefined)
      $.ui.toast(L.toastLoaded(r.title))
      return next({ ...e, context: [...(e.context ?? []), h.text] })
    } catch (err) {
      $.ui.toast(L.loadFailed((err as Error).message))
      return next(e)
    }
  }).catch(($, e, next) => next(e)) // 出错时照常发送，绝不挡住正常消息

  // 输入框上方的“分享对话”按钮
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button } = $.ui.resolve(e)
    const L = await strings($)
    const fresh = await read($, newShares)
    return (
      <Box flexDirection="row" gap={1}>
        <Button key="open-share" label={L.bandButton} onPress={() => openPane($)} />
        {fresh.length > 0 && <Button key="open-new" variant="primary" label={L.bandNew(fresh.length)} onPress={() => openPane($)} />}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const [l, tt, list, d, last, sent, confirmDel, st, files, ip, td, rec] = await Promise.all([
      read($, lang), read($, title), read($, emails), read($, draft), read($, lastShare), read($, sentDir),
      read($, isConfirmingDelete), read($, status), read($, inbox), read($, importPath), read($, targetDir), read($, recent),
    ])
    const dbl = await read($, doubleClick)
    const L = t(l)
    const busy = st.kind === 'busy'
    const suggestions = rec.filter(m => !list.includes(m))

    // 一张卡片：圆角边框 + 小标题
    const card = (key: string, heading: string, ...children: RenderChildren[]) => (
      <Box key={key} flexDirection="column" gap={1} borderStyle="round" borderColor="subtle" paddingX={2} paddingY={1}>
        <Text size="footnote" weight="semibold" color="subtle">{heading}</Text>
        {children}
      </Box>
    )

    // 一个小标签：圆角边框里的文字 + 一个无边框按钮
    const chip = (key: string, label: string, action: string, onPress: () => unknown, primary = false) => (
      <Box key={key} flexDirection="row" alignItems="center" gap={1} borderStyle="round" borderColor={primary ? 'claude' : 'subtle'} paddingX={1}>
        <Text size="footnote">{label}</Text>
        <Button key={key + ':btn'} plain label={action} onPress={onPress} />
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1} padding={1}>
        {/* 标题 + 语言切换 */}
        <Box flexDirection="row" justifyContent="space-between" alignItems="flex-start" gap={1}>
          <Box flexDirection="column" flexShrink={1}>
            <Text size="heading" weight="semibold">{L.heading}</Text>
            <Text size="footnote" dimColor wrap="truncate-end">{tt || L.thisChat}</Text>
          </Box>
          <Box flexDirection="row" gap={1} flexShrink={0}>
            <Button key="lang-zh" label="中文" variant={l === 'zh' ? 'primary' : 'secondary'} onPress={() => switchLang($, 'zh')} />
            <Button key="lang-en" label="English" variant={l === 'en' ? 'primary' : 'secondary'} onPress={() => switchLang($, 'en')} />
          </Box>
        </Box>

        {/* 收件人 */}
        {card('recipients', L.recipients,
          list.length === 0
            ? <Text key="none" size="footnote" dimColor>{L.noRecipients}</Text>
            : <Box key="chips" flexDirection="row" flexWrap="wrap" gap={1}>
                {list.map(m => chip('to:' + m, m, '✕', () => update($, emails, cur => cur.filter(x => x !== m)), true))}
              </Box>,
          <Input
            key="email"
            placeholder={L.emailPlaceholder}
            value={d}
            submitLabel={L.add}
            onInput={v => void update($, draft, () => v)}
            onSubmit={v => void addDraft($, v)}
          />,
          suggestions.length > 0 && (
            <Box key="recent" flexDirection="column" gap={1}>
              <Text size="caption" dimColor>{L.recent}</Text>
              <Box flexDirection="row" flexWrap="wrap" gap={1}>
                {suggestions.map(m => (
                  <Box key={'sug:' + m} flexDirection="row" alignItems="center" gap={1} borderStyle="round" borderColor="subtle" paddingX={1}>
                    <Button key={'use:' + m} plain label={'＋ ' + m} onPress={() => update($, emails, cur => (cur.includes(m) ? cur : [...cur, m]))} />
                    <Button key={'forget:' + m} plain dimColor label={L.forget} onPress={() => forgetEmail($, m)} />
                  </Box>
                ))}
              </Box>
            </Box>
          ),
        )}

        {/* 发送 */}
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button key="send" variant="primary" label={L.send} onPress={() => (busy ? undefined : doSend($))} />
          <Button key="save" label={L.saveOnly} onPress={() => (busy ? undefined : doSave($))} />
        </Box>

        {/* 状态 */}
        {st.text !== '' && (
          <Box flexDirection="column" borderStyle="round" borderColor={STATUS_COLOR[st.kind]} paddingX={2} paddingY={1}>
            <Text size="footnote" color={st.kind === 'busy' ? undefined : STATUS_COLOR[st.kind]} dimColor={st.kind === 'busy'}>{st.text}</Text>
          </Box>
        )}

        {/* 没连 Gmail 时的其他写信方式 */}
        {last && (
          <Box flexDirection="row" flexWrap="wrap" gap={1} alignItems="center">
            <Text size="footnote" dimColor>{L.noGmail}</Text>
            <Button key="outlook" label={L.outlook} onPress={() => openUrl($, last.outlook)} />
            <Button key="mailto" label={L.mailApp} onPress={() => openUrl($, last.mailto)} />
            <Button key="gmail" label={L.reopenGmail} onPress={() => openUrl($, last.gmail)} />
          </Box>
        )}

        {/* 发送后：打开或删除本地存档 */}
        {sent && !confirmDel && (
          <Box flexDirection="row" flexWrap="wrap" gap={1}>
            <Button key="reveal" label={L.openFolder} onPress={() => revealFile($, last?.pkg ?? sent)} />
            <Button key="delete" label={L.deleteLocal} onPress={() => update($, isConfirmingDelete, () => true)} />
          </Box>
        )}
        {sent && confirmDel && (
          <Box flexDirection="column" gap={1} borderStyle="round" borderColor="warning" paddingX={2} paddingY={1}>
            <Text size="footnote">{L.deleteConfirm(sent)}</Text>
            <Box flexDirection="row" gap={1}>
              <Button key="delete-yes" variant="primary" label={L.deleteYes} onPress={() => doDelete($)} />
              <Button key="delete-no" label={L.cancel} onPress={() => update($, isConfirmingDelete, () => false)} />
            </Box>
          </Box>
        )}

        {/* 附件说明 */}
        {card('attach', L.attachTitle,
          <Box key="list" flexDirection="column">
            {L.attachList.map(([ext, what]) => (
              <Box key={'att:' + ext} flexDirection="row" gap={1}>
                <Text size="footnote" mono>{ext}</Text>
                <Text size="footnote" dimColor>{what}</Text>
              </Box>
            ))}
          </Box>,
          <Text key="gmail-hint" size="caption" dimColor>{L.gmailHint}</Text>,
          <Text key="privacy" size="caption" color="warning">{L.privacy}</Text>,
        )}

        {/* 导入 */}
        {card('import', L.importTitle,
          files.length === 0
            ? <Text key="none" size="footnote" dimColor>{L.noInbox}</Text>
            : <Box key="files" flexDirection="column" gap={1}>
                {files.map(f => (
                  <Box key={'imp:' + f.path} flexDirection="row" alignItems="center" justifyContent="space-between" gap={1}>
                    <Box flexDirection="column" flexShrink={1}>
                      <Text size="footnote" wrap="truncate-middle">{f.name}</Text>
                      <Text size="caption" dimColor>{fmtSize(f.size)}</Text>
                    </Box>
                    <Button key={'imp-btn:' + f.path} label={L.importBtn} onPress={() => doImport($, f.path)} />
                  </Box>
                ))}
              </Box>,
          <Input
            key="import-path"
            label={L.importPath}
            placeholder={L.importPathPh}
            value={ip}
            submitLabel={L.importBtn}
            onInput={v => void update($, importPath, () => v)}
            onSubmit={v => void doImport($, v)}
          />,
          <Input
            key="target-dir"
            label={L.targetDir}
            value={td}
            submitLabel={L.confirm}
            onInput={v => void update($, targetDir, () => v)}
            onSubmit={v => void update($, targetDir, () => v.trim())}
          />,
          <Box key="rescan-row" flexDirection="row">
            <Button
              key="rescan"
              plain
              label={'↻ ' + L.rescan}
              onPress={async () => {
                const fresh = await scanInbox($)
                await update($, inbox, () => fresh)
              }}
            />
          </Box>,
          // 双击打开（只在 Windows 上有）：点一下，交给资源管理器运行设置脚本
          dbl === 'win' && (
            <Box key="dbl" flexDirection="column" gap={1} borderStyle="round" borderColor="subtle" paddingX={1} paddingY={1}>
              <Text size="footnote" weight="semibold">{L.dblTitle}</Text>
              <Text size="caption">{L.dblHow}</Text>
              <Box flexDirection="row" flexWrap="wrap" gap={1}>
                <Button key="dbl-setup" variant="primary" label={L.dblOneClick} onPress={() => runBinScript($, 'setup-double-click.cmd')} />
                <Button key="dbl-undo" label={L.dblUndoBtn} onPress={() => runBinScript($, 'undo-double-click.cmd')} />
                <Button key="dbl-folder" plain label={L.dblOpenFolder} onPress={() => openSetupFolder($)} />
              </Box>
              <Text size="caption" dimColor>{L.dblTip}</Text>
            </Box>
          ),
        )}
      </Box>
    )
  })
}
