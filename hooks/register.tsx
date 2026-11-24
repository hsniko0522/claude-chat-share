import { atom, read, update } from 'claude-code'
import type { Register, EngineInterface, RenderChildren } from 'claude-code'

import type { Status, InboxItem, LastShare } from '../types'
import {
  buildBundle, composeLinks, findGmail, sendViaGmail, openUrl, revealFile,
  scanInbox, importBundle, currentTitle, trashExport, env,
} from './core'
import { t, isLang, type Lang } from './i18n'

const PANE = 'chat-share'

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
    const msg = await importBundle($, file, dir, l)
    await setStatus($, 'ok', msg)
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
    return next(e)
  })

  on('command.run', { command: 'share-chat' }, async $ => {
    await openPane($)
    return { text: (await strings($)).commandOpened }
  })

  // 输入框上方的“分享对话”按钮
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button } = $.ui.resolve(e)
    const L = await strings($)
    return (
      <Box>
        <Button key="open-share" label={L.bandButton} onPress={() => openPane($)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const [l, tt, list, d, last, sent, confirmDel, st, files, ip, td, rec] = await Promise.all([
      read($, lang), read($, title), read($, emails), read($, draft), read($, lastShare), read($, sentDir),
      read($, isConfirmingDelete), read($, status), read($, inbox), read($, importPath), read($, targetDir), read($, recent),
    ])
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
        )}
      </Box>
    )
  })
}
