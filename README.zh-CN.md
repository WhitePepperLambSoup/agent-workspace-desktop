[English](README.md) | [简体中文](README.zh-CN.md)

# Agent Workspace for Windows

运行在 Windows 上的桌面 AI 智能体。打开一个文件夹，说明要做的事，智能体会规划并用真实的工具完成：文件、Git、在暂存沙箱里运行命令、终端、网页、文档和你自己的知识库。改动文件或访问网络之前会先问你。可以用你选的云端模型，也可以用在本机运行的模型；所有对话、改动和审批记录都保存在这台电脑上。

安卓版（[agent-workspace-android](https://github.com/WhitePepperLambSoup/agent-workspace-android)）与它共用同一套 Python 核心；装了 2.5.0 及以上版本的手机可以连接这台电脑。

> 状态：公开预览版（`0.1.0-alpha`），支持 Windows 10 和 11（x64）。安装包暂未做代码签名。

<p align="center">
  <img src="docs/screenshots/chat-tools-zh.png" width="820" alt="用工具读取文件后回答的任务，以及显示用量和费用的上下文面板">
</p>

## 下载

从[最新版本](https://github.com/WhitePepperLambSoup/agent-workspace-desktop/releases/latest)下载 `AgentWorkspace-Setup-<版本号>.exe`，并与版本说明里的 SHA-256 核对。未签名的安装包会被 Windows SmartScreen 拦下：点“更多信息”，再点“仍要运行”。安装后可以从发布页自动更新（设置 → 关于与更新），只在你点检查时才会检查。

## 功能

### 对话与任务

- **多步骤任务**：智能体自己规划、调用工具，每一步实时可见：流式回复、思考过程，以及每次工具调用的参数、结果和状态。
- **审批**：四种自主级别。“每次询问”每一步都要你同意；“工作区”允许读取和在打开的文件夹内带检查点的写入，其余要问；“YOLO”在沙箱内的操作不再询问；“完全访问”去掉日常审批，需要你明确选择。
- **任务中途插话**：任务执行时输入的消息会在下一步加入当前任务；其他消息进入排队，重启后仍在。
- **同时进行多个对话**：一个对话在后台继续运行，你可以在另一个对话里工作。
- **分叉与对比**：在新对话里改写某条消息、从某条回复分叉，或让另一个模型回答同一个问题，两个回答连同用时和 Token 放在一起对比。
- **花费上限**：给单个任务设费用（按公开标价）和 Token 上限；发送前，输入框会按最近的任务估算这条大约要花多少。达到上限或服务商出错时，任务停下并在对话里说明原因。
- **智能体运行**：把长任务拆成计划和若干子智能体，各自有进度、审批和结果。

### 工作区与编程

- 读取、搜索、写入和修补文件；每次写入都保留检查点，中断的改动会回滚。移动和删除前会核对文件内容。
- **暂存沙箱**：命令在文件夹的私有副本里运行，结果作为一组改动交给你逐项审阅、应用。
- Git 状态、差异、追溯、日志和只提交暂存区；终端；带日志的后台任务；LSP 诊断和代码地图。
- 智能体会遵循工作区里的设置：`AGENTS.md`、`.agent/skills` 里的技能、`.agent/mcp.toml` 里的 MCP 服务和 `.agent/tools` 里的自定义工具，第一次运行前都需要你批准。
- 托管浏览器，用来打开需要脚本渲染的网页，截图会显示在对话里。

### 知识库

在“知识库”页面添加说明书、合同、笔记、电子书（PDF、Word、Excel、EPUB、网页、Markdown 和文本），也可以在对话里让智能体添加。文字会被切成段落并在本机建立索引，所有工作区的对话都能查阅，回答会注明出自哪份文档、第几页。扫描版 PDF 用 Windows 自带的文字识别读取。文档可以分到不同的知识库（如“工作”“学习”），每个对话在右侧上下文面板里选用其中几个。检索按关键词进行，内置同义词并可自定义，不消耗额度，离线可用。

<p align="center">
  <img src="docs/screenshots/knowledge-zh.png" width="410" alt="知识库页面，已有三份文档">
  <img src="docs/screenshots/knowledge-answer-zh.png" width="410" alt="注明出处文档的回答">
</p>

### 研究与记忆

- 研究模式把智能体读过的网页保存为来源，并检查每条引用都能在原文中逐字找到。
- 每个工作区有长期记忆，只在智能体主动检索时使用；你可以查看、修改和删除。

### 模型

- OpenAI 兼容接口（OpenAI、DeepSeek、通义千问、Kimi、智谱 GLM、xAI、OpenRouter 等）、Anthropic、Gemini 和 Ollama；内置在本机运行 llama.cpp、LM Studio、vLLM 的预设。
- 对按提示前缀缓存计费的服务商，请求保持前缀不变，重复的上下文按缓存价格计费。
- API Key 保存在 Windows 凭据管理器中，不写入文件或数据库。数据发往云端服务商之前，按当前自主级别的外发规则处理。

### 手机连接

需要安卓版 [agent-workspace-android](https://github.com/WhitePepperLambSoup/agent-workspace-android/releases) **2.5.0 及以上**；更早的版本连不上这一版。

在 设置 → 手机连接 中打开，用安卓版扫描出现的二维码即可。手机和电脑需要在同一个网络里，或者都装了 Tailscale。连接走 HTTPS，二维码里带着这台电脑的证书指纹。如果 Windows 防火墙拦住了手机，页面会说明并提供一键允许（Windows 会请你确认）。

配对后，手机可以：

- 把任务交给这台电脑上的某个对话，并审批或停止这里正在运行的任务；
- 发送文件、照片、文字和链接，浏览并下载打开的文件夹里的文件，接收这里发过去的文件和回答；
- 把一台设备上的对话拿到另一台上接着进行；
- 接受这台电脑上智能体发来的请求（每个请求都由手机上的人决定是否接受），也可以让这台电脑完成手机任务里的一部分；
- 收到定时任务的结果，让配对的知识库互相补齐，在允许时通过网络唤醒这台电脑。

手机交来的任务使用这台电脑上的模型。每台手机有各自的权限，两边都可以解除配对。协议见 [docs/DEVICE_LINK_API.md](docs/DEVICE_LINK_API.md)。

<p align="center">
  <img src="docs/screenshots/phone-connection-zh.png" width="620" alt="手机连接设置和配对二维码">
</p>

### 界面

- 液态玻璃、纯色或 Mica 材质，浅色与深色，支持“减少动画”。
- 简体中文、繁体中文、英文和日文界面。
- 命令面板和可自定义的快捷键、`/` 命令和 `@` 引用文件、后台任务需要你时发出通知，对话可以重命名、置顶、归档、导出和导入。
- 主要界面按 WCAG 2.2 AA 检查。
- 每次关闭应用时对数据库做一次校验过的备份（保留最近十份）；日志和崩溃转储只保存在本机。

## 快速开始

1. 安装并启动 Agent Workspace。
2. 在 设置 → 服务商与运行时 中添加服务商（接口地址、模型、API Key），或选择本机模型的预设。
3. 打开一个文件夹（点顶部的按钮，或把文件夹拖进窗口）。
4. 说明要做的事。同意或拒绝智能体请求的操作；右侧上下文面板显示模型收到了什么、任务花了多少。

## 从源码构建

需要 Windows、Python 3.12 和 [uv](https://docs.astral.sh/uv/)，以及 Node.js 22。

```powershell
uv sync --frozen --python 3.12.10 --all-groups
cd desktop
npm ci
npm run dev
```

构建并校验 Windows 发布包（Electron 应用加冻结的 Python sidecar）：

```powershell
uv run --python 3.12.10 python scripts/build_electron_release.py
uv run --python 3.12.10 python scripts/build_electron_release.py --verify dist/electron-release/AgentWorkspace
cd desktop
node node_modules/electron-builder/cli.js --win nsis --x64 --prepackaged ../dist/electron-release/AgentWorkspace
```

发布目录包含 `AgentWorkspace.exe`、`resources/sidecar/` 下的 sidecar、CycloneDX SBOM、`SHA256SUMS.txt` 和发布清单。运行 electron-builder 前设置 `CSC_LINK` 和 `CSC_KEY_PASSWORD` 即可为安装包签名。

同一套核心也可以在命令行使用：`uv run agent-workspace --help`。备份、对话归档、日志、更新和签名见 [docs/OPERATIONS.md](docs/OPERATIONS.md)。

## 目录结构

```
src/agent_workspace/   Python 核心：智能体循环、服务商、工具、存储、知识库，
                       以及桌面应用连接的界面网关（ui_gateway/）
desktop/               Electron 主进程、preload 和 React 渲染进程
docs/                  架构、沙箱、后台任务和手机连接协议
scripts/               发布构建与校验、架构检查
```

桌面应用是 Electron 外壳加 React 渲染进程；一个受监管的 Python sidecar 运行智能体，两者之间用有界的 NDJSON 协议通信。详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 隐私与安全

- 对话、知识库、记忆和备份是 `%LOCALAPPDATA%\AgentWorkspace` 下的明文 SQLite 数据；除了你发给模型服务商的请求，什么都不会上传。
- 工具参数在审批前校验，副作用在执行前记录；网页、文档和工具输出以“不受信任的数据”交给模型。
- 暂存沙箱和 Windows 作业对象限制命令对文件夹的影响和资源用量，但不限制它们访问其他文件或网络。在不信任的仓库里请使用“每次询问”或“工作区”模式。

完整的信任边界见 [SECURITY.md](SECURITY.md)。

## 已知限制

- 仅支持 Windows；安装包暂未签名。
- 沙箱是审阅边界，不是操作系统级的安全隔离。
- 扫描版 PDF 需要 Windows 装有对应语言的文字识别（在 Windows 设置里添加该语言时安装）。
- 智能体不会操作电脑上的其他应用。

## 许可证

Apache-2.0。第三方组件保留各自的许可证，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
