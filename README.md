# 对话分享 · chat-share

把当前的 Claude 对话打包发到别人的邮箱。对方如果也用 Claude，导入后对话会出现在左边侧边栏，可以直接接着聊；用别的 AI 或者只想看看，也有对应的文件可以打开。

Send the current Claude conversation to someone by email. If they use Claude too, they import it and it shows up in their sidebar, ready to continue. If they use another AI, or just want to read it, there is a file for that as well.

> 这是一个 Claude Code 的 mod（插件），用在 **Claude 桌面 app 的 Code 标签**里。
> This is a Claude Code mod (plugin) for the **Code tab of the Claude desktop app**.

---

## 功能 · Features

| 中文 | English |
|---|---|
| 输入框上方多一个「⤴ 分享对话」按钮，点开是分享面板 | A "⤴ Share chat" button above the prompt box opens the share panel |
| 填一个或多个邮箱，点「发送」 | Add one or more email addresses and click Send |
| 连着 Gmail 连接器时，直接发出，附件自动附上 | With the Gmail connector connected, it sends right away with the attachments |
| 没连 Gmail 时，打开写好收件人、标题、正文的写信页面和放文件的文件夹，把文件拖进邮件即可 | Without it, a pre-filled compose page and the file folder open; drag the files into the email |
| 记住发过的邮箱，下次点一下就能加 | Remembers addresses you sent to, so you can add them with one click |
| 中文 / English 界面切换；英文模式下邮件和导出文件也是英文 | Chinese / English switch; in English the email and the exported files are in English too |
| 发送后可以把本地存档放进回收站 | After sending, you can move the local copy to the Recycle Bin |
| 收到 `.claudeshare` 时提醒「📥 收到新对话」 | A "📥 New conversation" reminder when a `.claudeshare` arrives |
| 「导入并打开」：导入后自动重启 Claude，直接打开这段对话，标题和历史都完整 | "Import and open": imports, restarts Claude and opens the conversation with its title and full history |
| 把文件拖进 Code 会话，不重启也能马上接着聊 | Drag the file into a Code session to continue right away without restarting |
| 可选：Windows 上双击 `.claudeshare` 打开（一键设置） | Optional: double-click `.claudeshare` files on Windows (one-click setup) |

### 每次会生成 5 个文件 · Five files per share

| 文件 File | 中文 | English |
|---|---|---|
| `xxx.claudeshare` | 对方也用 Claude：用本 mod 导入，原样接着聊 | For Claude users: import with this mod and keep chatting |
| `xxx.ai.md` | 对方用别的 AI（ChatGPT、Codex、Cursor、Gemini 等）：把文件发给它，说“读这个文件，接着这段对话继续” | For another AI (ChatGPT, Codex, Cursor, Gemini…): give it the file and say "Read this file and continue this conversation" |
| `xxx.html` | 浏览器打开直接看，带图片，工作过程默认折叠 | Open in a browser to read; includes images, work steps folded |
| `xxx.md` | 带图片的 Markdown，用 Typora、Obsidian、VS Code 打开 | Markdown with images, for Typora, Obsidian, VS Code |
| `xxx.txt` | 纯文本，任何设备都能打开 | Plain text for any device |

---

## 安装 · Install

需要 Claude 桌面 app（用 Code 标签）或 Claude Code。不需要 GitHub 账号。
You need the Claude desktop app (its Code tab) or Claude Code. No GitHub account required.

**在 Claude 桌面 app 里 · In the Claude desktop app**

点输入框旁边的 **+** → **Plugins** → **Add marketplace**，填 `hsniko0522/claude-chat-share` → 然后 **Add plugin**，选 `chat-share`。

Click **+** next to the prompt box → **Plugins** → **Add marketplace**, enter `hsniko0522/claude-chat-share` → then **Add plugin** and pick `chat-share`.

**在 Claude Code 终端里 · In a Claude Code terminal session**

```
/plugin install chat-share --marketplace hsniko0522/claude-chat-share
```

