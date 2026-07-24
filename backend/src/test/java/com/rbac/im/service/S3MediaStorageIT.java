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

        String putUrl = storage.presignPut(key, Duration.ofMinutes(5));
        HttpResponse<Void> put = http.send(
                HttpRequest.newBuilder(URI.create(putUrl))
                        .PUT(HttpRequest.BodyPublishers.ofByteArray(data)).build(),
                HttpResponse.BodyHandlers.discarding());
        assertThat(put.statusCode()).isBetween(200, 299);

        Optional<MediaStorage.ObjectStat> stat = storage.stat(key);
        assertThat(stat).isPresent();
        assertThat(stat.get().size()).isEqualTo(data.length);

        assertThat(storage.stat("im/c_it_1/199001/does-not-exist.txt")).isEmpty();

        String getUrl = storage.presignGet(key, Duration.ofMinutes(5));
        HttpResponse<byte[]> get = http.send(
                HttpRequest.newBuilder(URI.create(getUrl)).GET().build(),
                HttpResponse.BodyHandlers.ofByteArray());
        assertThat(get.body()).isEqualTo(data);
    }
}
