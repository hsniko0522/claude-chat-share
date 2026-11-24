// 导出 / 发送 / 导入的实际工作
import type { EngineInterface } from 'claude-code'
import { toTurns, toItems, toMarkdown, toText, toHtml, type Rec, type Meta } from './formats'
import { t, type Lang } from './i18n'

type $ = EngineInterface

export const FORMAT = 'claude-code-share/2'
const CHUNK = 3 * 1024 * 1024 // 3 的倍数：分段读出的 base64 可以直接拼接
const CHARS_PER_PART = 1_000_000 // 每段最多 ~3 MB，低于 $.fs.write 的 4 MB 上限
const KEEP = new Set(['user', 'assistant', 'system', 'attachment', 'summary', 'custom-title', 'agent-name', 'last-prompt', 'mode'])
const TXT_BOM = String.fromCharCode(0xfeff) // 让记事本按 UTF-8 打开

// ---------------------------------------------------------------- 平台和路径
export type Env = {
  isWin: boolean
  isMac: boolean
  sep: string
  home: string
  downloads: string
  data: string
  tar: string
  desktopRoots: string[]
}

let envCache: Env | undefined
export async function env($: $): Promise<Env> {
  if (envCache) return envCache
  const info = await $.session.info()
  const isWin = info.platform === 'windows'
  const sep = isWin ? '\\' : '/'
  const home = (isWin ? await $.env.get('USERPROFILE') : await $.env.get('HOME')) ?? ''
  const hookEnv = await $.process.hookEnv()
  const data = hookEnv.CLAUDE_PLUGIN_DATA ?? join(sep, home, '.claude', 'chat-share')
  const sysRoot = (await $.env.get('SystemRoot')) ?? 'C:\\Windows'
  const desktopRoots: string[] = []
  if (isWin) {
    const la = await $.env.get('LOCALAPPDATA')
    const ra = await $.env.get('APPDATA')
    if (la) desktopRoots.push(la)
    if (ra) desktopRoots.push(ra)
  } else if (info.platform === 'macos') {
    desktopRoots.push(join(sep, home, 'Library', 'Application Support'))
  } else {
    desktopRoots.push(join(sep, home, '.config'))
  }
  envCache = {
    isWin,
    isMac: info.platform === 'macos',
    sep,
    home,
    downloads: join(sep, home, 'Downloads'),
    data,
    tar: isWin ? join(sep, sysRoot, 'System32', 'tar.exe') : 'tar',
    desktopRoots,
  }
  return envCache
}

export function join(sep: string, ...parts: string[]): string {
  return parts
    .filter(Boolean)
    .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+|[\\/]+$/g, '')))
    .join(sep)
}

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p
const dirName = (p: string) => p.replace(/[\\/][^\\/]*$/, '')
/** 纯英文文件名：只留标题里的英文字母和数字，再加时间，避免各种工具不认中文路径 */
export const asciiName = (title: string, when: string) => {
  const slug = title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30)
  return `${slug || 'chat'}-${when}`
}
const encodeCwd = (cwd: string) => cwd.replace(/[^A-Za-z0-9]/g, '-')

function uuid(): string {
  return crypto.randomUUID()
}

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