接着按提示输入 `y` 添加插件源，再选安装范围（选 user，所有项目都能用）。
Then type `y` to add the marketplace, and choose a scope (user makes it available in every project).

**在命令行里 · From a shell**

```powershell
claude plugin install chat-share --marketplace hsniko0522/claude-chat-share
```

装好后新开一个会话，或者在输入框输入 `/reload-plugins`，输入框上方就会出现「⤴ 分享对话」。
After installing, start a new session or type `/reload-plugins`; the "⤴ Share chat" button appears above the prompt box.

---

## 使用 · How to use

### 发送 · Send

1. 点输入框上方的「⤴ 分享对话」（或输入 `/share-chat`）。
   Click "⤴ Share chat" above the prompt box (or type `/share-chat`).
2. 右上角可以切换 **中文 / English**，切换后邮件和文件也用这种语言。
   Use the **中文 / English** switch at the top right; the email and files follow it.
3. 在「收件人」里填邮箱，回车或点「＋ 添加」。
   Enter an email under Recipients and press Enter or click "＋ Add".
4. 点「发送」。
   Click Send.
   - 连着 Gmail 连接器：直接发出。 With the Gmail connector: it sends right away.
   - 没连：会打开 Gmail 写信页面和放文件的文件夹，**把选中的文件拖进邮件再发送**。下面还有 Outlook 网页版和电脑邮件程序可选。
     Without it: Gmail compose and the file folder open. **Drag the selected files into the email, then send.** Outlook on the web and your desktop mail app are offered as alternatives.
5. 发完可以点「删除本地存档」，文件夹会放进回收站（不是永久删除）。
   Afterwards you can click "Delete local copy"; the folder goes to the Recycle Bin (not deleted for good).

