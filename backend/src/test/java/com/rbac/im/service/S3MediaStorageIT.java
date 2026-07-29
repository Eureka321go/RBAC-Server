package com.rbac.im.service;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** 真实 MinIO 全链路：建桶 → 预签名 PUT 上传 → HEAD → 预签名 GET 取回一致。 */
@SpringBootTest
@ActiveProfiles("test")
class S3MediaStorageIT {

    @Autowired MediaStorage storage;

    @Test
    void presignPut_head_presignGet_roundTrip() throws Exception {
        storage.ensureBucket();
        String key = "im/c_it_1/199001/" + UUID.randomUUID().toString().replace("-", "") + ".txt";
        byte[] data = "hello-media".getBytes(StandardCharsets.UTF_8);
        HttpClient http = HttpClient.newHttpClient();

        String contentType = "text/plain";
        // size/mime 已进签名，客户端必须原样带上这两个头，否则 SigV4 校验失败
        String putUrl = storage.presignPut(key, data.length, contentType, Duration.ofMinutes(5));
        HttpResponse<Void> put = http.send(
                HttpRequest.newBuilder(URI.create(putUrl))
                        .header("Content-Type", contentType)
                        .PUT(HttpRequest.BodyPublishers.ofByteArray(data)).build(),
                HttpResponse.BodyHandlers.discarding());
        assertThat(put.statusCode()).isBetween(200, 299);

        Optional<MediaStorage.ObjectStat> stat = storage.stat(key);
        assertThat(stat).isPresent();
        assertThat(stat.get().size()).isEqualTo(data.length);
        // contentType 是 validateForSend 的 mime 白名单承重件，必须验真实 MinIO 回来的值
        assertThat(stat.get().contentType()).isEqualTo(contentType);

        assertThat(storage.stat("im/c_it_1/199001/does-not-exist.txt")).isEmpty();

        String getUrl = storage.presignGet(key, Duration.ofMinutes(5));
        HttpResponse<byte[]> get = http.send(
                HttpRequest.newBuilder(URI.create(getUrl)).GET().build(),
                HttpResponse.BodyHandlers.ofByteArray());
        assertThat(get.body()).isEqualTo(data);
    }

    /** C1：Content-Type 已进签名，换一个 mime 用同一 URL 上传必须被存储端拒绝。 */
    @Test
    void presignPut_rejectsMismatchedContentType() throws Exception {
        storage.ensureBucket();
        String key = "im/c_it_1/199001/" + UUID.randomUUID().toString().replace("-", "") + ".txt";
        byte[] data = "<html>evil</html>".getBytes(StandardCharsets.UTF_8);

        String putUrl = storage.presignPut(key, data.length, "text/plain", Duration.ofMinutes(5));
        HttpResponse<Void> put = HttpClient.newHttpClient().send(
                HttpRequest.newBuilder(URI.create(putUrl))
                        .header("Content-Type", "text/html")   // 与签名不符
                        .PUT(HttpRequest.BodyPublishers.ofByteArray(data)).build(),
                HttpResponse.BodyHandlers.discarding());

        assertThat(put.statusCode()).isEqualTo(403);
        assertThat(storage.stat(key)).isEmpty();
    }
}
