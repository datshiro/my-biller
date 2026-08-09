#!/usr/bin/env bash
# Dựng môi trường Robot tái lập cho máy local và GitHub Actions.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd "${script_dir}/.." && pwd -P)"
cd "${repo_root}"

usage() {
  echo "Cách dùng: ./robot/install.sh [--with-deps]" >&2
}

with_deps=false
if (( $# > 1 )); then
  usage
  exit 2
elif (( $# == 1 )); then
  if [[ "$1" != "--with-deps" ]]; then
    usage
    exit 2
  fi
  with_deps=true
fi

if [[ ! -x "node_modules/.bin/playwright" ]]; then
  echo "Chưa có Playwright trong node_modules. Chạy 'npm ci' trước." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Không tìm thấy python3 để tạo môi trường Robot." >&2
  exit 1
fi

venv=".venv-robot"
if [[ ! -x "${venv}/bin/python" ]]; then
  echo "→ Tạo môi trường Python ${venv}"
  python3 -m venv "${venv}"
fi

echo "→ Cài dependency Robot đã pin"
"${venv}/bin/python" -m pip install -r robot/requirements.txt

echo "→ Khởi tạo Robot Framework Browser"
"${venv}/bin/rfbrowser" init --skip-browsers

echo "→ Cài Google Chrome cho Playwright"
if [[ "${with_deps}" == true ]]; then
  "node_modules/.bin/playwright" install --with-deps chrome
else
  "node_modules/.bin/playwright" install chrome
fi

echo "✓ Môi trường Robot đã sẵn sàng"