本地存档在 `下载\Claude-Chat-Share\` 里。 Local copies are kept in `Downloads\Claude-Chat-Share\`.

### 接收 · Receive

**推荐：导入并打开（标题和历史都完整，不用任何设置）**
**Recommended: Import and open (full title and history, no setup)**

1. 下载邮件里的 `.claudeshare` 附件。 Download the `.claudeshare` attachment from the email.
2. 在 Claude 桌面 app 里，输入框上方会出现 **「📥 收到新对话」**，点它。 In the Claude desktop app, click **"📥 New conversation"** above the prompt box.
3. 在收到的文件旁边点 **「导入并打开」**，再点 **「导入并重启打开」**。 Click **"Import and open"** next to the file, then **"Import and restart"**.

Claude 会自动关掉再打开，直接跳到这段对话：它在左边侧边栏里，标题和完整的聊天记录都在，可以接着聊。

Claude closes and reopens on its own and jumps straight to the conversation: it is in the sidebar with its title and full chat history, ready to continue.

> 重启会中断 Claude 里正在进行的任务，所以会先问你一次。不想马上重启就选「只导入，稍后自己重启」，下次打开 Claude 时它就在侧边栏里。
> Restarting stops anything Claude is running, so it asks first. Choose "Import only, I'll restart later" to skip the restart; it will be in the sidebar the next time you open Claude.

**不想重启、只想马上问一句：拖进 Code 会话 · No restart, just a quick question: drag into a Code session**

在 Claude 桌面 app 的 **Code 标签**新开一个会话，把 `.claudeshare` 拖进输入框，打一句话发送。Claude 会读完整段对话当场回答（Mac 也能用）。这种方式看不到以前的聊天气泡，会话标题也是自动起的；完整对话同时已在后台导入，输入框上方的 **「↻ 打开完整对话」** 可以随时重启并打开它。

Start a new session in the **Code tab**, drag the `.claudeshare` into the prompt box, type something and send. Claude reads the whole conversation and answers right there (works on Mac too). You won't see the earlier messages and the session gets an automatic title; the full conversation is imported in the background, and **"↻ Open full conversation"** above the prompt box restarts Claude and opens it whenever you like.

> 要用 **Code 标签**。普通 Chat 里 mod 不起作用，Claude 读不了这种文件。
> Use the **Code tab**. The mod does not run in the regular Chat, where Claude cannot read this file.

**可选：双击打开（Windows） · Optional: double-click (Windows)**

在分享面板「导入」卡片里点一次 **「一键设置双击打开」**，弹出的窗口提示“设置好了”就完成。之后在资源管理器里双击 `.claudeshare`，效果和「导入并打开」一样。点「取消双击打开」可以恢复原来的打开方式。

Click **"One-click setup"** once in the Import card of the share panel; when the window says "All set", you are done. After that, double-clicking a `.claudeshare` in File Explorer does the same as "Import and open". "Turn off double-click" restores how the file opened before.

> 按钮背后做的事：交给资源管理器运行 mod 自带的 `bin\setup-double-click.cmd`，和你亲手双击它一样（Claude app 里运行的程序改不到 Windows 真正的文件关联，所以要经过资源管理器）。`.cmd` 只让 PowerShell 对这一次运行放行，不改系统设置。不好用时，在「打开脚本文件夹」里双击 `diagnose-double-click.cmd` 生成诊断报告。更新 mod 后如果双击失效，再点一次「一键设置」。「导入并打开」的重启也是同样经过资源管理器完成的。
> What the button does: it has File Explorer run the mod's own `bin\setup-double-click.cmd`, the same as double-clicking it yourself (programs run inside the Claude app cannot change Windows' real file associations, so it goes through File Explorer). The `.cmd` only lets PowerShell run that one script and changes no system setting. If it misbehaves, double-click `diagnose-double-click.cmd` in "Open script folder" for a report. If double-clicking stops working after a mod update, click "One-click setup" again. The restart in "Import and open" also goes through File Explorer.

---

## 注意 · Notes

- **隐私**：导出的是完整对话，包括 Claude 读过的文件内容、命令输出和本机路径。发之前确认里面没有密钥、密码或不想给人看的东西。
  **Privacy**: the export is the whole conversation, including file contents Claude read, command output and local paths. Make sure it holds no keys, passwords or anything you would not want to share.
- **只翻译固定文字**：英文模式下，界面、邮件和文件里的标签是英文，对话内容本身保持原样。
  **Labels only**: in English mode the interface, email and file labels are in English; the conversation itself is not translated.
- **用到了 Claude 的内部格式**：导入依赖 Claude Code 存会话的方式，这不是公开接口，Claude 更新后可能需要修。
  **Relies on internal formats**: importing depends on how Claude Code stores sessions. That is not a public interface and may need fixing after Claude updates.
- **测试环境**：主要在 Windows 上测试。macOS 上导出发送已经有人用过；在 Mac 上导入、删除存档还没测过。双击打开目前只支持 Windows。
  **Tested on**: mainly Windows. Exporting and sending on macOS has been used; importing and deleting local copies on a Mac are untested. Double-click opening is Windows only for now.
- **接着聊时的长度**：方式一把对话交给 Claude 时，太长的对话（约 15 万字符以上）只交最近的部分，前面会注明省略了多少。完整的原对话仍会导入到侧边栏。
  **Length when continuing**: in Way 1, very long conversations (over about 150,000 characters) are handed over with only the most recent part, noting how much was left out. The full original is still imported to the sidebar.
- **附件大小**：Gmail 单封邮件上限 25 MB。放不下时按“导入包 → ai.md → html → md → txt”的顺序优先附上，其余在正文里注明。
  **Attachment size**: Gmail allows 25 MB per email. If everything does not fit, files are attached in the order package → ai.md → html → md → txt, and the rest are named in the email body.

---

## 更新与卸载 · Update and uninstall

```powershell
claude plugin update chat-share@claude-chat-share
```

```powershell
claude plugin uninstall chat-share@claude-chat-share
```

更新后输入 `/reload-plugins` 或新开会话。 After updating, type `/reload-plugins` or start a new session.

---

## 许可证 · License

MIT，见 [LICENSE](LICENSE)。 MIT; see [LICENSE](LICENSE).
