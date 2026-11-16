#!/bin/sh
cd -- "$(dirname -- "$0")" || exit 1
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(((v) => v[0] > 22 || (v[0] === 22 && v[1] >= 12))(process.versions.node.split(".").map(Number)) ? 0 : 1)' >/dev/null 2>&1; then
  printf '\n需要安装 Node.js 22.12.0 或更高版本，才能打开本机控制台。\n'
  printf 'Node.js 22.12.0 or later is required to open the local console.\n'
  printf '1. 从官方页面下载 macOS 安装包并完成安装。\n'
  printf '   Download and install the macOS installer from the official page.\n'
  printf '2. 关闭此窗口，再次双击 start.command。\n'
  printf '   Close this window, then double-click start.command again.\n'
  printf 'https://nodejs.org/en/download\n\n'
  printf '打开官方下载页？/ Open the official download page? [y/N] '
  read -r answer
  case "$answer" in y|Y|yes|YES) open 'https://nodejs.org/en/download' ;; esac
  printf '按回车关闭 / Press Enter to close... '
  read -r answer
  exit 1
fi
node scripts/launch.mjs
result=$?
if [ "$result" -ne 0 ]; then
  printf 'Press Enter to close... '
  read -r answer
fi
exit "$result"
