"""Ghi bảng thời gian từng shard Robot và cảnh báo (không chặn) khi các shard lệch nhau quá nhiều.

Thời gian đọc từ suite gốc của các `output-*.xml` mà từng shard gửi về: là thời gian Robot, không gồm
khoảng một phút cài đặt runner. `output-recovery.xml` chạy trên runner `con-lai` nên cộng vào shard đó.
Có `GITHUB_STEP_SUMMARY` thì bảng ghi vào đó, không thì in ra màn hình.

    python robot/thoi-gian-shard.py outputs/*.xml
"""

import os
import sys
from collections import defaultdict
from pathlib import Path

from robot.api import ExecutionResult

NGƯỠNG_LỆCH = 0.30
SỐ_SHARD = 3


def shard(output):
    tên = Path(output).stem.removeprefix("output-")
    return "con-lai" if tên == "recovery" else tên


def main(outputs):
    phút = defaultdict(float)
    for f in outputs:
        phút[shard(f)] += ExecutionResult(f).suite.elapsed_time.total_seconds() / 60

    dòng = ["| Shard | Robot (phút) |", "| --- | ---: |"]
    dòng += [f"| `{tên}` | {phút[tên]:.1f} |" for tên in sorted(phút, key=phút.get, reverse=True)]
    bảng = "### Thời gian Robot từng shard (không gồm cài đặt runner)\n\n" + "\n".join(dòng) + "\n"
    đích = os.environ.get("GITHUB_STEP_SUMMARY")
    if đích:
        with open(đích, "a", encoding="utf-8") as summary:
            summary.write(bảng)
    print(bảng)

    if len(phút) < SỐ_SHARD or min(phút.values()) <= 0:
        return
    dài, ngắn = max(phút, key=phút.get), min(phút, key=phút.get)
    lệch = phút[dài] / phút[ngắn] - 1
    if lệch > NGƯỠNG_LỆCH:
        print(
            f"::warning::Shard {dài} ({phút[dài]:.1f} phút) dài hơn {ngắn} ({phút[ngắn]:.1f} phút) {lệch:.0%},"
            f" quá ngưỡng {NGƯỠNG_LỆCH:.0%}: chuyển thẻ shard-a theo thời gian từng ca trong artifact robot-output-*."
        )


if __name__ == "__main__":
    main(sys.argv[1:])
