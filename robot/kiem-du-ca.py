"""Chứng minh mọi ca Robot đã chạy đúng một lần khi CI chia bộ ra nhiều runner.

Danh sách ca phải có dựng thẳng từ file `.robot`; danh sách ca đã chạy đọc từ các `output-*.xml` mà từng
phần gửi về. Thiếu một ca hay một ca chạy hai lần đều làm đỏ — chia runner không được lặng lẽ bỏ ca nào.

    python robot/kiem-du-ca.py outputs/*.xml
"""

import sys
from collections import Counter
from pathlib import Path

from robot.api import ExecutionResult, TestSuiteBuilder

THƯ_MỤC_CA = ("robot/tests", "robot/recovery")


def khoá(test):
    return Path(test.source).name, test.name


def main(outputs):
    if not outputs:
        sys.exit("Không có output.xml nào để đối chiếu.")
    phải_có = Counter(khoá(t) for thư_mục in THƯ_MỤC_CA for t in TestSuiteBuilder().build(thư_mục).all_tests)
    đã_chạy = Counter(khoá(t) for f in outputs for t in ExecutionResult(f).suite.all_tests)

    thiếu = phải_có - đã_chạy
    thừa = đã_chạy - phải_có
    print(f"phải có={sum(phải_có.values())} đã chạy={sum(đã_chạy.values())} thiếu={len(thiếu)} thừa={len(thừa)}")
    for (file, tên), n in sorted(thiếu.items()):
        print(f"  thiếu: {file} :: {tên} (x{n})")
    for (file, tên), n in sorted(thừa.items()):
        print(f"  thừa:  {file} :: {tên} (x{n})")
    sys.exit(1 if thiếu or thừa else 0)


if __name__ == "__main__":
    main(sys.argv[1:])