// ---------------------------------------------------------------- 文件读写（绕开 4 MB 单次上限）
function fromB64(b64: string): Uint8Array {
  const U = Uint8Array as any
  if (typeof U.fromBase64 === 'function') return U.fromBase64(b64)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function readB64Chunks($: $, path: string): Promise<string[]> {
  const { size } = await $.fs.stat(path)
  const out: string[] = []
  for (let off = 0; off < size; off += CHUNK) {
    const r = (await $.fs.read(path, { as: 'bytes', offset: off, length: Math.min(CHUNK, size - off) })) as { base64: string }
    out.push(r.base64)
  }
  return out
}

async function readText($: $, path: string): Promise<string> {
  const chunks = (await readB64Chunks($, path)).map(fromB64)
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const all = new Uint8Array(total)
  let o = 0
  for (const c of chunks) {
    all.set(c, o)
    o += c.length
  }
  return new TextDecoder().decode(all)
}

function splitText(text: string): string[] {
  const parts: string[] = []
  let i = 0
  while (i < text.length) {
    let end = Math.min(i + CHARS_PER_PART, text.length)
    const code = text.charCodeAt(end - 1)
    if (end < text.length && code >= 0xd800 && code <= 0xdbff) end -= 1 // 不拆开代理对
    parts.push(text.slice(i, end))
    i = end
  }
  return parts.length ? parts : ['']
}

async function run($: $, argv: string[], cwd?: string, timeoutMs = 180_000) {
  const r = await $.process.run(argv, cwd ? { timeoutMs, cwd } : { timeoutMs })
  if (r.exitCode !== 0) throw new Error(`${baseName(argv[0] ?? "")} 失败：${(r.stderr || r.stdout).trim().slice(0, 300)}`)
  return r
}

const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`

/** 写任意大小的文本文件：小的直接写，大的分段写再用系统命令拼起来 */
async function writeBig($: $, path: string, text: string): Promise<void> {
  const parts = splitText(text)
  if (parts.length === 1) return $.fs.write(path, text)
  const e = await env($)
  const names = parts.map((_, i) => `${path}.part${String(i).padStart(3, '0')}`)
  for (let i = 0; i < parts.length; i++) await $.fs.write(names[i]!, parts[i]!)
  if (e.isWin) {
    const script =
      `$o=[IO.File]::Create(${psQuote(path)});` +
      `foreach($p in @(${names.map(psQuote).join(',')})){$b=[IO.File]::ReadAllBytes($p);$o.Write($b,0,$b.Length);Remove-Item -LiteralPath $p};` +
      `$o.Close()`
    await run($, ['powershell', '-NoProfile', '-NonInteractive', '-Command', script])
  } else {
    await run($, ['sh', '-c', 'out="$1"; shift; cat "$@" > "$out" && rm -f "$@"', 'sh', path, ...names])
  }
}

async function removeDir($: $, path: string) {
  const e = await env($)
  try {
    if (e.isWin) await run($, ['powershell', '-NoProfile', '-NonInteractive', '-Command', `Remove-Item -LiteralPath ${psQuote(path)} -Recurse -Force`])
    else await run($, ['rm', '-rf', path])
  } catch {
    /* 清理失败不影响结果 */
  }
}

/**
 * 复制整个文件夹。Windows 上用 robocopy：它不受 260 字符路径上限的限制
 * （Claude 的项目文件夹名可能很长）。返回是否成功，失败不抛错。
 */
async function copyDir($: $, from: string, to: string, move = false): Promise<boolean> {
  const e = await env($)
  try {
    if (e.isWin) {
      const r = await $.process.run(['robocopy', from, to, '/E', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', ...(move ? ['/MOVE'] : [])], { timeoutMs: 180_000 })
      return r.exitCode < 8 // robocopy：0-7 都算成功
    }
    await run($, move ? ['mv', from, to] : ['cp', '-R', from, to])
    return true
  } catch {
    return false
  }
}

/** 复制文件或文件夹（PowerShell / cp 都认任何语言的路径） */
async function copyPath($: $, from: string, to: string) {
  const e = await env($)
  if (e.isWin) await run($, ['powershell', '-NoProfile', '-NonInteractive', '-Command', `Copy-Item -LiteralPath ${psQuote(from)} -Destination ${psQuote(to)} -Recurse -Force`])
  else await run($, ['cp', '-R', from, to])
}

/**
 * 删除一次导出的本地存档：放进回收站（不是永久删除），只认下载\Claude-Chat-Share 里的文件夹。
 */
export async function trashExport($: $, dir: string, lang: Lang): Promise<void> {
  const e = await env($)
  const root = join(e.sep, e.downloads, 'Claude-Chat-Share')
  const norm = (p: string) => p.replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase()
  const inside = norm(dir).startsWith(norm(root) + '/') && !/(^|[\\/])\.\.([\\/]|$)/.test(dir)
  if (!inside || !(await isDir($, dir))) throw new Error(t(lang).errNotInShare)
  if (e.isWin) {
    const script =
      'Add-Type -AssemblyName Microsoft.VisualBasic;' +
      `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(${psQuote(dir)},'OnlyErrorDialogs','SendToRecycleBin')`
    await run($, ['powershell', '-NoProfile', '-NonInteractive', '-Command', script])
  } else if (e.isMac) {
    await run($, ['osascript', '-e', 'on run argv', '-e', 'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)', '-e', 'end run', dir])
  } else {
    await run($, ['gio', 'trash', dir])
  }
}

// ---------------------------------------------------------------- 双击 .claudeshare 打开（只在 Windows）
// app 里运行的命令改注册表时，改动只进 app 自己的一份私有注册表，资源管理器看不到。
// 所以设置由 bin\setup-double-click.cmd 完成：人在面板里点按钮时，交给资源管理器去打开它，
// 和人在资源管理器里亲手双击它一样（弹出窗口、按提示完成）。

export type BinScript = 'setup-double-click.cmd' | 'undo-double-click.cmd'

/** mod 自带脚本的位置；不是 Windows 时 undefined */
export async function binScriptPath($: $, name: BinScript): Promise<string | undefined> {
  const e = await env($)
  if (!e.isWin) return undefined
  return join(e.sep, $.plugin.root, 'bin', name)
}

/** 让资源管理器打开 mod 自带的脚本（等同于人在资源管理器里双击它）。只在人点按钮时调用 */
export async function openWithExplorer($: $, name: BinScript): Promise<boolean> {
  const p = await binScriptPath($, name)
  if (!p || !(await $.fs.exists(p))) return false
  // explorer 成功时也常返回 1，不看退出码
  await $.process.run(['explorer.exe', p], { timeoutMs: 15_000 })
  return true
}

async function isDir($: $, path: string): Promise<boolean> {
  try {
    return (await $.fs.stat(path)).kind === 'dir'
  } catch {
    return false
  }
}

// ---------------------------------------------------------------- 桌面 app 的会话列表
async function desktopDirs($: $): Promise<string[]> {
  const e = await env($)
  const found: { dir: string; mtime: number }[] = []
  for (const root of e.desktopRoots) {
    let bases: string[] = []
    try {
      bases = (await $.fs.list(root)).filter(x => x.kind === 'dir' && /^claude/i.test(x.name)).map(x => join(e.sep, root, x.name))
    } catch {
      continue
    }
    for (const base of bases) {
      const candidates = [join(e.sep, base, 'claude-code-sessions')]
      try {
        for (const c of await $.fs.list(base)) if (c.kind === 'dir') candidates.push(join(e.sep, base, c.name, 'claude-code-sessions'))
      } catch {}
      for (const sr of candidates) {
        if (!(await isDir($, sr))) continue
        for (const acct of await $.fs.list(sr)) {
          if (acct.kind !== 'dir') continue
          const ad = join(e.sep, sr, acct.name)
          for (const org of await $.fs.list(ad)) {
            if (org.kind !== 'dir') continue
            const od = join(e.sep, ad, org.name)
            const files = (await $.fs.list(od)).filter(f => /^local_.*\.json$/.test(f.name))
            found.push({ dir: od, mtime: Math.max(0, ...files.map(f => f.mtimeMs)) })
          }
        }
      }
    }
  }
  return found.sort((a, b) => b.mtime - a.mtime).map(f => f.dir)
}

async function desktopMetaFor($: $, cliSessionId: string): Promise<Rec | undefined> {
  const e = await env($)
  for (const d of await desktopDirs($)) {
    for (const f of await $.fs.list(d)) {
      if (!/^local_.*\.json$/.test(f.name)) continue
      const p = join(e.sep, d, f.name)
      const head = (await $.fs.read(p, { offset: 0, length: 4096 })) as string
      if (!head.includes(`"${cliSessionId}"`)) continue
      try {
        return JSON.parse(await readText($, p))
      } catch {
        return undefined
      }
    }
  }
  return undefined
}

// ---------------------------------------------------------------- 导出
export type Bundle = {
  title: string
  messages: number
  dir: string
  lang: Lang // 导出时界面的语言：邮件和文件里的固定文字都跟着它
  files: { path: string; name: string; mime: string; size: number }[]
}

function parseJsonl(text: string): Rec[] {
  const out: Rec[] = []
  for (const line of text.split('\n')) {
    const s = line.trim()
    if (!s) continue
    try {
      out.push(JSON.parse(s))
    } catch {}
  }
  return out
}

export async function currentTitle($: $): Promise<string> {
  const info = await $.session.info()
  const sid = baseName(info.transcriptPath).replace(/\.jsonl$/, '')
  const meta = await desktopMetaFor($, sid)
  if (meta?.title) return meta.title
  try {
    const recs = parseJsonl(await readText($, info.transcriptPath))
    const t = [...recs].reverse().find(r => r.type === 'custom-title')
    if (t) return t.customTitle
  } catch {}
  return ''
}

export async function buildBundle($: $, lang: Lang): Promise<Bundle> {
  const L = t(lang)
  const e = await env($)
  const info = await $.session.info()
  const src = info.transcriptPath
  const sid = baseName(src).replace(/\.jsonl$/, '')
  const recs = parseJsonl(await readText($, src)).filter(r => KEEP.has(r.type))
  if (!recs.some(r => r.type === 'assistant')) throw new Error(L.errNoReply)

  const desk = await desktopMetaFor($, sid)
  const cwd = desk?.cwd ?? recs.find(r => r.cwd)?.cwd ?? (await $.session.root())
  const title = desk?.title ?? [...recs].reverse().find(r => r.type === 'custom-title')?.customTitle ?? L.thisChat
  const model = desk?.model ?? [...recs].reverse().find(r => r.type === 'assistant' && r.message?.model)?.message?.model
  const meta: Meta = { title, cwd, model, exportedAt: new Date().toISOString(), lang }

  const items = toItems(recs, lang)
  const mdAi = toMarkdown(items, meta, false) // 给 AI：不带图片数据
  const mdHuman = toMarkdown(items, meta, true) // 给人看：带图片
  const messages = toTurns(items).filter(x => x.role !== 'tool').length

  // 1. 给 Claude 用户的完整会话包
  const stage = join(e.sep, e.data, 'stage', stamp())
  const sessionText = recs.map(r => JSON.stringify(r)).join('\n') + '\n'
  const parts = splitText(sessionText)
  for (let i = 0; i < parts.length; i++) await $.fs.write(join(e.sep, stage, 'session', `${String(i).padStart(3, '0')}.jsonl`), parts[i]!)
  const manifest = { format: FORMAT, title, sourceSessionId: sid, sourceCwd: cwd, model, effort: desk?.effort, exportedAt: meta.exportedAt, messages, parts: parts.length }
  await $.fs.write(join(e.sep, stage, 'manifest.json'), JSON.stringify(manifest, null, 2))

  const name = asciiName(title, stamp())
  const outDir = join(e.sep, e.downloads, 'Claude-Chat-Share', name)

  // 2. 给其他 AI / 直接看的版本（先写，顺便建好文件夹）
  const mdPath = join(e.sep, outDir, `${name}.md`)
  const aiMdPath = join(e.sep, outDir, `${name}.ai.md`)
  const htmlPath = join(e.sep, outDir, `${name}.html`)
  const txtPath = join(e.sep, outDir, `${name}.txt`)
  await writeBig($, aiMdPath, mdAi)
  await writeBig($, mdPath, mdHuman)
  await writeBig($, htmlPath, toHtml(items, meta, mdAi)) // 网页上“复制给其他 AI”复制的是给 AI 的版本
  await writeBig($, txtPath, TXT_BOM + toText(items, meta))

  // 1. Claude 用的会话包：tar 只在临时文件夹里用相对路径工作，不碰任何可能含中文的绝对路径
  const sidecar = join(e.sep, dirName(src), sid)
  const entries = ['manifest.json', 'session']
  // 附带文件夹（子任务记录、大段工具输出）不是必需的：复制不了就跳过
  if ((await isDir($, sidecar)) && (await copyDir($, sidecar, join(e.sep, stage, sid)))) entries.push(sid)
  // Mac 上不要夹带 ._xxx 属性文件
  await run($, [e.tar, ...(e.isMac ? ['--no-mac-metadata'] : []), '-czf', 'package.claudeshare', ...entries], stage)
  const pkg = join(e.sep, outDir, `${name}.claudeshare`)
  await copyPath($, join(e.sep, stage, 'package.claudeshare'), pkg)
  await removeDir($, stage)

  const files = []
  // 文本附件必须写明 charset=utf-8：不写的话 Gmail 会按 Latin-1 重新编码，中文全变成 ?
  // 顺序也是附件太大时的取舍顺序：靠前的优先附上
  for (const [path, mime] of [
    [pkg, 'application/gzip'],
    [aiMdPath, 'text/markdown; charset=utf-8'],
    [htmlPath, 'text/html; charset=utf-8'],
    [mdPath, 'text/markdown; charset=utf-8'],
    [txtPath, 'text/plain; charset=utf-8'],
  ] as const) {
    files.push({ path, name: baseName(path), mime, size: (await $.fs.stat(path)).size })
  }
  return { title, messages, dir: outDir, lang, files }
}

// ---------------------------------------------------------------- 发邮件
const MAIL_LIMIT = 17 * 1024 * 1024 // Gmail 单封上限 25 MB，附件要 base64，留出余量

/**
 * 找这个会话里已经连上的 Gmail 连接器，找不到返回 undefined（不报错、不要求用户去连）。
 * 连接器的名字可能是一串编号，所以按“工具名以 __send_message 结尾、说明里提到 Gmail”来认。
 */
export async function findGmail($: $): Promise<string | undefined> {
  // 1. 桌面 app 给每个会话存的连接器清单（延后加载的连接器也在里面）
  try {
    const info = await $.session.info()
    const sid = baseName(info.transcriptPath).replace(/\.jsonl$/, '')
    const list: Rec[] = (await desktopMetaFor($, sid))?.remoteMcpServersConfig ?? []
    const g = list.find(s => /gmail/i.test(String(s.name)) || /gmailmcp\.googleapis\.com/.test(String(s.url)))
    if (g?.uuid) {
      const r = await $.mcp.connect(String(g.uuid))
      if (r.isConnected) return r.server
    }
  } catch {}
  // 2. 当前可用的工具里找
  try {
    const tools = await $.tool.list()
    const t = tools.find(x => x.mcp && /__send_message$/.test(x.name) && /gmail/i.test(x.description))
    if (t) return t.name.replace(/^mcp__/, '').replace(/__send_message$/, '')
  } catch {}
  // 3. 常见名字
  for (const name of ['claude.ai Gmail', 'Gmail']) {
    try {
      const r = await $.mcp.connect(name)
      if (r.isConnected) return r.server
    } catch {}
  }
  return undefined
}

/** 用已连接的 Gmail 直接发，附件自动附上。返回没附上的文件名（太大时） */
export async function sendViaGmail($: $, server: string, b: Bundle, to: string[]): Promise<string[]> {
  const attachments: Record<string, string>[] = []
  const skipped: string[] = []
  let total = 0
  for (const f of b.files) {
    if (total + f.size > MAIL_LIMIT) {
      skipped.push(f.name)
      continue
    }
    total += f.size
    attachments.push({ filename: f.name, mimeType: f.mime, content: (await readB64Chunks($, f.path)).join('') })
  }
  const L = t(b.lang)
  if (!attachments.length) throw new Error(L.errTooBig)
  const { subject, body } = mailText(b)
  const note = skipped.length ? '\n\n' + L.mailSkipped(skipped.join(b.lang === 'zh' ? '、' : ', ')) : ''
  const r = await $.mcp.call(server, 'send_message', { to, subject, body: body + note, attachments })
  if (r.isError) throw new Error(r.content.map(c => c.text ?? '').join(' ').slice(0, 300) || L.errGmail)
  return skipped
}

// 没有连接器时：打开写信页面（收件人、标题、正文填好），附件由人拖进去
export type Compose = { gmail: string; outlook: string; mailto: string }

export function mailText(b: Bundle): { subject: string; body: string } {
  // 按后缀认文件，不依赖顺序（xxx.ai.md 要先于 xxx.md 判断）
  const pick = (re: RegExp) => b.files.find(f => re.test(f.name))?.name ?? ''
  const pkg = pick(/\.claudeshare$/), aiMd = pick(/\.ai\.md$/), md = pick(/(?<!\.ai)\.md$/)
  const html = pick(/\.html$/), txt = pick(/\.txt$/)
  const L = t(b.lang)
  const colon = b.lang === 'zh' ? '：' : ': '
  const body = [
    L.mailIntro(b.title, b.messages, b.files.length),
    '',
    `· ${pkg}${colon}${L.mailPkg}`,
    `· ${aiMd}${colon}${L.mailAiMd}`,
    `· ${html}${colon}${L.mailHtml}`,
    `· ${md}${colon}${L.mailMd}`,
    `· ${txt}${colon}${L.mailTxt}`,
  ].join('\n')
  return { subject: L.mailSubject(b.title), body }
}

export function composeLinks(b: Bundle, to: string[]): Compose {
  const { subject, body } = mailText(b)
  const q = encodeURIComponent
  const list = to.join(',')
  return {
    gmail: `https://mail.google.com/mail/?view=cm&fs=1&to=${q(list)}&su=${q(subject)}&body=${q(body)}`,
    outlook: `https://outlook.live.com/mail/0/deeplink/compose?to=${q(list)}&subject=${q(subject)}&body=${q(body)}`,
    mailto: `mailto:${list}?subject=${q(subject)}&body=${q(body)}`,
  }
}

