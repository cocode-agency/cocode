# Platform and terminal compatibility

[中文](../zh/platforms.md) · [English](./platforms.md)

Cocode TUI supports Windows, macOS, and Linux. Automated platform simulations and real-terminal acceptance are reported separately.

| Environment               | Important behavior                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| Windows Terminal / ConPTY | ANSI, alternate buffer, `clip.exe`, paths, and signals                                             |
| Legacy Windows console    | Unsupported capabilities fall back to inline mode                                                  |
| WSL                       | Linux process semantics; `clip.exe` and `explorer.exe` are used when available                     |
| macOS Terminal / iTerm    | `pbcopy`, `open`, and key-combination differences                                                  |
| Linux Wayland             | Prefer `wl-copy` and `xdg-open`                                                                    |
| Linux X11                 | Fall back to `xclip` or `xsel`                                                                     |
| tmux / screen             | Alternate screen, notifications, and mouse controls are disabled to avoid nested terminal glitches |

Use `Ctrl+J` for a newline when `Shift+Enter` is unavailable. Use `Ctrl+M` to change permission mode when `Shift+Tab` is unavailable. Editor, URL opener, clipboard, and terminal notifications are best effort; failures do not terminate the session, and URL opener or clipboard failures produce a notice when the current flow can display one.

## Capability detection

The TUI detects capabilities from the current process environment rather than assuming that the host operating system is the terminal. `WT_SESSION`, `ANSICON`, and `ConEmuANSI` enable ANSI support on Windows; `TMUX`, `STY`, and `TERM` identify multiplexers; `WAYLAND_DISPLAY` and `DISPLAY` select the Linux clipboard backend; and `WSL_DISTRO_NAME`, `WSL_INTEROP`, or `WSLENV` identify WSL.

On Linux, clipboard commands are tried in this order: `wl-copy` for Wayland, `xclip` and `xsel` for X11, and `clip.exe` as a WSL fallback. Commands are started directly with argument arrays, never through a shell. If no command is installed or a command fails, copy is reported as unavailable and the session continues.

The platform test workflow covers Ubuntu, macOS, and Windows with Node 22.19 and pnpm 10.34.5. It validates simulated platform behavior and source checks; it does not replace acceptance in a real Windows Terminal, macOS Terminal/iTerm, Wayland/X11 session, or tmux/screen window.
