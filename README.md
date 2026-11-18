# ✉️ 信笺 · 初晴 | Gemini 向量长期记忆库（RAG）使用指南

这套方案包含两个互相打通的文件（共用同一个 GitHub 私有仓库记忆库）：

1. **[index.html](./index.html)**：**独立初晴记忆档案馆 Web App（支持手机全屏 PWA）**
   - 适合平时用 **官方 Gemini App** 聊天时，点一下「📋 一键读剪贴板」存记忆、或者搜出记忆点「📋 一键复制记忆唤醒包」粘回官方 App。
   - 也可以在里面可视化管理所有分支、自定义 `#标签池`、手动修改/删除记忆切片，或者直接在信笺界面里和 Gemini 聊天。
2. **[gemini-official-sync.user.js](./gemini-official-sync.user.js)**：**挂在 `gemini.google.com` 官网上的免复制伴侣脚本**
   - 当你在手机 Gemini App 聊完后，谷歌会自动把聊天记录同步到 `gemini.google.com` 网页版。
   - 打开 `gemini.google.com`，点击右下角的 **「✉️ 初晴记忆库」** 悬浮胶囊，点 **「⚡ 一键抓对话并归档 GitHub」**，完全不用手动复制粘贴就能自动总结 + 算向量 + 存入 GitHub！

---

## 第一步：准备两个免费密钥（只需配置一次）

### 1. 获取免费 Gemini API Key（用来算 `text-embedding-004` 向量和自动总结）
1. 打开 [Google AI Studio](https://aistudio.google.com/app/apikey) 并登录谷歌账号。
2. 点击 **Create API key**，复制生成的那串 `AIzaSy...` 开头的密钥。
   *(注：Google 的向量接口 `text-embedding-004` 是完全免费的，每分钟可调用上千次。)*

### 2. 创建 GitHub 私有仓库与 Token (PAT)
1. 登录 GitHub，右上角 `+` -> **New repository**：
   - 仓库名随便起，比如 `gemini-memory`（记住你的 `用户名/仓库名`，例如 `alice/gemini-memory`）。
   - 选 **Private（私有）**，勾选 **Add a README file**，点击创建。
2. 生成 Token（让网页能读写这个仓库里的 JSON 文件）：
   - 打开 GitHub Settings -> 拉到最底下点 **Developer settings** -> **Personal access tokens** -> **Tokens (classic)**。
   - 点击 **Generate new token (classic)**，Note 随便填，Expiration 选 `No expiration`（永不过期），下方勾选 **`repo`**（第一个大勾），拉到底部点击生成。
   - 复制生成的 `ghp_...` 开头的字符串。

---

## 第二步：如何使用 `index.html`（电脑直接打开 / 部署到手机桌面）

### 方式 A：电脑或手机本地直接用
直接双击打开 `index.html`，点击右上角 **⚙️ 设置按钮**，填入刚才的：
- `Gemini API Key`
- `GitHub PAT`
- `GitHub 私有仓库名`（格式：`你的用户名/仓库名`）
点击 **「🔌 测试连接并初始化目录」**，它会自动在你的 GitHub 仓库里建好 `global_profile.json` 和 `branches/main.json`！

### 方式 B：挂到 GitHub Pages 变成手机全屏 App（推荐）
1. 把这个 `index.html` 上传到你随便一个 GitHub 仓库里。
2. 在仓库的 **Settings -> Pages** 里，Branch 选 `main` 并保存，等待 1 分钟就会得到一个专属网址（如 `https://你的名字.github.io/仓库名/`）。
3. 用手机浏览器（iOS 用 Safari，安卓用 Chrome/Edge）打开这个网址，点击浏览器的 **「添加到主屏幕」**，它就会像原生 App 一样全屏运行在你的手机桌面上！（你的 Key 只存在你手机本地浏览器里，别人就算打开你的网址也看不到你的任何数据。）

---

## 第三步：如何安装官网免复制脚本 `gemini-official-sync.user.js`

如果你想实现**「在官方 App 聊完 $\rightarrow$ 打开官网一键导进去，连复制都不用」**：

1. 在浏览器安装 **篡改猴 (Tampermonkey)** 扩展（电脑 Chrome/Edge，或手机上的狐猴浏览器、Via、Kiwi、Safari Stay 均支持）。
2. 打开篡改猴面板 $\rightarrow$ **添加新脚本**，把 [gemini-official-sync.user.js](./gemini-official-sync.user.js) 里的代码全选复制进去，按 `Ctrl + S` 保存。
3. 打开 [https://gemini.google.com](https://gemini.google.com)，页面右下角会出现一个初晴风的 **「✉️ 初晴记忆库 [main]」** 按钮：
   - 第一次点开它，展开最底下的 `⚙️ 配置`，填上同样的 `Gemini API Key`、`GitHub PAT` 和 `仓库名` 保存。
   - 以后聊完天，点一下 **「⚡ 一键抓对话并归档 GitHub」**，它就会自动抓取当前网页上的对话、总结成 100 字、打好 `#标签`、算好向量直接存进 GitHub！
   - 开新对话时，点一下 **「🔮 唤醒并填入」**，它就会把最相关的 5 条记忆直接塞进官网的输入框里！
