#!/usr/bin/env bash
# Dựng và phục vụ bản app phát hành cũ THẬT (mặc định v2.19.0) làm máy thứ ba trong các ca tương thích ngược.
# Máy cũ không giả lập được bằng code hiện tại: code đã đổi thì "bản cũ giả" cũng đổi theo.
#
#   robot/may-cu.sh build    lấy mã nguồn đúng tag (git archive, không tạo worktree), npm ci, build — chỉ lần đầu
#   robot/may-cu.sh serve    phục vụ bản đã build ở 127.0.0.1:5176 (cổng cố định, thấy bận thì dừng chứ không đổi cổng)
#
# Bản build nằm ở robot/.may-cu/<tag>/ và được giữ giữa các lượt chạy. App chạy ở hostname local nên tự nối
# Worker local 127.0.0.1:8787, cùng Worker với hai máy bản mới.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd "${script_dir}/.." && pwd -P)"
TAG="${MAY_CU_TAG:-v2.19.0}"
PORT="${MAY_CU_PORT:-5176}"
if [[ ! "${TAG}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "MAY_CU_TAG phải là tag phát hành dạng vX.Y.Z." >&2
  exit 1
fi
dir="${repo_root}/robot/.may-cu/${TAG}"

build() {
  if [[ -f "${dir}/dist/index.html" ]]; then
    echo "→ Dùng lại bản ${TAG} đã build ở ${dir}"
    return
  fi
  if ! git -C "${repo_root}" rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
    echo "→ Lấy tag ${TAG}"
    # `--depth` chỉ cho repo vốn đã shallow (CI): trên clone đầy đủ nó biến cả repo thành shallow.
    local depth=()
    [[ "$(git -C "${repo_root}" rev-parse --is-shallow-repository)" == "true" ]] && depth=(--depth 1)
    git -C "${repo_root}" fetch --no-tags ${depth[@]+"${depth[@]}"} origin "refs/tags/${TAG}:refs/tags/${TAG}"
  fi
  rm -rf "${dir}"
  mkdir -p "${dir}"
  echo "→ Dựng bản ${TAG} ở ${dir}"
  git -C "${repo_root}" archive "${TAG}" | tar -x -C "${dir}"
  (cd "${dir}" && npm ci --no-audit --no-fund && npm run build)
  test -f "${dir}/dist/index.html"
}

serve() {
  if [[ ! -f "${dir}/dist/index.html" ]]; then
    echo "Chưa có bản ${TAG}. Chạy 'robot/may-cu.sh build' trước." >&2
    exit 1
  fi
  if lsof -nP -tiTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Cổng ${PORT} đang có tiến trình khác giữ; không phục vụ máy cũ ở cổng khác." >&2
    exit 1
  fi
  cd "${dir}"
  # `exec` để PID Robot giữ chính là Vite: tắt process là tắt luôn server, không bỏ lại tiến trình con giữ cổng.
  exec ./node_modules/.bin/vite preview --host 127.0.0.1 --port "${PORT}" --strictPort
}

case "${1:-}" in
  build) build ;;
  serve) serve ;;
  *)
    echo "Dùng: robot/may-cu.sh build|serve" >&2
    exit 1
    ;;
esac
