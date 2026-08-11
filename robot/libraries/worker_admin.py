import json
import os
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from robot.api.deco import keyword


@keyword("Tạo Quán Thử Qua Worker")
def create_test_shop(worker_url: str) -> str:
    admin_secret = os.environ.get("ROBOT_WORKER_ADMIN_SECRET", "")
    if not admin_secret:
        raise AssertionError("Thiếu ROBOT_WORKER_ADMIN_SECRET để tạo quán thử.")

    endpoint = f"{worker_url.rstrip('/')}/shop"
    deadline = time.monotonic() + 30
    last_status: int | str = "không kết nối được"

    while True:
        request = Request(
            endpoint,
            method="POST",
            headers={"authorization": f"Bearer {admin_secret}"},
        )
        try:
            with urlopen(request, timeout=10) as response:
                last_status = response.status
                payload = json.load(response)
        except HTTPError as error:
            last_status = error.code
            error.close()
            payload = None
        except URLError:
            last_status = "không kết nối được"
            payload = None

        if last_status == 201 and isinstance(payload, dict):
            code = payload.get("code")
            if isinstance(code, str) and code:
                return code
            raise AssertionError("Worker tạo quán thử nhưng không trả mã ghép hợp lệ.")

        retryable_status = last_status in {401, 429, "không kết nối được"} or (
            isinstance(last_status, int) and 500 <= last_status < 600
        )
        if not retryable_status:
            raise AssertionError(f"Không tạo được quán thử: {last_status}")

        if time.monotonic() >= deadline:
            raise AssertionError(f"Không tạo được quán thử: {last_status}")
        time.sleep(0.5)
