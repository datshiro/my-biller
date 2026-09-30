package dev.datshiro.mybiller;

import java.io.IOException;
import java.io.OutputStream;
import java.net.Socket;

/**
 * Timeout lúc nối không che lệnh ghi: máy in báo lỗi khe/cảm biến giữa job thì ngừng đọc, bộ đệm TCP đầy và
 * write() treo mãi. Quá hạn thì đóng bằng RST (linger 0) để byte còn trong bộ đệm của máy này bị bỏ, không
 * nhả tiếp lên máy in khi máy hồi — phần máy in đã nhận vào bộ đệm của nó thì vẫn in.
 *
 * write() trả về khi byte vào tới bộ đệm nhân, chưa phải lúc máy in đã in: job nhỏ lọt hết bộ đệm thì hạn
 * này không bao giờ chạm, dù máy in kẹt ngay sau đó.
 */
final class SocketWriter {
    static final class WriteTimeoutException extends IOException {
        WriteTimeoutException(long deadlineMs) {
            super("Máy in không nhận hết job sau " + deadlineMs + " ms");
        }
    }

    private enum State { WRITING, DONE, EXPIRED }

    private SocketWriter() {}

    static void write(Socket socket, byte[] data, long deadlineMs) throws IOException {
        // Chỉ một bên thắng: ghi xong trước thì chó canh không được RST (sẽ cắt cụt job đã báo "đã gửi");
        // chó canh thắng trước thì lần ghi báo quá hạn dù write() có kịp trả về.
        final State[] state = {State.WRITING};
        Thread watchdog = new Thread(() -> {
            try {
                Thread.sleep(deadlineMs);
            } catch (InterruptedException e) {
                return;
            }
            synchronized (state) {
                if (state[0] != State.WRITING) return;
                state[0] = State.EXPIRED;
            }
            try {
                socket.setSoLinger(true, 0);
                socket.close();
            } catch (IOException ignored) {
                // Đóng để gỡ write() đang treo; lỗi đóng không thêm thông tin gì.
            }
        });
        watchdog.setDaemon(true);
        watchdog.start();
        try {
            OutputStream out = socket.getOutputStream();
            out.write(data);
            out.flush();
            synchronized (state) {
                if (state[0] == State.EXPIRED) throw new WriteTimeoutException(deadlineMs);
                state[0] = State.DONE;
            }
        } catch (WriteTimeoutException e) {
            throw e;
        } catch (IOException e) {
            synchronized (state) {
                if (state[0] == State.EXPIRED) throw new WriteTimeoutException(deadlineMs);
            }
            throw e;
        } finally {
            watchdog.interrupt();
        }
    }
}
