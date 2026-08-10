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

PORT="${ROBOT_PORT:-5175}"
BASE_URL="http://localhost:${PORT}"
WORKER_PORT=8787
WORKER_URL="http://127.0.0.1:${WORKER_PORT}"
WORKER_ADMIN_SECRET="robot-admin-secret"
VENV="${ROBOT_VENV:-.venv-robot}"
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
# Browser chạy với log Playwright nội bộ đã tắt vì log đó ghi nguyên text lấy từ DOM, gồm mã ghép
# dùng một lần. Xoá đúng artefact cũ trước khi chạy để kết quả mới không giữ bí mật từ lượt trước.
rm -f robot/results/playwright-log*.txt

server_pid=""
worker_pid=""
worker_listener_pid=""

dọn_dẹp() {
  local exit_code=$?
  if [[ -n "${server_pid}" ]] && kill -0 "${server_pid}" 2>/dev/null; then
    echo "→ Tắt dev server do lượt Robot này tạo"
    kill "${server_pid}" 2>/dev/null || true
  fi
  [[ -z "${server_pid}" ]] || wait "${server_pid}" 2>/dev/null || true
  if [[ -n "${worker_pid}" ]] && kill -0 "${worker_pid}" 2>/dev/null; then
    echo "→ Tắt Worker do lượt Robot này tạo"
    kill "${worker_pid}" 2>/dev/null || true
  fi
  [[ -z "${worker_pid}" ]] || wait "${worker_pid}" 2>/dev/null || true
  if [[ -n "${worker_listener_pid}" ]] && kill -0 "${worker_listener_pid}" 2>/dev/null; then
    # `wrangler` chạy `workerd` ở process con. Bình thường wrapper tự dọn; nhánh này chỉ thu đúng
    # listener đã xác minh là con của lượt hiện tại nếu wrapper chết mà bỏ sót.
    kill "${worker_listener_pid}" 2>/dev/null || true
  fi
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
  lsof -nP -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | sort -u || true
}

pid_working_directory() {
  lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' || true
}

pid_is_descendant_of() {
  local child="$1"
  local ancestor="$2"
  local current="${child}"
  while [[ "${current}" =~ ^[0-9]+$ ]] && (( current > 1 )); do
    [[ "${current}" == "${ancestor}" ]] && return 0
    current="$(ps -o ppid= -p "${current}" 2>/dev/null | tr -d '[:space:]')"
  done
  return 1
}

worker_sẵn_sàng() {
  curl -fsS --max-time 2 "${WORKER_URL}/health" 2>/dev/null | grep -q '"status":"ok"'
}

worker_listener_pids="$(port_listener_pids "${WORKER_PORT}")"
if [[ -n "${worker_listener_pids}" ]]; then
  if [[ "${worker_listener_pids}" == *$'\n'* ]]; then
    echo "Cổng ${WORKER_PORT} có nhiều listener; không thể xác minh Worker." >&2
    exit 1
  fi
  worker_listener_cwd="$(pid_working_directory "${worker_listener_pids}")"
  if [[ "${worker_listener_cwd}" != "${repo_root}" ]] || ! worker_sẵn_sàng; then
    echo "Cổng ${WORKER_PORT} đang do tiến trình không thuộc worktree này giữ." >&2
    exit 1
  fi
  echo "→ Dùng lại Worker đang chạy ở ${WORKER_URL}"
else
  echo "→ Dựng Worker ở ${WORKER_URL}"
  WRANGLER_LOG_PATH="${repo_root}/robot/results/wrangler-debug.log" \
    ./node_modules/.bin/wrangler dev --config worker/wrangler.toml \
    --ip 127.0.0.1 --port "${WORKER_PORT}" --var ADMIN_SECRET:"${WORKER_ADMIN_SECRET}" \
    --persist-to robot/results/wrangler-state >robot/results/wrangler.log 2>&1 &
  worker_pid=$!
  for _ in {1..60}; do
    if ! kill -0 "${worker_pid}" 2>/dev/null; then
      echo "Worker dừng trước khi sẵn sàng. Xem robot/results/wrangler.log." >&2
      exit 1
    fi
    worker_sẵn_sàng && break
    sleep 0.5
  done
  if ! worker_sẵn_sàng; then
    echo "Worker không lên sau 30 giây. Xem robot/results/wrangler.log." >&2
    exit 1
  fi
  started_worker_pids="$(port_listener_pids "${WORKER_PORT}")"
  started_worker_cwd=""
  if [[ -n "${started_worker_pids}" ]] && [[ "${started_worker_pids}" != *$'\n'* ]]; then
    started_worker_cwd="$(pid_working_directory "${started_worker_pids}")"
  fi
  if [[ -z "${started_worker_pids}" ]] || [[ "${started_worker_pids}" == *$'\n'* ]] ||
    [[ "${started_worker_cwd}" != "${repo_root}" ]] ||
    ! pid_is_descendant_of "${started_worker_pids}" "${worker_pid}"; then
    echo "Listener ở cổng ${WORKER_PORT} không phải Worker do lượt này tạo." >&2
    exit 1
  fi
  worker_listener_pid="${started_worker_pids}"
fi

listener_pids="$(port_listener_pids "${PORT}")"

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

  confirmed_listener_pids="$(port_listener_pids "${PORT}")"
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

  started_listener_pids="$(port_listener_pids "${PORT}")"
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
export ROBOT_WORKER_ADMIN_SECRET="${WORKER_ADMIN_SECRET}"
"${VENV}/bin/robot" \
  --outputdir robot/results \
  --variable "BASE_URL:${BASE_URL}" \
  --variable "WORKER_URL:${WORKER_URL}" \
  "$@"
