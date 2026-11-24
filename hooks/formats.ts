// 把 Claude Code 的会话记录转成人和其他 AI 都能读的格式：Markdown / 纯文本 / 网页
// 固定文字（标签、说明、按钮）按 lang 出中文或英文；对话内容本身原样保留
import { t, type Lang, type Strings } from './i18n'

export type Rec = Record<string, any>
export type Turn = { role: 'user' | 'assistant' | 'tool'; text: string }

export type Meta = {
  title: string
  cwd: string
  model?: string
  exportedAt: string
  lang: Lang
}

const TOOL_OUT_MAX = 1500
const TOOL_IN_MAX = 400

function clean(s: string): string {
  return s
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<pasted_content[^>]*>([\s\S]*?)<\/pasted_content[^>]*>/g, '$1')
    .replace(/<(local-command-[a-z]+|command-[a-z]+|ide_[a-z_]+)>[\s\S]*?<\/\1>/g, '')
    .trim()
}

function cut(s: string, max: number, L: Strings): string {
  return s.length > max ? s.slice(0, max) + '\n' + L.omitted(s.length - max) : s
}

function toolInputSummary(input: any, L: Strings): string {
  if (!input || typeof input !== 'object') return ''
  const pick = input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.url ?? input.query ?? input.description
  if (typeof pick === 'string') return cut(pick, TOOL_IN_MAX, L)
  return cut(JSON.stringify(input), TOOL_IN_MAX, L)
}

function resultText(block: any, L: Strings): string {
  const c = block.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return c.map((x: any) => (x.type === 'text' ? x.text : x.type === 'image' ? L.image : '')).join('\n')
  }
  return ''
}

/** 一步：用户的话、Claude 的话、Claude 的选项卡提问、Claude 调用工具、工具的输出 */
export type Item = { kind: 'user' | 'text' | 'ask' | 'call' | 'result'; text: string; img?: string }

/** 图片块 → data: 地址（只认 base64 的图片，数据里只能有 base64 字符） */
function imageUri(b: any): string | undefined {
  const s = b?.source
  if (s?.type !== 'base64' || typeof s.data !== 'string') return undefined
  const mime = String(s.media_type ?? '')
  if (!/^image\/(png|jpeg|gif|webp)$/.test(mime) || !/^[A-Za-z0-9+/=]+$/.test(s.data)) return undefined
  return `data:${mime};base64,${s.data}`
}

/** 选项卡提问 → “问题 + 每个选项”的文字 */
function formatAsk(input: any, lang: Lang): string {
  const colon = lang === 'zh' ? '：' : ': '
  const qs: any[] = Array.isArray(input?.questions) ? input.questions : []
  return qs
    .map(q => {
      const opts: any[] = Array.isArray(q.options) ? q.options : []
      const lines = opts.map(o => `- **${o.label ?? ''}**${o.description ? colon + o.description : ''}`)
      return [`**${q.question ?? ''}**`, ...lines].join('\n')
    })
    .join('\n\n')
}

