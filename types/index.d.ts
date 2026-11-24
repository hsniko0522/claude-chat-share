export type Status = { kind: 'idle' | 'busy' | 'ok' | 'warn' | 'error'; text: string }

export type InboxItem = { name: string; path: string; size: number; mtimeMs: number }

/** 最近一次打包：文件在哪，以及几种写信方式的链接 */
export type LastShare = { pkg: string; gmail: string; outlook: string; mailto: string }

declare module 'claude-code' {
  interface PluginState {
    'chat-share': {
      /** 界面语言：zh / en（也存在 $.store 里，跨会话保留） */
      lang: 'zh' | 'en'
      title: string
      emails: string[]
      draft: string
      lastShare: LastShare | null
      /** 刚发送过的那次导出所在文件夹：用来“删除本地存档” */
      sentDir: string | null
      isConfirmingDelete: boolean
      status: Status
      inbox: InboxItem[]
      importPath: string
      targetDir: string
      /** 记住的邮箱（从 $.store 读出来给面板显示） */
      recent: string[]
      /** 双击打开的一次性设置：Windows 上是 win（显示设置说明），其他系统 na */
      doubleClick: 'win' | 'na'
      /** 下载文件夹里还没看过的 .claudeshare：输入框上方会多出「📥 收到新对话」 */
      newShares: InboxItem[]
    }
  }
}
