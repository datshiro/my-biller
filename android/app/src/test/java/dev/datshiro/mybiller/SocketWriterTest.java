package dev.datshiro.mybiller;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.InputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import org.junit.Test;

public class SocketWriterTest {
    @Test
    public void mayInNgungDocThiLenhGhiNemSauHan() throws Exception {
        try (ServerSocket server = new ServerSocket(0)) {
            Socket client = new Socket();
            client.connect(new InetSocketAddress("127.0.0.1", server.getLocalPort()), 1000);
            try (Socket stalled = server.accept()) {
                long start = System.nanoTime();
                assertThrows(
                        SocketWriter.WriteTimeoutException.class,
                        () -> SocketWriter.write(client, new byte[64 * 1024 * 1024], 500));
                long elapsedMs = (System.nanoTime() - start) / 1_000_000;
                assertTrue("dừng sau " + elapsedMs + " ms", elapsedMs < 5000);
                assertTrue(client.isClosed());
            }
        }
    }

    @Test
    public void ghiXongTruocHanThiChoCanhKhongDongSocket() throws Exception {
        try (ServerSocket server = new ServerSocket(0)) {
            Socket client = new Socket();
            client.connect(new InetSocketAddress("127.0.0.1", server.getLocalPort()), 1000);
            try (Socket ignored = server.accept()) {
                SocketWriter.write(client, new byte[16], 200);
                Thread.sleep(500);
                assertFalse(client.isClosed());
                client.close();
            }
        }
    }

    @Test
    public void mayInDocHetThiGhiXongBinhThuong() throws Exception {
        try (ServerSocket server = new ServerSocket(0)) {
            Socket client = new Socket();
            client.connect(new InetSocketAddress("127.0.0.1", server.getLocalPort()), 1000);
            try (Socket reader = server.accept()) {
                long[] total = {0};
                Thread drain = new Thread(() -> {
                    try {
                        InputStream in = reader.getInputStream();
                        byte[] buffer = new byte[8192];
                        for (int n; (n = in.read(buffer)) != -1; ) total[0] += n;
                    } catch (Exception ignored) {
                        // total giữ số byte đã đọc; assert bên dưới báo thiếu.
                    }
                });
                drain.start();
                byte[] data = new byte[4 * 1024 * 1024];
                SocketWriter.write(client, data, 5000);
                client.shutdownOutput();
                drain.join(5000);
                assertEquals(data.length, total[0]);
                client.close();
            }
        }
    }
}