/** 用系统默认程序打开网址（浏览器 / 邮件程序） */
export async function openUrl($: $, url: string) {
  const e = await env($)
  const argv = e.isWin ? ['rundll32', 'url.dll,FileProtocolHandler', url] : [e.isMac ? 'open' : 'xdg-open', url]
  await $.process.run(argv, { timeoutMs: 15_000 })
}

/** 打开文件所在的文件夹并选中它 */
export async function revealFile($: $, path: string) {
  const e = await env($)
  // explorer 成功时也会返回 1，所以不看退出码
  const argv = e.isWin ? ['explorer', `/select,${path}`] : e.isMac ? ['open', '-R', path] : ['xdg-open', dirName(path)]
  await $.process.run(argv, { timeoutMs: 15_000 })
}

// ---------------------------------------------------------------- 导入
export async function scanInbox($: $) {
  const e = await env($)
  try {
    return (await $.fs.list(e.downloads))
      .filter(f => f.kind === 'file' && /\.claudeshare$/i.test(f.name))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, 8)
      .map(f => ({ name: f.name, path: join(e.sep, e.downloads, f.name), size: f.size, mtimeMs: f.mtimeMs }))
  } catch {
    return []
  }
}

function rewrite(obj: any, oldCwd: string, newCwd: string, oldSid: string, newSid: string): any {
  if (Array.isArray(obj)) return obj.map(v => rewrite(v, oldCwd, newCwd, oldSid, newSid))
  if (obj && typeof obj === 'object') {
    const out: Rec = {}
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'sessionId' && v === oldSid) out[k] = newSid
      else if ((k === 'cwd' || k === 'relocatedCwd') && typeof v === 'string' && oldCwd && v.startsWith(oldCwd)) out[k] = newCwd + v.slice(oldCwd.length)
      else out[k] = rewrite(v, oldCwd, newCwd, oldSid, newSid)
    }
    return out
  }
  return obj
}

