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

cd "$(dirname "$0")/.."

PORT=5175
BASE_URL="http://localhost:${PORT}"
VENV=".venv-robot"

if [[ ! -x "${VENV}/bin/robot" ]]; then
  echo "Chưa có môi trường Robot. Dựng bằng:" >&2
  echo "  python3 -m venv ${VENV} && ${VENV}/bin/pip install robotframework robotframework-browser" >&2
  echo "  ${VENV}/bin/rfbrowser init" >&2
  exit 1
fi

server_pid=""

dọn_dẹp() {
  [[ -n "${server_pid}" ]] || return 0
  echo "→ Tắt dev server"
  kill "${server_pid}" 2>/dev/null || true
  wait "${server_pid}" 2>/dev/null || true
  # `npm run dev` đẻ ra tiến trình `vite` con; giết mỗi npm là bỏ lại một tiến trình ma giữ cổng.
  # Chỉ dọn khi chính script này dựng server, không đụng vào server của người đang code.
  lsof -ti ":${PORT}" 2>/dev/null | xargs kill 2>/dev/null || true
}
trap dọn_dẹp EXIT

if curl -sf -o /dev/null "${BASE_URL}/"; then
  echo "→ Dùng lại dev server đang chạy ở ${BASE_URL}"
else
  # Cổng có thể đang bị một tiến trình chết dở giữ. Dọn đúng chủ cũ thay vì nhảy sang cổng khác —
  # nhảy cổng là cách các tiến trình ma sinh sôi.
  if lsof -ti ":${PORT}" >/dev/null 2>&1; then
    echo "→ Cổng ${PORT} đang bị giữ nhưng không phục vụ được, dọn chủ cũ"
    lsof -ti ":${PORT}" | xargs kill 2>/dev/null || true
    sleep 1
  fi

  echo "→ Dựng dev server ở ${BASE_URL}"
  npm run dev -- --port "${PORT}" --strictPort >/tmp/my-biller-robot-dev.log 2>&1 &
  server_pid=$!

  for _ in $(seq 1 60); do
    curl -sf -o /dev/null "${BASE_URL}/" && break
    sleep 0.5
  done

  if ! curl -sf -o /dev/null "${BASE_URL}/"; then
    echo "Dev server không lên sau 30 giây. Xem /tmp/my-biller-robot-dev.log" >&2
    exit 1
  fi
fi

mkdir -p robot/results robot/downloads

# Không `exec`: `exec` thay luôn tiến trình shell nên cái trap ở trên không bao giờ chạy và dev
# server bị bỏ lại giữ cổng.
"${VENV}/bin/robot" \
  --outputdir robot/results \
  --variable "BASE_URL:${BASE_URL}" \
  "${@:-robot/tests}"