/** 会话记录 → 一步一步的列表（只取主线，不含子代理和系统注入的内容） */
export function toItems(recs: Rec[], lang: Lang): Item[] {
  const L = t(lang)
  const items: Item[] = []
  const push = (kind: Item['kind'], text: string) => {
    text = text.trim()
    if (text) items.push({ kind, text })
  }
  const askIds = new Set<string>() // Claude 向用户提问（选项卡）的调用：用户的回答要当成用户说的话
  for (const r of recs) {
    if (r.isSidechain || r.isMeta || r.isCompactSummary || r.isApiErrorMessage) continue
    const msg = r.message
    if (!msg) continue
    if (r.type === 'user') {
      if (typeof msg.content === 'string') {
        push('user', clean(msg.content))
        continue
      }
      for (const b of msg.content ?? []) {
        if (b.type === 'text') push('user', clean(b.text ?? ''))
        else if (b.type === 'image') {
          // 网页版和带图的 Markdown 直接显示图片；纯文本里只留一句说明
          items.push({ kind: 'user', text: L.imageSeeOther, img: imageUri(b) })
        } else if (b.type === 'tool_result' && askIds.has(b.tool_use_id)) {
          // 问题就显示在上面：只问了一个时直接写选了什么，问了几个时再标出是哪个问题
          const pairs = [...resultText(b, L).matchAll(/"([^"]*)"="([^"]*)"/g)]
          const answers = pairs.length === 1 ? [L.chose(pairs[0]![2]!)] : pairs.map(m => `「${m[1]}」→ ${m[2]}`)
          if (answers.length) push('user', answers.join('\n'))
          else push('result', cut(clean(resultText(b, L)), TOOL_OUT_MAX, L))
        } else if (b.type === 'tool_result') push('result', cut(clean(resultText(b, L)), TOOL_OUT_MAX, L))
      }
    } else if (r.type === 'assistant') {
      for (const b of msg.content ?? []) {
        if (b.type === 'tool_use' && b.name === 'AskUserQuestion') {
          // 选项卡提问：问题和选项是说给用户看的，不算工作过程
          askIds.add(b.id)
          push('ask', formatAsk(b.input, lang))
        } else if (b.type === 'text') push('text', b.text ?? '')
        else if (b.type === 'tool_use') {
          // mcp__<服务器>__<工具> 只留工具名
          const name = String(b.name ?? '').replace(/^mcp__.+?__/, '')
          push('call', `${L.toolCall(name)} ${toolInputSummary(b.input, L)}`.trim())
        }
      }
    }
  }
  return items
}

/** 合并成对话轮次（给纯文本用，保留全部过程） */
export function toTurns(items: Item[]): Turn[] {
  const turns: Turn[] = []
  for (const it of items) {
    const role: Turn['role'] = it.kind === 'user' ? 'user' : it.kind === 'result' ? 'tool' : 'assistant'
    const last = turns[turns.length - 1]
    if (last && last.role === role && role !== 'tool') last.text += '\n\n' + it.text
    else turns.push({ role, text: it.text })
  }
  return turns
}

/**
 * 一来一回：用户说的话 + Claude 中间的工作过程 + Claude 最后说的话。
 * “最后说的话”是最后一次调用工具之后的文字；之前的说明、工具调用和输出都算工作过程。
 */
export type Exchange = { user: { text: string; img?: string }[]; work: Item[]; reply: string[] }

export function toExchanges(items: Item[]): Exchange[] {
  const out: Exchange[] = []
  let cur: Exchange | undefined
  for (const it of items) {
    if (it.kind === 'user') {
      if (!cur || cur.work.length || cur.reply.length) {
        cur = { user: [], work: [], reply: [] }
        out.push(cur)
      }
      cur.user.push({ text: it.text, img: it.img })
      continue
    }
    if (!cur) {
      cur = { user: [], work: [], reply: [] }
      out.push(cur)
    }
    if (it.kind === 'text' || it.kind === 'ask') {
      cur.reply.push(it.text)
    } else {
      // 又调用了工具：之前以为是“最后的话”的文字其实是过程中的说明
      cur.work.push(...cur.reply.map(text => ({ kind: 'text' as const, text })), it)
      cur.reply = []
    }
  }
  return out
}

