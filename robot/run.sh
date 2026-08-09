#!/usr/bin/env bash
# Chạy bộ kiểm thử live Robot Framework trên app thật.
#
# Tự dựng dev server ở cổng riêng rồi tự dọn khi xong. Cổng 5173 để dành cho người đang code,
# 5174 cho bộ Playwright — bộ này lấy 5175 để ba thứ chạy song song không giẫm chân nhau.
#
# Đường dẫn tính từ gốc repo (script tự `cd` về đó):
#   ./robot/run.sh                                  chạy hết
#   ./robot/run.sh robot/tests/ban-hang.robot       chạy một suite
#   ./robot/run.sh -i regression robot/tests        chỉ chạy ca gắn thẻ regression
#
# Bộ này cần bản `vite` dev, không chạy được trên bản build: nút "Nạp dữ liệu mẫu" — chỗ mọi test
# lấy dữ liệu ban đầu — chỉ hiện ở chế độ dev.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd "${script_dir}/.." && pwd -P)"
cd "${repo_root}"

PORT=5175
BASE_URL="http://localhost:${PORT}"
VENV=".venv-robot"
EXPECTED_TITLE="<title>my-biller — Bán hàng</title>"

if [[ ! -x "${VENV}/bin/robot" ]]; then
  echo "Chưa có môi trường Robot. Chạy './robot/install.sh' trước." >&2
  exit 1
fi

if ! command -v lsof >/dev/null 2>&1; then
  echo "Không tìm thấy lsof để xác minh tiến trình đang giữ cổng ${PORT}." >&2
  exit 1
fi

mkdir -p robot/results robot/downloads

server_pid=""

dọn_dẹp() {
  local exit_code=$?
  [[ -n "${server_pid}" ]] || return "${exit_code}"

  if kill -0 "${server_pid}" 2>/dev/null; then
    echo "→ Tắt dev server do lượt Robot này tạo"
    kill "${server_pid}" 2>/dev/null || true
  fi
  wait "${server_pid}" 2>/dev/null || true
  return "${exit_code}"
}
trap dọn_dẹp EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

app_sẵn_sàng() {
  local html
  html="$(curl -fsS --max-time 2 "${BASE_URL}/" 2>/dev/null)" || return 1
  [[ "${html}" == *"${EXPECTED_TITLE}"* ]]
}

port_listener_pids() {
  lsof -nP -tiTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null | sort -u || true
}

pid_working_directory() {
  lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' || true
}

listener_pids="$(port_listener_pids)"

if [[ -n "${listener_pids}" ]]; then
  if [[ "${listener_pids}" == *$'\n'* ]]; then
    echo "Cổng ${PORT} có nhiều listener (${listener_pids//$'\n'/, }); không thể xác minh ownership." >&2
    exit 1
  fi

  listener_pid="${listener_pids}"
  listener_cwd="$(pid_working_directory "${listener_pid}")"

  if [[ "${listener_cwd}" != "${repo_root}" ]] || ! app_sẵn_sàng; then
    echo "Cổng ${PORT} đang do tiến trình không thuộc my-biller worktree này giữ." >&2
    echo "PID: ${listener_pid}; cwd: ${listener_cwd:-không đọc được}. Hãy để owner xử lý tiến trình đó." >&2
    exit 1
  fi

  confirmed_listener_pids="$(port_listener_pids)"
  confirmed_listener_cwd=""
  if [[ "${confirmed_listener_pids}" == "${listener_pid}" ]]; then
    confirmed_listener_cwd="$(pid_working_directory "${listener_pid}")"
  fi
  if [[ "${confirmed_listener_pids}" != "${listener_pid}" ]] || [[ "${confirmed_listener_cwd}" != "${repo_root}" ]]; then
    echo "Listener ở cổng ${PORT} đã đổi trong lúc xác minh; dừng để tránh chạy nhầm worktree." >&2
    exit 1
  fi

  echo "→ Dùng lại dev server đang chạy ở ${BASE_URL}"
else
  echo "→ Dựng dev server ở ${BASE_URL}"
  ./node_modules/.bin/vite --host 127.0.0.1 --port "${PORT}" --strictPort >robot/results/vite.log 2>&1 &
  server_pid=$!

  for _ in {1..60}; do
    if ! kill -0 "${server_pid}" 2>/dev/null; then
      echo "Dev server dừng trước khi sẵn sàng. Xem robot/results/vite.log." >&2
      exit 1
    fi
    app_sẵn_sàng && break
    sleep 0.5
  done

  if ! app_sẵn_sàng; then
    echo "Dev server không lên sau 30 giây. Xem robot/results/vite.log." >&2
    exit 1
  fi

  started_listener_pids="$(port_listener_pids)"
  started_listener_cwd=""
  if [[ "${started_listener_pids}" == "${server_pid}" ]]; then
    started_listener_cwd="$(pid_working_directory "${server_pid}")"
  fi
  if [[ "${started_listener_pids}" != "${server_pid}" ]] || [[ "${started_listener_cwd}" != "${repo_root}" ]] || ! kill -0 "${server_pid}" 2>/dev/null; then
    echo "Listener ở cổng ${PORT} không phải Vite do lượt Robot này tạo; dừng để tránh chạy nhầm worktree." >&2
    exit 1
  fi
fi

if (( $# == 0 )); then
  set -- robot/tests
fi

# Không `exec`: `exec` thay luôn tiến trình shell nên cái trap ở trên không bao giờ chạy và dev
# server bị bỏ lại giữ cổng.
"${VENV}/bin/robot" \
  --outputdir robot/results \
  --variable "BASE_URL:${BASE_URL}" \
  "$@"
