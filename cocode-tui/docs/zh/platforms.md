# 平台与终端兼容性

[中文](./platforms.md) · [English](../en/platforms.md)

Cocode TUI 支持 Windows、macOS 和 Linux。平台检查分为自动化模拟测试与真实终端验收，两者会分别报告。

| 环境                      | 重点行为                                                     |
| ------------------------- | ------------------------------------------------------------ |
| Windows Terminal / ConPTY | ANSI、备用缓冲区、`clip.exe`、路径与信号                     |
| Windows 旧控制台          | 不支持能力自动回退到 inline 模式                             |
| WSL                       | 使用 Linux 进程语义；可用时使用 `clip.exe` 和 `explorer.exe` |
| macOS Terminal / iTerm    | `pbcopy`、`open`、组合键差异                                 |
| Linux Wayland             | 优先 `wl-copy` 和 `xdg-open`                                 |
| Linux X11                 | 回退 `xclip` 或 `xsel`                                       |
| tmux / screen             | 关闭备用屏幕、通知和鼠标控制，避免嵌套终端控制序列冲突       |

`Shift+Enter` 无法识别时使用 `Ctrl+J` 换行；`Shift+Tab` 无法识别时使用 `Ctrl+M` 切换权限模式。外部编辑器、URL opener、剪贴板和终端通知采用 best effort；命令失败不会终止会话，URL opener 或剪贴板失败时，会在当前流程支持的情况下显示 notice。

## 能力探测

TUI 根据当前进程的环境变量探测终端能力，不把操作系统直接当作终端能力。Windows 使用 `WT_SESSION`、`ANSICON` 和 `ConEmuANSI` 判断 ANSI 支持；使用 `TMUX`、`STY` 和 `TERM` 判断复用器；使用 `WAYLAND_DISPLAY` 和 `DISPLAY` 选择 Linux 剪贴板后端；使用 `WSL_DISTRO_NAME`、`WSL_INTEROP` 或 `WSLENV` 判断 WSL。

Linux 剪贴板按以下顺序尝试：Wayland 使用 `wl-copy`，X11 使用 `xclip` 和 `xsel`，WSL 最后回退到 `clip.exe`。所有命令都通过参数数组直接启动，不经过 shell。命令未安装或执行失败时只报告不可用，当前会话继续运行。

平台工作流会在 Ubuntu、macOS 和 Windows 上使用 Node 22.19、pnpm 10.34.5 运行测试和源码检查。它验证模拟平台行为，不能替代 Windows Terminal、macOS Terminal/iTerm、Wayland/X11 或 tmux/screen 中的真实终端验收。
