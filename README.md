<p align="center">
  <img src="docs/screenshots/vespi-home.png" alt="VesPi 首页" width="880">
</p>

<h1 align="center">VesPi</h1>

<p align="center">
  <b>Windows 上的 Oh My Pi（OMP）/ Pi 桌面客户端</b><br>
  一把会自我磨利的桌面智能快刀
</p>

<p align="center">
  <a href="#中文">中文</a> ·
  <a href="#english">English</a> ·
  <a href="https://github.com/esseener/VesPi/releases/latest">下载 1.0.3</a>
</p>

<p align="center">
  <img alt="release" src="https://img.shields.io/github/v/release/esseener/VesPi">
  <img alt="platform" src="https://img.shields.io/badge/platform-Windows%20x64-0078D6">
  <img alt="engine" src="https://img.shields.io/badge/engine-Oh%20My%20Pi%20%7C%20OMP%20%7C%20Pi-111">
  <img alt="license" src="https://img.shields.io/badge/license-Apache--2.0-blue">
</p>

搜索词 / Search: **VesPi** · **Pi** · **Pi Desktop** · **Oh My Pi** · **OMP** · **oh-my-pi** · **coding agent** · **桌面 Agent** · **AI 编程助手**

---

# 中文

VesPi 把 **[Oh My Pi（OMP）](https://github.com/can1357/oh-my-pi)** 和 **[Pi](https://pi.dev)** 收进一个 Windows 窗口：对话、工具卡片、审批、Diff、文件树、终端、模型和内核更新。

默认跑仓库/安装包里的私有 `omp.exe`（`--profile vespi --mode rpc-ui`）。不需要你自己配 PATH 上的 `omp` 或 `pi`。

当前版本 **[1.0.3](https://github.com/esseener/VesPi/releases/tag/v1.0.3)**。

## 界面（本机 VesPi 1.0.1 实拍）

| 首页 | 对话 / Agent |
|---|---|
| <img src="docs/screenshots/vespi-home.png" alt="VesPi 首页"> | <img src="docs/screenshots/vespi-chat.png" alt="VesPi 对话"> |

| 设置 |
|---|
| <img src="docs/screenshots/vespi-settings.png" alt="VesPi 设置"> |

截图来自当前 Windows 安装包，不是 Pi Desktop。界面默认中文，设置里可切 English。

## Agent 能做什么

VesPi **不另写一套 Agent 循环**。内核仍是 OMP / Pi：读改文件、跑命令、调工具、流式思考。壳负责监督。

- 流式回答、Thinking、工具卡片、权限审批
- 侧栏会话（按项目分组）、标签、归档、行内重命名
- 删除会话：**确认条贴在该会话上**，文件进 **Windows 回收站**（关于页可「打开回收站」）
- 输出过程中再打字：先选 **介入引导（steer）** 或 **排队等候（follow_up）**，都是 OMP 自带队列，**都不会掐断当前这句话**
- 每个活动会话一个内核进程，切走不会杀掉上一轮
- 任务中心、后台活动点、桌面通知
- Diff：显式 提交 → 推送 → PR
- 文件树、CodeMirror 编辑器、图片/HTML 预览、ANSI 终端
- 权限模式 + 规则；工作区信任门闩
- 插件 / 技能浏览、诊断、主题
- 双通道更新：界面看本仓库；**更新内核** 从 `can1357/oh-my-pi` 下载，带进度和成功/失败提示

## 1.0.3

设置里的主题/语言等下拉改为跟随 Dark 主题，不再弹出系统白底菜单。

## 1.0.2

首页顶栏「下载 / 更新内核」在启动页也能点，不再被窗口拖拽层挡住。1.0.0 / 1.0.1 打开应用会提示有更新。

## 1.0.1 这一版

- 会话删除贴行确认 + 回收站
- 顶栏标签：点设置/关于/速记/拓展，显示对应名字
- 内核更新：检查 → 下载百分比 → 替换 → 重启会话 → 绿/红结果
- 输出中补充：介入引导 = 等工具跑完、下次叫模型前插入（和 OMP 终端打字一样）；排队等候 = 整轮空闲后再发

## 下载（Windows x64）

[Releases](https://github.com/esseener/VesPi/releases/latest)

- 安装包：`VesPi-Setup-1.0.3-win-x64.exe`（推荐，装到 `%LOCALAPPDATA%\Programs\VesPi\`）
- 便携包：`VesPi-1.0.3-win-x64.exe`

未签名时 SmartScreen 选「更多信息 → 仍要运行」。

## 内核：Oh My Pi 与 Pi

| | OMP（默认） | Pi |
|---|---|---|
| 程序 | 安装包内 `omp.exe` | 可选外部 `pi` |
| 参数 | `--profile vespi --mode rpc-ui` | 标准 Pi RPC |
| 会话 | `~/.omp/profiles/vespi/agent/sessions` | `~/.pi/agent/sessions` |

打开某条会话时，启动的是**写下这条会话的引擎**。

## 开发

```bash
cd desktop
npm install
npm run dev
npm run package:win:nsis
```

公开仓库：[esseener/VesPi](https://github.com/esseener/VesPi)。不要把产品更新推到 `FaqFirebase/pi-desktop`。

---

# English

**VesPi** is the Windows desktop GUI for **[Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi)** and the **[Pi](https://pi.dev)** coding agent: chat, tool cards, approvals, Diff, file tree, terminal, models, and kernel updates in one window.

Shipped builds run a private `omp.exe` (`--profile vespi --mode rpc-ui`). You do not need a global `omp` / `pi` on PATH.

Current release: **[1.0.1](https://github.com/esseener/VesPi/releases/tag/v1.0.1)**.

Based on [Pi Desktop](https://github.com/FaqFirebase/pi-desktop) (Apache-2.0). VesPi is the shell; OMP/Pi stay the agent.

## Agent surface

Streaming replies, thinking, tool cards, per-session processes, Mission Control, Diff Commit → Push → PR, editor, terminal, permission rules, package/skill browser, dual updates (UI from this repo, kernel from `can1357/oh-my-pi` with a progress bar).

While the model is writing, extra text is not sent immediately. **Steer** and **follow_up** are native OMP queues and **do not abort** the current reply. Steer injects after current tools, before the next model call (same idea as typing in the OMP TUI). Follow-up waits until the agent is idle.

## Download

- Installer: `VesPi-Setup-1.0.3-win-x64.exe`
- Portable: `VesPi-1.0.3-win-x64.exe`

## License

VesPi changes: Apache-2.0. Keep Pi Desktop NOTICE. OMP remains upstream MIT.