function localTime(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function handoffNote(meta: Meta, forAi: boolean): string {
  const L = t(meta.lang)
  const lines = [L.noteExported(localTime(meta.exportedAt)), L.noteFolder(meta.cwd, meta.model)]
  if (forAi) lines.push('', L.noteForAi)
  return lines.join('\n')
}

const fence = (s: string) => s.replace(/```/g, 'ˋˋˋ') // 内容里的 ``` 会提前结束代码块

/**
 * Markdown 版：和网页版一样一来一回，Claude 的工作过程放进 <details> 折叠块
 * （VS Code、Typora、Obsidian、GitHub 的预览都能展开收起；AI 读的时候照样看得到里面的内容）。
 * withImages：把用户发的图片嵌进去（给人看的版本）；给 AI 的版本不带图片数据。
 */
export function toMarkdown(items: Item[], meta: Meta, withImages: boolean): string {
  const L = t(meta.lang)
  const out = [`# ${L.docTitle(meta.title)}`, '', ...handoffNote(meta, true).split('\n').map(l => '> ' + l), '']
  const defs: string[] = [] // 图片数据放在文件末尾，正文里只是 ![图片 1][img-1]，读起来不乱
  for (const x of toExchanges(items)) {
    if (x.user.length) {
      out.push('---', '', `### 👤 ${L.user}`, '')
      for (const p of x.user) {
        if (p.img && withImages) {
          const id = `img-${defs.length + 1}`
          defs.push(`[${id}]: ${p.img}`)
          out.push(`![${L.imageAlt(defs.length)}][${id}]`, '')
        } else {
          out.push(p.img ? L.image : p.text, '')
        }
      }
    }
    if (x.work.length || x.reply.length) {
      out.push(`### 🤖 ${L.claude}`, '')
      if (x.work.length) {
        const calls = x.work.filter(w => w.kind === 'call').length
        out.push('<details>', `<summary>${L.work(calls)}</summary>`, '')
        for (const w of x.work) {
          if (w.kind === 'call') out.push('```', fence(w.text), '```', '')
          else if (w.kind === 'result') out.push(`<details><summary>${L.output}</summary>`, '', '```', fence(w.text), '```', '', '</details>', '')
          else out.push(w.text, '')
        }
        out.push('</details>', '')
      }
      if (x.reply.length) out.push(x.reply.join('\n\n'), '')
    }
  }
  if (defs.length) out.push('', `<!-- ${L.imageDataNote} -->`, '', ...defs, '')
  return out.join('\n')
}

export function toText(items: Item[], meta: Meta): string {
  const L = t(meta.lang)
  const label = { user: L.user, assistant: L.claude, tool: L.toolOutput }
  const bar = '='.repeat(60)
  const out = [L.docTitle(meta.title), handoffNote(meta, false), bar, '']
  for (const turn of toTurns(items)) {
    out.push(`【${label[turn.role]}】`, turn.text, '', '-'.repeat(60), '')
  }
  return out.join('\r\n')
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

/** 轻量 Markdown → HTML：代码块、行内代码、粗体、标题、链接、列表；够看清楚就行 */
function mdLite(src: string): string {
  const parts = src.split(/```[^\n]*\n?/)
  return parts
    .map((seg, i) => {
      if (i % 2 === 1) return `<pre><code>${esc(seg.replace(/\n$/, ''))}</code></pre>`
      return esc(seg)
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
        .replace(/^#{1,6} (.*)$/gm, '<h4>$1</h4>')
        .replace(/^[-*] (.*)$/gm, '• $1')
        .replace(/\[([^\]\n]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
        .replace(/\[([^\]\n]+)\]\((?!https?:)[^)\s]+\)/g, '$1') // 指向本地文件的链接：对方电脑上没有，只留文字
        .replace(/\n/g, '<br>')
    })
    .join('')
}

/** 折叠起来的工作过程：中间说明、工具调用、工具输出 */
function workHtml(work: Item[], L: Strings): string {
  const calls = work.filter(w => w.kind === 'call').length
  const steps = work
    .map(w => {
      if (w.kind === 'call') return `<div class="call">${esc(w.text)}</div>`
      if (w.kind === 'result') return `<details class="out"><summary>${L.output}</summary><pre>${esc(w.text)}</pre></details>`
      return `<div class="note">${mdLite(w.text)}</div>`
    })
    .join('\n')
  return `<details class="work"><summary>${L.work(calls)}</summary><div class="steps">${steps}</div></details>`
}

export function toHtml(items: Item[], meta: Meta, markdown: string): string {
  const L = t(meta.lang)
  let picNo = 0
  const body = toExchanges(items)
    .map(x => {
      const parts: string[] = []
      if (x.user.length) {
        const inner = x.user
          .map(p =>
            p.img
              ? `<img class="pic" src="${p.img}" alt="${esc(L.imageAlt(++picNo))}" loading="lazy">`
              : `<div>${mdLite(p.text)}</div>`,
          )
          .join('\n')
        parts.push(`<div class="msg user"><div class="who">${L.user}</div><div class="bubble">${inner}</div></div>`)
      }
      if (x.work.length || x.reply.length) {
        parts.push(
          `<div class="msg assistant"><div class="who">${L.claude}</div>` +
            (x.work.length ? workHtml(x.work, L) : '') +
            (x.reply.length ? `<div class="bubble">${mdLite(x.reply.join('\n\n'))}</div>` : '') +
            `</div>`,
        )
      }
      return parts.join('\n')
    })
    .join('\n')
  // 嵌进 <script> 的字符串：转义 < 防止提前结束 script 标签
  const js = (s: string) => JSON.stringify(s).replace(/</g, '\\u003c')
  return `<!doctype html>
<html lang="${L.htmlLang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(L.pageTitle(meta.title))}</title>
<style>
:root{--bg:#faf9f5;--fg:#1f1e1d;--mut:#6b6a66;--user:#efece3;--line:#e3e0d6;--acc:#c96442}
@media (prefers-color-scheme:dark){:root{--bg:#1f1e1d;--fg:#ecebe6;--mut:#a3a29c;--user:#2d2c29;--line:#3a3935}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.65 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
header{position:sticky;top:0;z-index:1;background:var(--bg);border-bottom:1px solid var(--line);padding:14px 20px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
header h1{font-size:17px;margin:0;flex:1;min-width:200px}header .meta{color:var(--mut);font-size:13px;width:100%}
button{font:inherit;font-size:13px;padding:6px 12px;border-radius:8px;border:1px solid var(--line);background:var(--user);color:var(--fg);cursor:pointer}
main{max-width:820px;margin:0 auto;padding:20px}
.msg{margin:18px 0}.who{font-size:12px;color:var(--mut);margin-bottom:4px}
.user .bubble{background:var(--user);border-radius:12px;padding:10px 14px}
.assistant .who{color:var(--acc)}
pre{background:rgba(127,127,127,.12);padding:10px;border-radius:8px;overflow:auto;font-size:13px;white-space:pre-wrap;word-break:break-word}
code{font-family:ui-monospace,Consolas,monospace;font-size:.92em}
details.work{margin:2px 0 8px;color:var(--mut);font-size:13px}
details.work>summary{cursor:pointer;display:inline-block;padding:2px 10px;border:1px solid var(--line);border-radius:999px;list-style:none}
details.work>summary::-webkit-details-marker{display:none}
details.work>summary::before{content:"▸ "}details.work[open]>summary::before{content:"▾ "}
.steps{border-left:2px solid var(--line);margin:8px 0 0 6px;padding-left:12px}
.steps .call{font-family:ui-monospace,Consolas,monospace;font-size:12px;margin:8px 0 2px;word-break:break-all}
.steps .note{margin:8px 0}
details.out summary{cursor:pointer;font-size:12px}
.bubble .pic{display:block;max-width:100%;max-height:520px;border-radius:8px;border:1px solid var(--line);margin:4px 0 8px;cursor:zoom-in}
.bubble .pic.big{max-height:none;cursor:zoom-out}
.bubble>div+div{margin-top:8px}
h4{margin:10px 0 4px}a{color:var(--acc)}
</style></head><body>
<header><h1>${esc(meta.title)}</h1>
<button id="toggle">${esc(L.expandAll)}</button>
<button id="copy">${esc(L.copyForAi)}</button>
<div class="meta">${esc(handoffNote(meta, false)).replace(/\n/g, '<br>')}</div></header>
<main>
${body}
</main>
<script>
const MD=${js(markdown)}, T={expand:${js(L.expandAll)},collapse:${js(L.collapseAll)},copied:${js(L.copied)}};
document.querySelectorAll('.pic').forEach(p=>p.onclick=()=>p.classList.toggle('big'));
document.getElementById('toggle').onclick=e=>{const all=[...document.querySelectorAll('details.work')];const open=!all.every(d=>d.open);all.forEach(d=>d.open=open);e.target.textContent=open?T.collapse:T.expand};
document.getElementById('copy').onclick=async e=>{try{await navigator.clipboard.writeText(MD)}catch{const x=document.createElement('textarea');x.value=MD;document.body.appendChild(x);x.select();document.execCommand('copy');x.remove()}e.target.textContent=T.copied};
</script>
</body></html>`
}
