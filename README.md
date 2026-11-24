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
| 导入别人发来的 `.claudeshare` 文件 | Import a `.claudeshare` file someone sent you |

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

这是**私有仓库**，安装前要先做两件事。
This is a **private repository**, so two things come first.

### 1. 接受邀请 · Accept the invitation

请仓库作者在 GitHub 上把你加为协作者（Settings → Collaborators），然后在邮件或 GitHub 通知里接受邀请。

Ask the repository owner to add you as a collaborator on GitHub (Settings → Collaborators), then accept the invitation from the email or your GitHub notifications.

### 2. 让电脑能访问 GitHub · Let your computer sign in to GitHub

安装时不会弹出登录框，所以要先在电脑上登录一次 GitHub。装好 [GitHub CLI](https://cli.github.com/) 后，在终端运行：

The install never asks you to sign in, so sign in to GitHub on your computer first. Install the [GitHub CLI](https://cli.github.com/), then run in a terminal:

```powershell
gh auth login
```

```powershell
gh auth setup-git
```

### 3. 安装插件 · Install the plugin

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

1. 把邮件里的 `.claudeshare` 附件下载到 **下载** 文件夹。
   Download the `.claudeshare` attachment to your **Downloads** folder.
2. 打开分享面板，在「导入别人发来的对话」里点「导入」。也可以填文件路径，以及要放进哪个项目文件夹。
   Open the share panel and click Import under "Import a conversation sent to you". You can also enter a file path and the project folder it should go into.
3. **完全退出 Claude 再打开**（托盘图标 → 退出），左边侧边栏就会出现这段对话，点进去接着聊。
   **Fully quit Claude and reopen it** (tray icon → Quit). The conversation appears in the sidebar; open it and keep chatting.

---

## 注意 · Notes

- **隐私**：导出的是完整对话，包括 Claude 读过的文件内容、命令输出和本机路径。发之前确认里面没有密钥、密码或不想给人看的东西。
  **Privacy**: the export is the whole conversation, including file contents Claude read, command output and local paths. Make sure it holds no keys, passwords or anything you would not want to share.
- **只翻译固定文字**：英文模式下，界面、邮件和文件里的标签是英文，对话内容本身保持原样。
  **Labels only**: in English mode the interface, email and file labels are in English; the conversation itself is not translated.
- **用到了 Claude 的内部格式**：导入依赖 Claude Code 存会话的方式，这不是公开接口，Claude 更新后可能需要修。
  **Relies on internal formats**: importing depends on how Claude Code stores sessions. That is not a public interface and may need fixing after Claude updates.
- **测试环境**：目前只在 Windows 上实际测试过。macOS / Linux 的代码写了，但没测过。
  **Tested on**: Windows only so far. The macOS / Linux code paths are written but untested.
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