// ---------------------------------------------------------------- 当场接着聊：把导入的对话变成给 Claude 读的记录
const CHAT_CONTEXT_MAX = 150_000 // 字符；再长就只留最近的部分，免得占满上下文

/** 消息文字里以 .claudeshare 结尾的本机路径（Code 会话里拖进来的文件以路径出现在文字里） */
export function findSharePaths(text: string): string[] {
  const win = text.match(/[A-Za-z]:[\\/][^\r\n"<>|*?]*?\.claudeshare/gi) ?? []
  // Mac / Linux 路径：只认前面是空白、引号或 @ 的，免得截到 Windows 路径的后半段
  const posix = text.match(/(?<=^|[\s"'@(\[])(?:~|\/)[^\s"<>|*?]*?\.claudeshare/gi) ?? []
  return [...new Set([...win, ...posix].map(p => p.replace(/^@/, '')))]
}

export function historyForChat(r: ImportResult, file: string, lang: Lang): { text: string; messages: number; trimmed: boolean } {
  const L = t(lang)
  const items = toItems(r.recs, lang)
  const meta: Meta = {
    title: r.title,
    cwd: String(r.manifest.sourceCwd ?? ''),
    model: r.manifest.model,
    exportedAt: String(r.manifest.exportedAt ?? new Date().toISOString()),
    lang,
  }
  const md = toMarkdown(items, meta, false)
  const messages = toTurns(items).filter(x => x.role !== 'tool').length
  const intro = L.ctxIntro(baseName(file))
  if (md.length <= CHAT_CONTEXT_MAX) return { text: `${intro}\n\n${md}`, messages, trimmed: false }
  // 太长：保留开头的说明（到第一条分隔线为止）+ 最近的部分，从一轮对话的开头切
  const headEnd = md.indexOf('\n---\n')
  const head = headEnd > 0 ? md.slice(0, headEnd) : md.slice(0, 2000)
  let tail = md.slice(md.length - (CHAT_CONTEXT_MAX - head.length - 500))
  const cut = tail.indexOf('\n---\n')
  if (cut > 0) tail = tail.slice(cut)
  const dropped = md.length - head.length - tail.length
  return { text: `${intro}\n\n${head}\n\n${L.ctxTrimmed(dropped)}\n${tail}`, messages, trimmed: true }
}

/** 导入的结果：给人看的一句话，以及解析出来的原始记录（当场接着聊要用） */
export type ImportResult = { message: string; title: string; manifest: Rec; recs: Rec[]; localId?: string }

export async function importBundle($: $, file: string, targetDir: string, lang: Lang): Promise<ImportResult> {
  const L = t(lang)
  const e = await env($)
  if (!(await isDir($, targetDir))) throw new Error(L.errNoFolder(targetDir))
  const stage = join(e.sep, e.data, 'inbox', uuid())
  await $.fs.write(join(e.sep, stage, '.keep'), '')
  try {
    // 先复制成一个英文名，tar 只用相对路径解包
    await copyPath($, file, join(e.sep, stage, 'package.claudeshare'))
    await run($, [e.tar, '-xf', 'package.claudeshare'], stage)
    const manifest = JSON.parse(await readText($, join(e.sep, stage, 'manifest.json')))
    if (!String(manifest.format ?? '').startsWith('claude-code-share/')) throw new Error(L.errNotPackage)

    // 新旧两种包都认：v2 分段在 session/，v1 是一个 session.jsonl
    let text = ''
    const sessDir = join(e.sep, stage, 'session')
    if (await isDir($, sessDir)) {
      // Mac 打包时会夹带 ._xxx 隐藏文件（Mac 的文件属性，不是对话），跳过
      const parts = (await $.fs.list(sessDir)).filter(f => f.name.endsWith('.jsonl') && !f.name.startsWith('._')).map(f => f.name).sort()
      for (const p of parts) text += await readText($, join(e.sep, sessDir, p))
    } else {
      text = await readText($, join(e.sep, stage, 'session.jsonl'))
    }

    const oldSid: string = manifest.sourceSessionId
    const newSid = uuid()
    const title: string = manifest.title || L.importedDefaultTitle
    const original = parseJsonl(text)
    const recs = original
      .map(r => rewrite(r, manifest.sourceCwd ?? '', targetDir, oldSid, newSid))
      .filter(r => r.type !== 'custom-title' && r.type !== 'agent-name')
    recs.push({ type: 'custom-title', customTitle: title, sessionId: newSid })
    recs.push({ type: 'agent-name', agentName: title, sessionId: newSid })

    const info = await $.session.info()
    const configRoot = info.configRoot ?? join(e.sep, e.home, '.claude')
    const projDir = join(e.sep, configRoot, 'projects', encodeCwd(targetDir))
    await writeBig($, join(e.sep, projDir, `${newSid}.jsonl`), recs.map(r => JSON.stringify(r)).join('\n') + '\n')

    for (const side of [join(e.sep, stage, oldSid), join(e.sep, stage, 'sidecar')]) {
      if (await isDir($, side)) {
        await copyDir($, side, join(e.sep, projDir, newSid), true)
        break
      }
    }

    const dirs = await desktopDirs($)
    if (dirs.length) {
      const now = Date.now()
      const localId = 'local_' + uuid()
      const lastAsst = [...recs].reverse().find(r => r.type === 'assistant')?.uuid
      const meta: Rec = {
        sessionId: localId,
        cliSessionId: newSid,
        cwd: targetDir,
        originCwd: targetDir,
        folderPlace: { cwd: targetDir, realPath: targetDir },
        gitAnchorsFolderRealpath: targetDir,
        createdAt: now,
        lastActivityAt: now,
        lastFocusedAt: now,
        lastTurnEdgeAt: now,
        isArchived: false,
        title,
        titleSource: 'user',
        permissionMode: 'default',
        completedTurns: recs.filter(r => r.type === 'user' && !r.isMeta).length,
        lastAssistantUuid: lastAsst,
        lastAssistantCliSessionId: newSid,
      }
      if (manifest.model) meta.model = manifest.model
      if (manifest.effort) meta.effort = manifest.effort
      await $.fs.write(join(e.sep, dirs[0]!, `${localId}.json`), JSON.stringify(meta, null, 2))
      return { message: L.importedDesktop(title), title, manifest, recs: original, localId }
    }
    return { message: L.importedCli(title, targetDir, newSid), title, manifest, recs: original }
  } finally {
    await removeDir($, stage)
  }
}
