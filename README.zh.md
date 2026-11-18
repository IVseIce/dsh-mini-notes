# dsh-mini-notes（极简便签）

[English](README.md) | 中文

DSH Web 界面里的一个小记事本：会话标题栏右上角一个按钮，面板从按钮下方展开，随手记一笔。像 Windows 记事本 —— 纯文本、无格式、无菜单、自动保存。

纯客户端插件，无依赖、无构建、无网络请求、不注册工具。

<img src="icon.svg" width="64" alt="">

## 安装

```bash
dsh plugin --profile web add github:IVseIce/dsh-mini-notes
```

pnpm 支持的其他形式同样可用：

```bash
# 锁定提交（建议先看过第三方代码再装）
dsh plugin --profile web add github:IVseIce/dsh-mini-notes#<commit-sha>

# 完整 git 地址
dsh plugin --profile web add git+https://github.com/IVseIce/dsh-mini-notes.git

# 本地目录，用于开发
dsh plugin --profile web add link:/absolute/path/to/dsh-mini-notes
```

也可以直接在 DSH Web 的**插件管理**页面安装本目录。

重启（或等 HMR 生效）后刷新页面，便签按钮会出现在会话标题栏右侧、和其他工具按钮同一排。

## 用法

### 面板
- **展开 / 收起** —— 点标题栏右侧的便签图标；再点一次收起。
- **位置** —— 首次贴着按钮下方出现；之后记住你拖到的地方和拉到的大小。
- **拖动** —— 按住顶部标签栏的空白处。
- **拉伸** —— 拖右下角的小三角（最小 280×220，不会超出窗口）。
- **钉住**（图钉）—— 钉住时点别处不收起，方便边看对话边记；未钉住时点别处立即收起，`Esc` 也能收起。

### 多页
- 顶部是浏览器式标签栏，标签标题取该页第一行文字。
- `+` 在**最后一个标签后面**（同 Windows 记事本）。标签多了会均分收窄（最窄 46px，标题省略），窄到放不下才横向滚动。
- **拖动标签可以排序** —— 左右拖到新位置松手；只点不拖仍然是切换页。
- 标签上的 × 是「关闭这一页」，它会**进回收站**，而不是销毁。

### 缩放
工具区的 `−` / 百分比 / `+`：整体缩放正文（70%–250%），点百分比回到 100%。标签栏、底栏等窗口 chrome 不跟着缩放。缩放值会被记住。

### 回收站
工具区的垃圾桶图标。
- 点一行 = **恢复**该页；行尾 × = 彻底删除（确认框在面板内，不用浏览器弹窗）；底栏「清空回收站」= 一次删光。
- 全部标签关掉后窗口不会消失，而是停在回收站，避免「关了就没了」的错觉。
- 最多保留 2000 条，超出丢弃最旧的。

### 存储
停手 0.3 秒自动保存到浏览器的 `localStorage`（`dsh-mini-notes.v2`），收起面板时也会立即保存。刷新、重开页面都还在。**数据不离开你的浏览器** —— 无账号、无同步、无请求。

## 实现

- 纯客户端。Host 半边（`index.js`）是一个空的 `apply`。
- 一个模块级 store（`state` 对象 + 一个 `Set` 监听器）配 `useSyncExternalStore`；写入防抖 300ms，收起面板与 `pagehide` 时立即落盘。
- 页面、回收站、视图、缩放全在**同一个 JSON 对象**里，一次写入落全。
- 两个槽位：`conversation.session.header.utilities`（按钮）、`shell.overlay`（面板）。收起时面板组件返回 `null`，不产生 DOM 与渲染；按钮只订阅一个布尔值。
- 样式只用主题 token（`--dsw-alias-*`、`--dsw-radius-*`、`--dsw-elevation-*`），跟随亮/暗色。

### 已知限制

- 纯文本：没有图片，也没有加粗、列表、标题等富文本格式。

## 文件

| 文件 | 作用 |
|---|---|
| `package.json` | 包清单；通过 `dsh.bundle.patch` 和 `dsh.client` 声明双半 |
| `cordis.patch.yml` | 插入一行 Host 插件（唯一作用是把包挂进组合） |
| `index.js` | Host 半边：空实现 |
| `client.js` | 浏览器半边：store、按钮、面板、样式、槽位注册 |
| `locale/{zh,en}.json` | 插件管理页的标题与描述 |
| `icon.svg` | 插件图标 |
| `.smoke/harness.mjs.cjs` | 离线行为自检（假 DOM + 假 React，不是真浏览器） |

## 开发

没有构建步骤 —— 改完 `client.js` 刷新即可。

跑离线自检：

```bash
node .smoke/harness.mjs.cjs client.js
```

它会用假的 DOM、React 和存储驱动真实客户端代码，覆盖展开、输入、回车、标签、拖拽排序、缩放、回收站和重载。这是行为检查，不是浏览器测试。

## 许可证

MIT
