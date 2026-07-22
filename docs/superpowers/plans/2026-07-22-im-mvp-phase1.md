# IM 后端 MVP — 第一阶段实现计划（里程碑 1~3）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 RBAC-Server 上落地 IM 后端地基：Maven 多模块化，起 Netty 独立网关做鉴权长连接，跑通"单聊文本"从客户端 → 网关 → Kafka → im-logic 定序落库 → Kafka → 网关 → 对端在线推达"的端到端闭环。

**Architecture:** 网关（`im-gateway` 独立 Spring Boot + Netty）只管 WebSocket 连接与收发，无业务状态；连接路由写 Redis，消息经 Kafka 与 im-logic（现有应用内 `com.rbac.im` 包）解耦。消息只存一份（读扩散），会话内用 Redis `INCR` 定序。

**Tech Stack:** Java 21、Spring Boot 3.4.1、Netty 4.1、Spring Kafka、Spring Data MongoDB、MyBatis-Plus 3.5.9、Redis(Lettuce)、Flyway、jjwt 0.12.6。

## Global Constraints

- Java 版本：`21`（沿用根 `pom.xml` 的 `<java.version>21</java.version>`）。
- Spring Boot：`3.4.1`；MyBatis-Plus：`3.5.9`；jjwt：`0.12.6`（版本值与现有 `backend/pom.xml` 一致）。
- API 统一前缀 `/api`、camelCase；枚举固定字符串（会话类型 `SINGLE`/`GROUP`）。
- 消息落 MongoDB，会话/成员/群元数据落 MySQL，二进制不进本阶段（本阶段只做 TEXT）。
- 新表用 `BaseEntity`（`com.rbac.common.domain.BaseEntity`）+ Flyway `V3__` 迁移，逻辑删除列 `deleted` 0/1。
- Redis key 约定：access 会话 `auth:access:<jti>`（已有）；会话 seq `im:conv:<cid>:seq`；路由 `route:user:<userId>`。
- 网关与 backend **共享同一 `rbac.jwt.secret`**；网关鉴权只校验 JWT 签名/过期/typ + `auth:access:<jti>` 存在性，不反序列化 `LoginUser`。
- 安全红线：登出（`auth:access:<jti>` 被删）后旧 token 必须无法建立/保持连接。

---

## 文件结构（本阶段新建/修改）

**根与模块**
- 新建 `pom.xml`（仓库根 `RBAC-Server/pom.xml`）：聚合父 pom，`packaging=pom`，`modules: backend, im-gateway`。
- 修改 `backend/pom.xml`：父改为 `rbac-parent`；新增 spring-kafka、spring-data-mongodb 依赖。
- 新建 `im-gateway/`：`pom.xml` + `src/main/java/com/rbac/im/gateway/**` + `src/main/resources/application.yml`。

**im-logic（现有 backend 内新增 `com.rbac.im` 包）**
- `com.rbac.im.entity`：`ImConversation`、`ImConversationMember`、`ImGroup`、`ImGroupMember`（MySQL）。
- `com.rbac.im.mapper`：对应 4 个 Mapper。
- `com.rbac.im.doc`：`ImMessage`（Mongo 文档）+ `ImMessageRepository`。
- `com.rbac.im.protocol`：`Envelope`、`ChatBody`、`OutboundPacket`（网关↔logic 的 Kafka JSON 契约，im-gateway 侧复制一份同结构）。
- `com.rbac.im.service`：`ConversationService`（cid 归一/成员查询）、`SeqService`（Redis INCR）、`InboundMessageConsumer`、`OutboundDispatcher`。
- `com.rbac.im.config`：`ImKafkaTopics`（topic 名常量）。
- 迁移 `backend/src/main/resources/db/migration/V3__im_schema.sql`。

**im-gateway**
- `ImGatewayApplication`（`@SpringBootApplication`）。
- `gateway.netty`：`NettyWebSocketServer`（启动/绑定）、`WebSocketChannelInitializer`（pipeline）、`HandshakeAuthHandler`（HTTP 升级前鉴权）、`ImFrameHandler`（收 WS 帧 → Kafka）、`HeartbeatHandler`（IdleState）。
- `gateway.auth`：`GatewayJwtVerifier`（jjwt 验签 + Redis 存在性校验）。
- `gateway.registry`：`ChannelRegistry`（本机 userId+device→Channel）、`RouteService`（Redis 路由增删/续期）。
- `gateway.kafka`：`InboundProducer`（发 im-inbound）、`OutboundConsumer`（消费 im-outbound → 推 Channel）。

---

## Task 1: Maven 多模块化

**Files:**
- Create: `pom.xml`（仓库根）
- Modify: `backend/pom.xml:1-24`（父与坐标）

**Interfaces:**
- Produces: 根聚合 pom（artifactId `rbac-parent`）、`backend` 子模块可被 `mvn -f pom.xml package` 一并构建。

- [ ] **Step 1: 新建根 `pom.xml`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.4.1</version>
        <relativePath/>
    </parent>

    <groupId>com.rbac</groupId>
    <artifactId>rbac-parent</artifactId>
    <version>0.0.1-SNAPSHOT</version>
    <packaging>pom</packaging>
    <name>rbac-parent</name>

    <properties>
        <java.version>21</java.version>
        <mybatis-plus.version>3.5.9</mybatis-plus.version>
        <jjwt.version>0.12.6</jjwt.version>
    </properties>

    <modules>
        <module>backend</module>
        <module>im-gateway</module>
    </modules>
</project>
```

- [ ] **Step 2: 修改 `backend/pom.xml` 父为聚合 pom**

把 `backend/pom.xml` 顶部的 `<parent>` 块整体替换为：

```xml
    <parent>
        <groupId>com.rbac</groupId>
        <artifactId>rbac-parent</artifactId>
        <version>0.0.1-SNAPSHOT</version>
        <relativePath>../pom.xml</relativePath>
    </parent>
```

并删除 `backend/pom.xml` 中重复的 `<properties>`（`java.version`/`mybatis-plus.version`/`jjwt.version` 已上移到根 pom；其余保持不变）。

- [ ] **Step 3: 构建校验（im-gateway 尚不存在，先临时只构建 backend）**

Run: `mvn -q -pl backend -am -DskipTests package`
Expected: BUILD SUCCESS，产物 `backend/target/rbac-server-0.0.1-SNAPSHOT.jar`。

> 注：此时根 pom 已列出 `im-gateway` 模块但目录未建，`mvn -pl backend` 用 `-pl` 只构建 backend 可避开。Task 3 建好 im-gateway 后改用整仓构建。

- [ ] **Step 4: Commit**

```bash
git add pom.xml backend/pom.xml
git commit -m "build: 引入 Maven 多模块聚合 pom，为 im-gateway 铺路"
```

---

## Task 2: Compose 增加 MongoDB + MinIO

**Files:**
- Modify: `deploy/docker-compose.yml`（新增两个服务 + 两个 volume）

**Interfaces:**
- Produces: `--profile im` 起 MongoDB(:27017)、MinIO(:9000/:9001)；网络 `rbac-net`。

- [ ] **Step 1: 在 `kibana` 服务之后、`volumes:` 之前插入两个服务**

```yaml
  # ==================== IM 层（--profile im） ====================
  mongodb:
    image: mongo:7.0
    container_name: rbac-mongodb
    profiles: ["im"]
    restart: unless-stopped
    ports:
      - "27017:27017"
    environment:
      MONGO_INITDB_ROOT_USERNAME: rbac
      MONGO_INITDB_ROOT_PASSWORD: rbac123456
      MONGO_INITDB_DATABASE: rbac_im
    volumes:
      - mongo-data:/data/db
    networks: [rbac-net]

  minio:
    image: minio/minio:RELEASE.2024-10-13T13-34-11Z
    container_name: rbac-minio
    profiles: ["im"]
    restart: unless-stopped
    command: server /data --console-address ":9001"
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      MINIO_ROOT_USER: rbac
      MINIO_ROOT_PASSWORD: rbac123456
    volumes:
      - minio-data:/data
    networks: [rbac-net]
```

- [ ] **Step 2: 在 `volumes:` 块补两个卷**

在 `deploy/docker-compose.yml` 的 `volumes:` 下追加：

```yaml
  mongo-data:
  minio-data:
```

- [ ] **Step 3: 启动校验**

Run: `cd deploy && docker compose --profile im up -d && docker compose ps`
Expected: `rbac-mongodb`、`rbac-minio` 状态 `running`（healthy）。MinIO 控制台 http://localhost:9001 可登录（rbac/rbac123456）。

- [ ] **Step 4: Commit**

```bash
git add deploy/docker-compose.yml
git commit -m "chore(deploy): compose 新增 MongoDB 与 MinIO（profile im）"
```

---

## Task 3: im-gateway 模块骨架 + 可启动

**Files:**
- Create: `im-gateway/pom.xml`
- Create: `im-gateway/src/main/java/com/rbac/im/gateway/ImGatewayApplication.java`
- Create: `im-gateway/src/main/resources/application.yml`
- Create: `im-gateway/src/test/java/com/rbac/im/gateway/ImGatewayApplicationTests.java`

**Interfaces:**
- Produces: 独立可启动的 Spring Boot 应用（默认 HTTP 端口 8090 仅用于 actuator，WS 端口 9001 在后续 Task 绑定）；提供 `im.gateway.id`、`im.gateway.ws-port`、`rbac.jwt.secret` 配置。

- [ ] **Step 1: 新建 `im-gateway/pom.xml`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <parent>
        <groupId>com.rbac</groupId>
        <artifactId>rbac-parent</artifactId>
        <version>0.0.1-SNAPSHOT</version>
        <relativePath>../pom.xml</relativePath>
    </parent>

    <artifactId>im-gateway</artifactId>
    <name>im-gateway</name>
    <description>IM WebSocket 接入网关（Netty）</description>

    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-actuator</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-redis</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.kafka</groupId>
            <artifactId>spring-kafka</artifactId>
        </dependency>
        <dependency>
            <groupId>io.netty</groupId>
            <artifactId>netty-all</artifactId>
        </dependency>
        <dependency>
            <groupId>io.jsonwebtoken</groupId>
            <artifactId>jjwt-api</artifactId>
            <version>${jjwt.version}</version>
        </dependency>
        <dependency>
            <groupId>io.jsonwebtoken</groupId>
            <artifactId>jjwt-impl</artifactId>
            <version>${jjwt.version}</version>
            <scope>runtime</scope>
        </dependency>
        <dependency>
            <groupId>io.jsonwebtoken</groupId>
            <artifactId>jjwt-jackson</artifactId>
            <version>${jjwt.version}</version>
            <scope>runtime</scope>
        </dependency>
        <dependency>
            <groupId>com.fasterxml.jackson.core</groupId>
            <artifactId>jackson-databind</artifactId>
        </dependency>
        <dependency>
            <groupId>org.projectlombok</groupId>
            <artifactId>lombok</artifactId>
            <optional>true</optional>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
                <configuration>
                    <excludes>
                        <exclude>
                            <groupId>org.projectlombok</groupId>
                            <artifactId>lombok</artifactId>
                        </exclude>
                    </excludes>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>
```

- [ ] **Step 2: 新建启动类 `ImGatewayApplication.java`**

```java
package com.rbac.im.gateway;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class ImGatewayApplication {
    public static void main(String[] args) {
        SpringApplication.run(ImGatewayApplication.class, args);
    }
}
```

- [ ] **Step 3: 新建 `im-gateway/src/main/resources/application.yml`**

```yaml
server:
  port: 8090            # 仅供 actuator，WS 走 Netty 独立端口
spring:
  application:
    name: im-gateway
  data:
    redis:
      host: localhost
      port: 6379
  kafka:
    bootstrap-servers: localhost:9092
    consumer:
      group-id: im-gateway-${im.gateway.id}
      auto-offset-reset: latest
      key-deserializer: org.apache.kafka.common.serialization.StringDeserializer
      value-deserializer: org.apache.kafka.common.serialization.StringDeserializer
    producer:
      key-serializer: org.apache.kafka.common.serialization.StringSerializer
      value-serializer: org.apache.kafka.common.serialization.StringSerializer

im:
  gateway:
    id: gw1              # 每个网关实例唯一
    ws-port: 9001
    heartbeat-idle-seconds: 60

rbac:
  jwt:
    secret: ${RBAC_JWT_SECRET:change-me-please-change-me-32bytes-min}   # 必须与 backend 一致
```

- [ ] **Step 4: 新建 smoke 测试 `ImGatewayApplicationTests.java`**

```java
package com.rbac.im.gateway;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;

@SpringBootTest
@TestPropertySource(properties = {
        "spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.data.redis.RedisAutoConfiguration,org.springframework.boot.autoconfigure.data.redis.RedisRepositoriesAutoConfiguration,org.springframework.boot.autoconfigure.kafka.KafkaAutoConfiguration",
        "im.gateway.ws-port=0"
})
class ImGatewayApplicationTests {
    @Test
    void contextLoads() {
    }
}
```

> 说明：测试环境排除 Redis/Kafka 自动装配（无需真实中间件即可验证 Spring 上下文加载）；`ws-port=0` 让后续 Netty 绑定随机端口，避免测试占用固定端口。

- [ ] **Step 5: 整仓构建校验**

Run: `mvn -q -DskipTests package`
Expected: BUILD SUCCESS，`backend` 与 `im-gateway` 两个模块均产出 jar。

- [ ] **Step 6: 运行测试**

Run: `mvn -q -pl im-gateway test`
Expected: `ImGatewayApplicationTests` PASS。

- [ ] **Step 7: Commit**

```bash
git add im-gateway pom.xml
git commit -m "feat(im-gateway): 新增可启动的 Netty 网关模块骨架"
```

---

## Task 4: im-logic 建表迁移 + MySQL 实体/Mapper

**Files:**
- Create: `backend/src/main/resources/db/migration/V3__im_schema.sql`
- Create: `backend/src/main/java/com/rbac/im/entity/ImConversation.java`
- Create: `backend/src/main/java/com/rbac/im/entity/ImConversationMember.java`
- Create: `backend/src/main/java/com/rbac/im/entity/ImGroup.java`
- Create: `backend/src/main/java/com/rbac/im/entity/ImGroupMember.java`
- Create: `backend/src/main/java/com/rbac/im/mapper/{ImConversationMapper,ImConversationMemberMapper,ImGroupMapper,ImGroupMemberMapper}.java`
- Test: `backend/src/test/java/com/rbac/im/mapper/ImConversationMapperTest.java`

**Interfaces:**
- Produces: `ImConversation{cid,type,groupId,lastMsgSeq,lastMsgPreview}`、`ImConversationMember{cid,userId,lastReadSeq,mentionSeq,muted}`、Mapper 继承 `BaseMapper<T>`。

- [ ] **Step 1: 新建迁移 `V3__im_schema.sql`**

```sql
CREATE TABLE `im_conversation` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `cid` VARCHAR(64) NOT NULL COMMENT '会话ID：单聊 c_{minId}_{maxId}，群聊 g_{groupId}',
    `type` VARCHAR(16) NOT NULL COMMENT 'SINGLE / GROUP',
    `group_id` BIGINT NULL COMMENT '群聊时指向 im_group.id',
    `last_msg_seq` BIGINT NOT NULL DEFAULT 0,
    `last_msg_preview` VARCHAR(255) NULL,
    `created_by` BIGINT NULL, `created_at` DATETIME NULL,
    `updated_by` BIGINT NULL, `updated_at` DATETIME NULL,
    `deleted` TINYINT NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`), UNIQUE KEY `uk_cid` (`cid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='IM 会话';

CREATE TABLE `im_conversation_member` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `cid` VARCHAR(64) NOT NULL,
    `user_id` BIGINT NOT NULL,
    `last_read_seq` BIGINT NOT NULL DEFAULT 0,
    `mention_seq` BIGINT NOT NULL DEFAULT 0,
    `muted` TINYINT NOT NULL DEFAULT 0,
    `created_by` BIGINT NULL, `created_at` DATETIME NULL,
    `updated_by` BIGINT NULL, `updated_at` DATETIME NULL,
    `deleted` TINYINT NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`), UNIQUE KEY `uk_cid_user` (`cid`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='IM 会话成员';

CREATE TABLE `im_group` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(64) NOT NULL,
    `owner_id` BIGINT NOT NULL,
    `created_by` BIGINT NULL, `created_at` DATETIME NULL,
    `updated_by` BIGINT NULL, `updated_at` DATETIME NULL,
    `deleted` TINYINT NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='IM 群';

CREATE TABLE `im_group_member` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `group_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `role` VARCHAR(16) NOT NULL DEFAULT 'MEMBER' COMMENT 'OWNER / ADMIN / MEMBER',
    `created_by` BIGINT NULL, `created_at` DATETIME NULL,
    `updated_by` BIGINT NULL, `updated_at` DATETIME NULL,
    `deleted` TINYINT NOT NULL DEFAULT 0,
    PRIMARY KEY (`id`), UNIQUE KEY `uk_group_user` (`group_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='IM 群成员';
```

- [ ] **Step 2: 新建实体 `ImConversation.java`**

```java
package com.rbac.im.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.rbac.common.domain.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("im_conversation")
public class ImConversation extends BaseEntity {
    private String cid;
    private String type;          // SINGLE / GROUP
    private Long groupId;
    private Long lastMsgSeq;
    private String lastMsgPreview;
}
```

- [ ] **Step 3: 新建实体 `ImConversationMember.java`**

```java
package com.rbac.im.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.rbac.common.domain.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("im_conversation_member")
public class ImConversationMember extends BaseEntity {
    private String cid;
    private Long userId;
    private Long lastReadSeq;
    private Long mentionSeq;
    private Integer muted;
}
```

- [ ] **Step 4: 新建实体 `ImGroup.java` 与 `ImGroupMember.java`**

```java
package com.rbac.im.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.rbac.common.domain.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("im_group")
public class ImGroup extends BaseEntity {
    private String name;
    private Long ownerId;
}
```

```java
package com.rbac.im.entity;

import com.baomidou.mybatisplus.annotation.TableName;
import com.rbac.common.domain.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
@TableName("im_group_member")
public class ImGroupMember extends BaseEntity {
    private Long groupId;
    private Long userId;
    private String role;
}
```

- [ ] **Step 5: 新建 4 个 Mapper（继承 `BaseMapper`，被 `@MapperScan("com.rbac.**.mapper")` 自动扫描）**

```java
package com.rbac.im.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.rbac.im.entity.ImConversation;

public interface ImConversationMapper extends BaseMapper<ImConversation> {
}
```

同法创建 `ImConversationMemberMapper`（`BaseMapper<ImConversationMember>`）、`ImGroupMapper`（`BaseMapper<ImGroup>`）、`ImGroupMemberMapper`（`BaseMapper<ImGroupMember>`）。

- [ ] **Step 6: 写迁移 + 插入的集成测试（用现有测试库配置）**

```java
package com.rbac.im.mapper;

import com.rbac.im.entity.ImConversation;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import static org.junit.jupiter.api.Assertions.assertNotNull;

@SpringBootTest
@ActiveProfiles("test")
class ImConversationMapperTest {

    @Autowired
    private ImConversationMapper mapper;

    @Test
    void insert_then_read_by_cid() {
        ImConversation c = new ImConversation();
        c.setCid("c_1_2");
        c.setType("SINGLE");
        c.setLastMsgSeq(0L);
        mapper.insert(c);
        assertNotNull(c.getId());
    }
}
```

> 若仓库尚无 `test` profile 的 DB 配置，则沿用现有 backend 测试所用的数据源配置（与其它 `*MapperTest` 保持一致；实现时先看一个现成的 Mapper 测试怎么连库）。

- [ ] **Step 7: 运行测试**

Run: `mvn -q -pl backend -Dtest=ImConversationMapperTest test`（需本地 MySQL 已起且 Flyway 已迁移）
Expected: PASS；`im_conversation` 出现一行 `c_1_2`。

- [ ] **Step 8: Commit**

```bash
git add backend/src/main/resources/db/migration/V3__im_schema.sql backend/src/main/java/com/rbac/im backend/src/test/java/com/rbac/im
git commit -m "feat(im): 会话/成员/群 MySQL 表结构、实体与 Mapper（V3 迁移）"
```

---

## Task 5: MongoDB 消息文档 + backend 依赖接入

**Files:**
- Modify: `backend/pom.xml`（加 spring-data-mongodb、spring-kafka）
- Modify: `backend/src/main/resources/application.yml`（mongo + kafka + im 配置）
- Create: `backend/src/main/java/com/rbac/im/doc/ImMessage.java`
- Create: `backend/src/main/java/com/rbac/im/doc/ImMessageRepository.java`
- Test: `backend/src/test/java/com/rbac/im/doc/ImMessageRepositoryTest.java`

**Interfaces:**
- Produces: `ImMessage{id,cid,seq,msgId,senderId,type,body,recalled,clientMsgId,ts}`；`ImMessageRepository extends MongoRepository<ImMessage,String>` + `findByCidAndSeqGreaterThanOrderBySeqAsc(cid, seq)`、`existsBySenderIdAndClientMsgId(senderId, clientMsgId)`。

- [ ] **Step 1: `backend/pom.xml` 增加依赖**

在 `<dependencies>` 中追加：

```xml
        <!-- IM：消息存 MongoDB -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-mongodb</artifactId>
        </dependency>
        <!-- IM：网关↔logic 经 Kafka 解耦 -->
        <dependency>
            <groupId>org.springframework.kafka</groupId>
            <artifactId>spring-kafka</artifactId>
        </dependency>
```

- [ ] **Step 2: `backend/src/main/resources/application.yml` 追加配置**

在 `spring:` 下补 mongo 与 kafka（若无 `spring:` 段落层级示例，参照现有 `spring.data.redis` 缩进）：

```yaml
spring:
  data:
    mongodb:
      uri: mongodb://rbac:rbac123456@localhost:27017/rbac_im?authSource=admin
  kafka:
    bootstrap-servers: localhost:9092
    consumer:
      group-id: im-logic
      auto-offset-reset: latest
      key-deserializer: org.apache.kafka.common.serialization.StringDeserializer
      value-deserializer: org.apache.kafka.common.serialization.StringDeserializer
    producer:
      key-serializer: org.apache.kafka.common.serialization.StringSerializer
      value-serializer: org.apache.kafka.common.serialization.StringSerializer
```

并在文件末尾 `rbac:` 段补：

```yaml
rbac:
  im:
    recall-window-seconds: 120
    mention-all-admin-only: true
```

- [ ] **Step 3: 新建 `ImMessage.java`**

```java
package com.rbac.im.doc;

import lombok.Data;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.util.Map;

@Data
@Document("im_message")
@CompoundIndex(name = "cid_seq", def = "{'cid': 1, 'seq': 1}", unique = true)
public class ImMessage {
    @Id
    private String id;
    private String cid;
    private Long seq;
    private String msgId;
    private Long senderId;
    private String type;            // TEXT（本阶段）
    private Map<String, Object> body;
    private boolean recalled;
    @Indexed
    private String clientMsgId;
    private Long ts;                // epoch millis
}
```

- [ ] **Step 4: 新建 `ImMessageRepository.java`**

```java
package com.rbac.im.doc;

import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;

public interface ImMessageRepository extends MongoRepository<ImMessage, String> {

    List<ImMessage> findByCidAndSeqGreaterThanOrderBySeqAsc(String cid, Long seq);

    boolean existsBySenderIdAndClientMsgId(Long senderId, String clientMsgId);
}
```

- [ ] **Step 5: 仓库读写测试**

```java
package com.rbac.im.doc;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

@SpringBootTest
@ActiveProfiles("test")
class ImMessageRepositoryTest {

    @Autowired
    private ImMessageRepository repo;

    @Test
    void save_and_pull_incremental() {
        ImMessage m = new ImMessage();
        m.setCid("c_1_2");
        m.setSeq(1L);
        m.setMsgId("m1");
        m.setSenderId(1L);
        m.setType("TEXT");
        m.setBody(Map.of("text", "hi"));
        m.setClientMsgId("cli-1");
        m.setTs(System.currentTimeMillis());
        repo.save(m);

        List<ImMessage> got = repo.findByCidAndSeqGreaterThanOrderBySeqAsc("c_1_2", 0L);
        assertEquals(1, got.size());
        assertEquals("hi", got.get(0).getBody().get("text"));
    }
}
```

- [ ] **Step 6: 运行测试**

Run: `mvn -q -pl backend -Dtest=ImMessageRepositoryTest test`（需 `docker compose --profile im up -d` 已起 MongoDB）
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add backend/pom.xml backend/src/main/resources/application.yml backend/src/main/java/com/rbac/im/doc backend/src/test/java/com/rbac/im/doc
git commit -m "feat(im): 接入 MongoDB 消息文档与仓库，配置 Kafka/Mongo"
```

---

## Task 6: 会话服务（cid 归一 + 成员）与定序服务

**Files:**
- Create: `backend/src/main/java/com/rbac/im/service/ConversationService.java`
- Create: `backend/src/main/java/com/rbac/im/service/SeqService.java`
- Test: `backend/src/test/java/com/rbac/im/service/ConversationServiceTest.java`

**Interfaces:**
- Produces:
  - `ConversationService.singleCid(long a, long b) -> String`（归一 `c_{min}_{max}`）
  - `ConversationService.ensureSingleConversation(long a, long b) -> String`（幂等建会话+两名成员，返回 cid）
  - `ConversationService.memberUserIds(String cid) -> List<Long>`
  - `SeqService.nextSeq(String cid) -> long`（Redis `INCR im:conv:<cid>:seq`）

- [ ] **Step 1: 写 `singleCid` 归一的失败测试**

```java
package com.rbac.im.service;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

@SpringBootTest
@ActiveProfiles("test")
class ConversationServiceTest {

    @Autowired
    private ConversationService service;

    @Test
    void singleCid_is_order_independent() {
        assertEquals("c_2_5", service.singleCid(5, 2));
        assertEquals("c_2_5", service.singleCid(2, 5));
    }

    @Test
    void ensure_creates_two_members_idempotently() {
        String cid = service.ensureSingleConversation(11, 22);
        service.ensureSingleConversation(11, 22); // 再次调用不应重复建
        List<Long> members = service.memberUserIds(cid);
        assertEquals(List.of(11L, 22L), members.stream().sorted().toList());
    }
}
```

- [ ] **Step 2: 运行，确认编译失败（类不存在）**

Run: `mvn -q -pl backend -Dtest=ConversationServiceTest test`
Expected: 编译失败 `cannot find symbol ConversationService`。

- [ ] **Step 3: 实现 `SeqService.java`**

```java
package com.rbac.im.service;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

@Service
public class SeqService {

    private static final String SEQ_KEY = "im:conv:%s:seq";

    private final StringRedisTemplate redis;

    public SeqService(StringRedisTemplate redis) {
        this.redis = redis;
    }

    /** 会话内单调递增序号；Redis INCR 保证并发下唯一有序。 */
    public long nextSeq(String cid) {
        Long v = redis.opsForValue().increment(SEQ_KEY.formatted(cid));
        return v == null ? 0L : v;
    }
}
```

- [ ] **Step 4: 实现 `ConversationService.java`**

```java
package com.rbac.im.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.rbac.im.entity.ImConversation;
import com.rbac.im.entity.ImConversationMember;
import com.rbac.im.mapper.ImConversationMapper;
import com.rbac.im.mapper.ImConversationMemberMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class ConversationService {

    private final ImConversationMapper conversationMapper;
    private final ImConversationMemberMapper memberMapper;

    public ConversationService(ImConversationMapper conversationMapper,
                               ImConversationMemberMapper memberMapper) {
        this.conversationMapper = conversationMapper;
        this.memberMapper = memberMapper;
    }

    public String singleCid(long a, long b) {
        long min = Math.min(a, b);
        long max = Math.max(a, b);
        return "c_" + min + "_" + max;
    }

    @Transactional
    public String ensureSingleConversation(long a, long b) {
        String cid = singleCid(a, b);
        ImConversation existing = conversationMapper.selectOne(
                new LambdaQueryWrapper<ImConversation>().eq(ImConversation::getCid, cid));
        if (existing == null) {
            ImConversation c = new ImConversation();
            c.setCid(cid);
            c.setType("SINGLE");
            c.setLastMsgSeq(0L);
            conversationMapper.insert(c);
            insertMember(cid, a);
            insertMember(cid, b);
        }
        return cid;
    }

    private void insertMember(String cid, long userId) {
        ImConversationMember m = new ImConversationMember();
        m.setCid(cid);
        m.setUserId(userId);
        m.setLastReadSeq(0L);
        m.setMentionSeq(0L);
        m.setMuted(0);
        memberMapper.insert(m);
    }

    public List<Long> memberUserIds(String cid) {
        return memberMapper.selectList(
                        new LambdaQueryWrapper<ImConversationMember>().eq(ImConversationMember::getCid, cid))
                .stream().map(ImConversationMember::getUserId).toList();
    }
}
```

- [ ] **Step 5: 运行测试**

Run: `mvn -q -pl backend -Dtest=ConversationServiceTest test`（需 MySQL + Redis）
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add backend/src/main/java/com/rbac/im/service backend/src/test/java/com/rbac/im/service
git commit -m "feat(im): 会话归一/成员服务与 Redis 定序服务"
```

---

## Task 7: 网关↔logic 的 Kafka 消息契约

**Files:**
- Create: `backend/src/main/java/com/rbac/im/config/ImKafkaTopics.java`
- Create: `backend/src/main/java/com/rbac/im/protocol/Envelope.java`
- Create: `backend/src/main/java/com/rbac/im/protocol/OutboundPacket.java`
- Create（网关侧同结构复制）: `im-gateway/src/main/java/com/rbac/im/gateway/protocol/{Envelope,OutboundPacket}.java`

**Interfaces:**
- Produces:
  - Topic 常量：`IN = "im-inbound"`，`OUT = "im-outbound"`。
  - `Envelope{op, cid, senderId, deviceId, clientMsgId, type, body(Map), seq, ts}`：上行 `op=SEND`；下行 push 复用为 body 载荷。
  - `OutboundPacket{gatewayId, targetUserId, deviceId, envelope}`：logic → 网关的下行投递单元，Kafka key = `gatewayId`。

- [ ] **Step 1: 新建 `ImKafkaTopics.java`**

```java
package com.rbac.im.config;

public final class ImKafkaTopics {
    private ImKafkaTopics() {}
    public static final String IN = "im-inbound";
    public static final String OUT = "im-outbound";
}
```

- [ ] **Step 2: 新建 `Envelope.java`（backend 侧）**

```java
package com.rbac.im.protocol;

import lombok.Data;
import java.util.Map;

/** 网关与 logic 之间、以及推给客户端的统一消息信封（JSON）。 */
@Data
public class Envelope {
    private String op;          // SEND / PUSH / ACK
    private String cid;
    private Long senderId;
    private String deviceId;
    private String clientMsgId;
    private String type;        // TEXT
    private Map<String, Object> body;
    private Long seq;           // 定序后回填
    private String msgId;
    private Long ts;
}
```

- [ ] **Step 3: 新建 `OutboundPacket.java`（backend 侧）**

```java
package com.rbac.im.protocol;

import lombok.Data;

/** logic → 网关：把一条 Envelope 投给某网关上的某用户设备。 */
@Data
public class OutboundPacket {
    private String gatewayId;
    private Long targetUserId;
    private String deviceId;
    private Envelope envelope;
}
```

- [ ] **Step 4: 网关侧复制同结构类**

在 `im-gateway/src/main/java/com/rbac/im/gateway/protocol/` 下创建**字段完全一致**的 `Envelope` 与 `OutboundPacket`（包名 `com.rbac.im.gateway.protocol`）。两端各自用 Jackson 序列化 JSON 字符串，通过 Kafka 传递，不共享 jar。

- [ ] **Step 5: 编译校验**

Run: `mvn -q -DskipTests compile`
Expected: BUILD SUCCESS。

- [ ] **Step 6: Commit**

```bash
git add backend/src/main/java/com/rbac/im/config backend/src/main/java/com/rbac/im/protocol im-gateway/src/main/java/com/rbac/im/gateway/protocol
git commit -m "feat(im): 定义网关↔logic 的 Kafka 消息契约（Envelope/OutboundPacket）"
```

---

## Task 8: 网关 JWT 校验器（复用 secret + Redis 会话存在性）

**Files:**
- Create: `im-gateway/src/main/java/com/rbac/im/gateway/auth/GatewayJwtVerifier.java`
- Create: `im-gateway/src/main/java/com/rbac/im/gateway/auth/AuthResult.java`
- Test: `im-gateway/src/test/java/com/rbac/im/gateway/auth/GatewayJwtVerifierTest.java`

**Interfaces:**
- Produces: `GatewayJwtVerifier.verify(String token) -> AuthResult{ok, userId, jti, reason}`。规则：验签通过 + `typ=access` + 未过期 + Redis `hasKey("auth:access:"+jti)`。

- [ ] **Step 1: 写失败测试（用固定 secret 自签 token，mock Redis）**

```java
package com.rbac.im.gateway.auth;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class GatewayJwtVerifierTest {

    private static final String SECRET = "test-secret-test-secret-test-secret-32";

    private String token(String jti, long userId, String typ, long ttlMillis) {
        SecretKey key = Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8));
        Date now = new Date();
        return Jwts.builder().id(jti).subject(String.valueOf(userId))
                .claim("typ", typ).issuedAt(now)
                .expiration(new Date(now.getTime() + ttlMillis))
                .signWith(key).compact();
    }

    @Test
    void valid_access_token_with_live_session_passes() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        when(redis.hasKey("auth:access:jti1")).thenReturn(true);
        GatewayJwtVerifier v = new GatewayJwtVerifier(SECRET, redis);

        AuthResult r = v.verify(token("jti1", 7L, "access", 60_000));
        assertTrue(r.ok());
        assertEquals(7L, r.userId());
    }

    @Test
    void revoked_session_fails() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        when(redis.hasKey("auth:access:jti1")).thenReturn(false);
        GatewayJwtVerifier v = new GatewayJwtVerifier(SECRET, redis);

        assertFalse(v.verify(token("jti1", 7L, "access", 60_000)).ok());
    }

    @Test
    void wrong_type_or_bad_signature_fails() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        when(redis.hasKey(anyString())).thenReturn(true);
        GatewayJwtVerifier v = new GatewayJwtVerifier(SECRET, redis);

        assertFalse(v.verify(token("jti1", 7L, "refresh", 60_000)).ok());
        assertFalse(v.verify("garbage.token.value").ok());
    }
}
```

- [ ] **Step 2: 运行，确认失败**

Run: `mvn -q -pl im-gateway -Dtest=GatewayJwtVerifierTest test`
Expected: 编译失败（`GatewayJwtVerifier`/`AuthResult` 不存在）。

- [ ] **Step 3: 实现 `AuthResult.java`**

```java
package com.rbac.im.gateway.auth;

public record AuthResult(boolean ok, Long userId, String jti, String reason) {
    public static AuthResult ok(Long userId, String jti) {
        return new AuthResult(true, userId, jti, null);
    }
    public static AuthResult fail(String reason) {
        return new AuthResult(false, null, null, reason);
    }
}
```

- [ ] **Step 4: 实现 `GatewayJwtVerifier.java`**

```java
package com.rbac.im.gateway.auth;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;

@Component
public class GatewayJwtVerifier {

    private static final String ACCESS_KEY = "auth:access:";

    private final SecretKey key;
    private final StringRedisTemplate redis;

    public GatewayJwtVerifier(@Value("${rbac.jwt.secret}") String secret,
                              StringRedisTemplate redis) {
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.redis = redis;
    }

    public AuthResult verify(String token) {
        if (token == null || token.isBlank()) {
            return AuthResult.fail("missing token");
        }
        try {
            Claims c = Jwts.parser().verifyWith(key).build()
                    .parseSignedClaims(token).getPayload();
            if (!"access".equals(c.get("typ", String.class))) {
                return AuthResult.fail("not access token");
            }
            String jti = c.getId();
            if (!Boolean.TRUE.equals(redis.hasKey(ACCESS_KEY + jti))) {
                return AuthResult.fail("session revoked");
            }
            return AuthResult.ok(Long.valueOf(c.getSubject()), jti);
        } catch (Exception e) {
            return AuthResult.fail("invalid token: " + e.getClass().getSimpleName());
        }
    }
}
```

- [ ] **Step 5: 运行测试**

Run: `mvn -q -pl im-gateway -Dtest=GatewayJwtVerifierTest test`
Expected: PASS（3 个用例）。

- [ ] **Step 6: Commit**

```bash
git add im-gateway/src/main/java/com/rbac/im/gateway/auth im-gateway/src/test/java/com/rbac/im/gateway/auth
git commit -m "feat(im-gateway): JWT 校验器（复用 secret + Redis 会话存在性）"
```

---

## Task 9: 网关连接注册表 + Redis 路由

**Files:**
- Create: `im-gateway/src/main/java/com/rbac/im/gateway/registry/ChannelRegistry.java`
- Create: `im-gateway/src/main/java/com/rbac/im/gateway/registry/RouteService.java`
- Test: `im-gateway/src/test/java/com/rbac/im/gateway/registry/ChannelRegistryTest.java`

**Interfaces:**
- Produces:
  - `ChannelRegistry.add(long userId, String deviceId, Channel ch)` / `remove(userId, deviceId)` / `find(userId) -> Collection<Channel>`。
  - `RouteService.register(long userId, String deviceId)` / `unregister(long userId, String deviceId)` / `renew(userId)`：维护 Redis `route:user:<userId>`（Hash field=deviceId → gatewayId，带 TTL）。

- [ ] **Step 1: 写 `ChannelRegistry` 的失败测试（用 EmbeddedChannel）**

```java
package com.rbac.im.gateway.registry;

import io.netty.channel.embedded.EmbeddedChannel;
import org.junit.jupiter.api.Test;

import java.util.Collection;

import static org.junit.jupiter.api.Assertions.*;

class ChannelRegistryTest {

    @Test
    void add_find_remove() {
        ChannelRegistry reg = new ChannelRegistry();
        EmbeddedChannel ch = new EmbeddedChannel();
        reg.add(1L, "d1", ch);

        Collection<io.netty.channel.Channel> found = reg.find(1L);
        assertEquals(1, found.size());

        reg.remove(1L, "d1");
        assertTrue(reg.find(1L).isEmpty());
    }
}
```

- [ ] **Step 2: 运行，确认失败**

Run: `mvn -q -pl im-gateway -Dtest=ChannelRegistryTest test`
Expected: 编译失败（`ChannelRegistry` 不存在）。

- [ ] **Step 3: 实现 `ChannelRegistry.java`**

```java
package com.rbac.im.gateway.registry;

import io.netty.channel.Channel;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** 本机在线连接表：userId -> (deviceId -> Channel)。 */
@Component
public class ChannelRegistry {

    private final Map<Long, Map<String, Channel>> table = new ConcurrentHashMap<>();

    public void add(long userId, String deviceId, Channel ch) {
        table.computeIfAbsent(userId, k -> new ConcurrentHashMap<>()).put(deviceId, ch);
    }

    public void remove(long userId, String deviceId) {
        Map<String, Channel> devices = table.get(userId);
        if (devices != null) {
            devices.remove(deviceId);
            if (devices.isEmpty()) {
                table.remove(userId);
            }
        }
    }

    public Collection<Channel> find(long userId) {
        Map<String, Channel> devices = table.get(userId);
        return devices == null ? List.of() : devices.values();
    }

    public Channel find(long userId, String deviceId) {
        Map<String, Channel> devices = table.get(userId);
        return devices == null ? null : devices.get(deviceId);
    }
}
```

- [ ] **Step 4: 实现 `RouteService.java`**

```java
package com.rbac.im.gateway.registry;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.util.concurrent.TimeUnit;

/** Redis 路由：route:user:<userId> 为 Hash，field=deviceId，value=gatewayId，带 TTL 靠心跳续期。 */
@Component
public class RouteService {

    private static final String ROUTE_KEY = "route:user:";
    private static final long TTL_SECONDS = 120;

    private final StringRedisTemplate redis;
    private final String gatewayId;

    public RouteService(StringRedisTemplate redis,
                        @Value("${im.gateway.id}") String gatewayId) {
        this.redis = redis;
        this.gatewayId = gatewayId;
    }

    public void register(long userId, String deviceId) {
        String key = ROUTE_KEY + userId;
        redis.opsForHash().put(key, deviceId, gatewayId);
        redis.expire(key, TTL_SECONDS, TimeUnit.SECONDS);
    }

    public void unregister(long userId, String deviceId) {
        redis.opsForHash().delete(ROUTE_KEY + userId, deviceId);
    }

    public void renew(long userId) {
        redis.expire(ROUTE_KEY + userId, TTL_SECONDS, TimeUnit.SECONDS);
    }
}
```

- [ ] **Step 5: 运行测试**

Run: `mvn -q -pl im-gateway -Dtest=ChannelRegistryTest test`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add im-gateway/src/main/java/com/rbac/im/gateway/registry im-gateway/src/test/java/com/rbac/im/gateway/registry
git commit -m "feat(im-gateway): 本机连接表与 Redis 路由服务"
```

---

## Task 10: Netty WebSocket 服务 + 握手鉴权 + 心跳

**Files:**
- Create: `im-gateway/src/main/java/com/rbac/im/gateway/netty/HandshakeAuthHandler.java`
- Create: `im-gateway/src/main/java/com/rbac/im/gateway/netty/ImFrameHandler.java`
- Create: `im-gateway/src/main/java/com/rbac/im/gateway/netty/WebSocketChannelInitializer.java`
- Create: `im-gateway/src/main/java/com/rbac/im/gateway/netty/NettyWebSocketServer.java`
- Create: `im-gateway/src/main/java/com/rbac/im/gateway/kafka/InboundProducer.java`

**Interfaces:**
- Consumes: `GatewayJwtVerifier`（Task 8）、`ChannelRegistry`/`RouteService`（Task 9）、`Envelope`（Task 7）、`InboundProducer`（本 Task）。
- Produces: 启动后监听 `im.gateway.ws-port`；`ws://host:port/im?token=&deviceId=` 握手；鉴权通过注册路由，收到 `op=SEND` 文本帧 → `InboundProducer.send(envelope)` 投 Kafka `im-inbound`。Channel 属性 key：`AttributeKey<Long> USER_ID`、`AttributeKey<String> DEVICE_ID`（定义在 `HandshakeAuthHandler`）。

- [ ] **Step 1: 实现 `InboundProducer.java`**

```java
package com.rbac.im.gateway.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.gateway.protocol.Envelope;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

@Component
public class InboundProducer {

    private static final String TOPIC = "im-inbound";

    private final KafkaTemplate<String, String> kafka;
    private final ObjectMapper mapper = new ObjectMapper();

    public InboundProducer(KafkaTemplate<String, String> kafka) {
        this.kafka = kafka;
    }

    /** key = cid 保证同会话进同一分区、分区内有序。 */
    public void send(Envelope env) {
        try {
            kafka.send(TOPIC, env.getCid(), mapper.writeValueAsString(env));
        } catch (Exception e) {
            throw new IllegalStateException("serialize envelope failed", e);
        }
    }
}
```

- [ ] **Step 2: 实现 `HandshakeAuthHandler.java`（HTTP 升级前拦截鉴权）**

```java
package com.rbac.im.gateway.netty;

import com.rbac.im.gateway.auth.AuthResult;
import com.rbac.im.gateway.auth.GatewayJwtVerifier;
import com.rbac.im.gateway.registry.ChannelRegistry;
import com.rbac.im.gateway.registry.RouteService;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.SimpleChannelInboundHandler;
import io.netty.handler.codec.http.*;
import io.netty.util.AttributeKey;

import java.net.URI;
import java.util.HashMap;
import java.util.Map;

/** 在 WebSocket 升级前读取 ?token=&deviceId=，校验失败直接 401 关闭。 */
public class HandshakeAuthHandler extends SimpleChannelInboundHandler<HttpRequest> {

    public static final AttributeKey<Long> USER_ID = AttributeKey.valueOf("imUserId");
    public static final AttributeKey<String> DEVICE_ID = AttributeKey.valueOf("imDeviceId");

    private final GatewayJwtVerifier verifier;
    private final ChannelRegistry registry;
    private final RouteService routeService;

    public HandshakeAuthHandler(GatewayJwtVerifier verifier,
                                ChannelRegistry registry,
                                RouteService routeService) {
        this.verifier = verifier;
        this.registry = registry;
        this.routeService = routeService;
    }

    @Override
    protected void channelRead0(ChannelHandlerContext ctx, HttpRequest req) {
        Map<String, String> q = parseQuery(req.uri());
        AuthResult r = verifier.verify(q.get("token"));
        if (!r.ok()) {
            reject(ctx);
            return;
        }
        String deviceId = q.getOrDefault("deviceId", "default");
        ctx.channel().attr(USER_ID).set(r.userId());
        ctx.channel().attr(DEVICE_ID).set(deviceId);
        registry.add(r.userId(), deviceId, ctx.channel());
        routeService.register(r.userId(), deviceId);
        // 重置 uri 到纯路径，交给后续 WebSocketServerProtocolHandler 完成升级
        req.setUri(URI.create(req.uri()).getPath());
        ctx.pipeline().remove(this);
        ctx.fireChannelRead(io.netty.util.ReferenceCountUtil.retain(req));
    }

    private void reject(ChannelHandlerContext ctx) {
        FullHttpResponse resp = new DefaultFullHttpResponse(
                HttpVersion.HTTP_1_1, HttpResponseStatus.UNAUTHORIZED);
        resp.headers().set(HttpHeaderNames.CONTENT_LENGTH, 0);
        ctx.writeAndFlush(resp).addListener(f -> ctx.close());
    }

    private Map<String, String> parseQuery(String uri) {
        Map<String, String> m = new HashMap<>();
        int i = uri.indexOf('?');
        if (i < 0) return m;
        for (String pair : uri.substring(i + 1).split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0) {
                m.put(pair.substring(0, eq),
                        java.net.URLDecoder.decode(pair.substring(eq + 1), java.nio.charset.StandardCharsets.UTF_8));
            }
        }
        return m;
    }
}
```

- [ ] **Step 3: 实现 `ImFrameHandler.java`（收 WS 帧 + 断线清理 + 心跳）**

```java
package com.rbac.im.gateway.netty;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.gateway.kafka.InboundProducer;
import com.rbac.im.gateway.protocol.Envelope;
import com.rbac.im.gateway.registry.ChannelRegistry;
import com.rbac.im.gateway.registry.RouteService;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.SimpleChannelInboundHandler;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import io.netty.handler.timeout.IdleStateEvent;

public class ImFrameHandler extends SimpleChannelInboundHandler<TextWebSocketFrame> {

    private final InboundProducer inboundProducer;
    private final ChannelRegistry registry;
    private final RouteService routeService;
    private final ObjectMapper mapper = new ObjectMapper();

    public ImFrameHandler(InboundProducer inboundProducer,
                          ChannelRegistry registry,
                          RouteService routeService) {
        this.inboundProducer = inboundProducer;
        this.registry = registry;
        this.routeService = routeService;
    }

    @Override
    protected void channelRead0(ChannelHandlerContext ctx, TextWebSocketFrame frame) throws Exception {
        Long userId = ctx.channel().attr(HandshakeAuthHandler.USER_ID).get();
        String deviceId = ctx.channel().attr(HandshakeAuthHandler.DEVICE_ID).get();
        Envelope env = mapper.readValue(frame.text(), Envelope.class);
        if ("SEND".equals(env.getOp())) {
            env.setSenderId(userId);       // 以连接身份为准，忽略客户端伪造
            env.setDeviceId(deviceId);
            inboundProducer.send(env);
            // 立即回执：告诉客户端服务器已接收（seq 稍后由推送带回）
            Envelope ack = new Envelope();
            ack.setOp("ACK");
            ack.setClientMsgId(env.getClientMsgId());
            ack.setCid(env.getCid());
            ctx.writeAndFlush(new TextWebSocketFrame(mapper.writeValueAsString(ack)));
        }
    }

    @Override
    public void userEventTriggered(ChannelHandlerContext ctx, Object evt) {
        if (evt instanceof IdleStateEvent) {
            ctx.close();   // 心跳超时，关闭连接
        }
    }

    @Override
    public void channelInactive(ChannelHandlerContext ctx) {
        Long userId = ctx.channel().attr(HandshakeAuthHandler.USER_ID).get();
        String deviceId = ctx.channel().attr(HandshakeAuthHandler.DEVICE_ID).get();
        if (userId != null && deviceId != null) {
            registry.remove(userId, deviceId);
            routeService.unregister(userId, deviceId);
        }
    }
}
```

- [ ] **Step 4: 实现 `WebSocketChannelInitializer.java`**

```java
package com.rbac.im.gateway.netty;

import com.rbac.im.gateway.auth.GatewayJwtVerifier;
import com.rbac.im.gateway.kafka.InboundProducer;
import com.rbac.im.gateway.registry.ChannelRegistry;
import com.rbac.im.gateway.registry.RouteService;
import io.netty.channel.ChannelInitializer;
import io.netty.channel.socket.SocketChannel;
import io.netty.handler.codec.http.HttpObjectAggregator;
import io.netty.handler.codec.http.HttpServerCodec;
import io.netty.handler.codec.http.websocketx.WebSocketServerProtocolHandler;
import io.netty.handler.timeout.IdleStateHandler;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class WebSocketChannelInitializer extends ChannelInitializer<SocketChannel> {

    private final GatewayJwtVerifier verifier;
    private final ChannelRegistry registry;
    private final RouteService routeService;
    private final InboundProducer inboundProducer;
    private final int idleSeconds;

    public WebSocketChannelInitializer(GatewayJwtVerifier verifier,
                                       ChannelRegistry registry,
                                       RouteService routeService,
                                       InboundProducer inboundProducer,
                                       @Value("${im.gateway.heartbeat-idle-seconds}") int idleSeconds) {
        this.verifier = verifier;
        this.registry = registry;
        this.routeService = routeService;
        this.inboundProducer = inboundProducer;
        this.idleSeconds = idleSeconds;
    }

    @Override
    protected void initChannel(SocketChannel ch) {
        ch.pipeline()
                .addLast(new HttpServerCodec())
                .addLast(new HttpObjectAggregator(65536))
                .addLast(new HandshakeAuthHandler(verifier, registry, routeService))
                .addLast(new WebSocketServerProtocolHandler("/im"))
                .addLast(new IdleStateHandler(idleSeconds, 0, 0))
                .addLast(new ImFrameHandler(inboundProducer, registry, routeService));
    }
}
```

- [ ] **Step 5: 实现 `NettyWebSocketServer.java`（Spring 生命周期内启动/停止）**

```java
package com.rbac.im.gateway.netty;

import io.netty.bootstrap.ServerBootstrap;
import io.netty.channel.ChannelFuture;
import io.netty.channel.ChannelOption;
import io.netty.channel.EventLoopGroup;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.nio.NioServerSocketChannel;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

@Component
public class NettyWebSocketServer {

    private static final Logger log = LoggerFactory.getLogger(NettyWebSocketServer.class);

    private final WebSocketChannelInitializer initializer;
    private final int port;

    private EventLoopGroup boss;
    private EventLoopGroup worker;
    private ChannelFuture channelFuture;

    public NettyWebSocketServer(WebSocketChannelInitializer initializer,
                                @Value("${im.gateway.ws-port}") int port) {
        this.initializer = initializer;
        this.port = port;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void start() throws InterruptedException {
        boss = new NioEventLoopGroup(1);
        worker = new NioEventLoopGroup();
        ServerBootstrap b = new ServerBootstrap();
        b.group(boss, worker)
                .channel(NioServerSocketChannel.class)
                .option(ChannelOption.SO_BACKLOG, 1024)
                .childOption(ChannelOption.SO_KEEPALIVE, true)
                .childHandler(initializer);
        channelFuture = b.bind(port).sync();
        log.info("IM Netty WebSocket 网关已监听端口 {}", port);
    }

    @PreDestroy
    public void stop() {
        if (channelFuture != null) channelFuture.channel().close();
        if (boss != null) boss.shutdownGracefully();
        if (worker != null) worker.shutdownGracefully();
    }
}
```

- [ ] **Step 6: 编译校验**

Run: `mvn -q -pl im-gateway -DskipTests compile`
Expected: BUILD SUCCESS。

- [ ] **Step 7: 手工端到端验证握手鉴权**

前置：`docker compose --profile im --profile full up -d`（Redis/Kafka）；起 backend（登录拿 access token）；起网关 `mvn -q -pl im-gateway spring-boot:run`。
用 `websocat` 验证：
- 无 token：`websocat "ws://localhost:9001/im"` → 连接被 401 拒绝。
- 有效 token：`websocat "ws://localhost:9001/im?token=<accessToken>&deviceId=d1"` → 连接建立；`redis-cli hgetall route:user:<userId>` 显示 `d1 -> gw1`。
- 断开后：`route:user:<userId>` 中 `d1` 字段被删除。

- [ ] **Step 8: Commit**

```bash
git add im-gateway/src/main/java/com/rbac/im/gateway/netty im-gateway/src/main/java/com/rbac/im/gateway/kafka/InboundProducer.java
git commit -m "feat(im-gateway): Netty WS 服务、握手鉴权、心跳与路由注册"
```

---

## Task 11: im-logic 入站消费 → 定序落库 → 出站投递

**Files:**
- Create: `backend/src/main/java/com/rbac/im/service/OutboundDispatcher.java`
- Create: `backend/src/main/java/com/rbac/im/service/InboundMessageConsumer.java`
- Test: `backend/src/test/java/com/rbac/im/service/InboundMessageConsumerTest.java`

**Interfaces:**
- Consumes: `SeqService`、`ConversationService`（Task 6）、`ImMessageRepository`（Task 5）、`Envelope`/`OutboundPacket`/`ImKafkaTopics`（Task 7）。
- Produces:
  - `OutboundDispatcher.dispatch(String cid, Envelope pushEnv)`：查成员 → 查 Redis 路由 → 按 gatewayId 发 `im-outbound`（key=gatewayId）。
  - `InboundMessageConsumer.onMessage(String json)`：`@KafkaListener(topics=IN)` → 幂等去重 → 定序 → 存 Mongo → 更新会话 → 调 `dispatch`。

- [ ] **Step 1: 写 `InboundMessageConsumer` 的核心逻辑测试（mock 依赖，验证定序+落库+去重）**

```java
package com.rbac.im.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.doc.ImMessage;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.protocol.Envelope;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.mockito.Mockito.*;

class InboundMessageConsumerTest {

    private final ImMessageRepository repo = mock(ImMessageRepository.class);
    private final SeqService seqService = mock(SeqService.class);
    private final ConversationService conversationService = mock(ConversationService.class);
    private final OutboundDispatcher dispatcher = mock(OutboundDispatcher.class);
    private final ObjectMapper mapper = new ObjectMapper();

    private String json(String clientMsgId) throws Exception {
        Envelope e = new Envelope();
        e.setOp("SEND");
        e.setCid("c_1_2");
        e.setSenderId(1L);
        e.setType("TEXT");
        e.setClientMsgId(clientMsgId);
        e.setBody(Map.of("text", "hi"));
        return mapper.writeValueAsString(e);
    }

    @Test
    void assigns_seq_persists_and_dispatches() throws Exception {
        when(repo.existsBySenderIdAndClientMsgId(1L, "cli-1")).thenReturn(false);
        when(seqService.nextSeq("c_1_2")).thenReturn(5L);
        InboundMessageConsumer c = new InboundMessageConsumer(repo, seqService, conversationService, dispatcher);

        c.onMessage(json("cli-1"));

        verify(seqService).nextSeq("c_1_2");
        verify(repo).save(argThat((ImMessage m) -> m.getSeq() == 5L && "TEXT".equals(m.getType())));
        verify(dispatcher).dispatch(eq("c_1_2"), argThat(env -> env.getSeq() == 5L && "PUSH".equals(env.getOp())));
    }

    @Test
    void duplicate_clientMsgId_is_skipped() throws Exception {
        when(repo.existsBySenderIdAndClientMsgId(1L, "cli-1")).thenReturn(true);
        InboundMessageConsumer c = new InboundMessageConsumer(repo, seqService, conversationService, dispatcher);

        c.onMessage(json("cli-1"));

        verify(seqService, never()).nextSeq(anyString());
        verify(repo, never()).save(any());
    }
}
```

- [ ] **Step 2: 运行，确认失败**

Run: `mvn -q -pl backend -Dtest=InboundMessageConsumerTest test`
Expected: 编译失败（类不存在）。

- [ ] **Step 3: 实现 `OutboundDispatcher.java`**

```java
package com.rbac.im.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.config.ImKafkaTopics;
import com.rbac.im.protocol.Envelope;
import com.rbac.im.protocol.OutboundPacket;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

@Service
public class OutboundDispatcher {

    private final ConversationService conversationService;
    private final StringRedisTemplate redis;
    private final KafkaTemplate<String, String> kafka;
    private final ObjectMapper mapper = new ObjectMapper();

    public OutboundDispatcher(ConversationService conversationService,
                              StringRedisTemplate redis,
                              KafkaTemplate<String, String> kafka) {
        this.conversationService = conversationService;
        this.redis = redis;
        this.kafka = kafka;
    }

    /** 查会话成员 → 查 Redis 路由 → 逐设备投到目标网关。离线（无路由）则跳过，等增量拉取。 */
    public void dispatch(String cid, Envelope pushEnv) {
        List<Long> members = conversationService.memberUserIds(cid);
        for (Long uid : members) {
            Map<Object, Object> routes = redis.opsForHash().entries("route:user:" + uid);
            for (Map.Entry<Object, Object> e : routes.entrySet()) {
                String deviceId = String.valueOf(e.getKey());
                String gatewayId = String.valueOf(e.getValue());
                OutboundPacket packet = new OutboundPacket();
                packet.setGatewayId(gatewayId);
                packet.setTargetUserId(uid);
                packet.setDeviceId(deviceId);
                packet.setEnvelope(pushEnv);
                send(gatewayId, packet);
            }
        }
    }

    private void send(String gatewayId, OutboundPacket packet) {
        try {
            kafka.send(ImKafkaTopics.OUT, gatewayId, mapper.writeValueAsString(packet));
        } catch (Exception ex) {
            throw new IllegalStateException("serialize outbound failed", ex);
        }
    }
}
```

- [ ] **Step 4: 实现 `InboundMessageConsumer.java`**

```java
package com.rbac.im.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.config.ImKafkaTopics;
import com.rbac.im.doc.ImMessage;
import com.rbac.im.doc.ImMessageRepository;
import com.rbac.im.protocol.Envelope;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

import java.util.UUID;

@Service
public class InboundMessageConsumer {

    private final ImMessageRepository repo;
    private final SeqService seqService;
    private final ConversationService conversationService;
    private final OutboundDispatcher dispatcher;
    private final ObjectMapper mapper = new ObjectMapper();

    public InboundMessageConsumer(ImMessageRepository repo,
                                  SeqService seqService,
                                  ConversationService conversationService,
                                  OutboundDispatcher dispatcher) {
        this.repo = repo;
        this.seqService = seqService;
        this.conversationService = conversationService;
        this.dispatcher = dispatcher;
    }

    @KafkaListener(topics = ImKafkaTopics.IN, groupId = "im-logic")
    public void onMessage(String json) throws Exception {
        Envelope env = mapper.readValue(json, Envelope.class);

        // 幂等：同一发送者 + clientMsgId 只处理一次
        if (env.getClientMsgId() != null
                && repo.existsBySenderIdAndClientMsgId(env.getSenderId(), env.getClientMsgId())) {
            return;
        }

        long seq = seqService.nextSeq(env.getCid());
        String msgId = UUID.randomUUID().toString().replace("-", "");
        long ts = System.currentTimeMillis();

        ImMessage m = new ImMessage();
        m.setCid(env.getCid());
        m.setSeq(seq);
        m.setMsgId(msgId);
        m.setSenderId(env.getSenderId());
        m.setType(env.getType());
        m.setBody(env.getBody());
        m.setClientMsgId(env.getClientMsgId());
        m.setTs(ts);
        repo.save(m);

        // 组装下行 PUSH 信封
        Envelope push = new Envelope();
        push.setOp("PUSH");
        push.setCid(env.getCid());
        push.setSenderId(env.getSenderId());
        push.setType(env.getType());
        push.setBody(env.getBody());
        push.setClientMsgId(env.getClientMsgId());
        push.setSeq(seq);
        push.setMsgId(msgId);
        push.setTs(ts);

        dispatcher.dispatch(env.getCid(), push);
    }
}
```

- [ ] **Step 5: 运行单元测试**

Run: `mvn -q -pl backend -Dtest=InboundMessageConsumerTest test`
Expected: PASS（2 个用例）。

- [ ] **Step 6: Commit**

```bash
git add backend/src/main/java/com/rbac/im/service/OutboundDispatcher.java backend/src/main/java/com/rbac/im/service/InboundMessageConsumer.java backend/src/test/java/com/rbac/im/service/InboundMessageConsumerTest.java
git commit -m "feat(im): 入站消费定序落库 + 出站按路由投递"
```

---

## Task 12: 网关出站消费 → 推达在线 Channel（打通闭环）

**Files:**
- Create: `im-gateway/src/main/java/com/rbac/im/gateway/kafka/OutboundConsumer.java`
- Test（手工端到端）: 见 Step 3

**Interfaces:**
- Consumes: `OutboundPacket`（Task 7 网关侧）、`ChannelRegistry`（Task 9）。
- Produces: `@KafkaListener(topics="im-outbound")`：只处理 `gatewayId == 本机 im.gateway.id` 的包；找本机 Channel → 推 `TextWebSocketFrame`（envelope JSON）；找不到（用户已下线）则丢弃。

- [ ] **Step 1: 实现 `OutboundConsumer.java`**

```java
package com.rbac.im.gateway.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.rbac.im.gateway.protocol.OutboundPacket;
import com.rbac.im.gateway.registry.ChannelRegistry;
import io.netty.channel.Channel;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

@Component
public class OutboundConsumer {

    private final ChannelRegistry registry;
    private final String gatewayId;
    private final ObjectMapper mapper = new ObjectMapper();

    public OutboundConsumer(ChannelRegistry registry,
                            @Value("${im.gateway.id}") String gatewayId) {
        this.registry = registry;
        this.gatewayId = gatewayId;
    }

    @KafkaListener(topics = "im-outbound", groupId = "im-gateway-${im.gateway.id}")
    public void onOutbound(String json) throws Exception {
        OutboundPacket packet = mapper.readValue(json, OutboundPacket.class);
        if (!gatewayId.equals(packet.getGatewayId())) {
            return;   // 不是发给本网关的
        }
        Channel ch = registry.find(packet.getTargetUserId(), packet.getDeviceId());
        if (ch != null && ch.isActive()) {
            ch.writeAndFlush(new TextWebSocketFrame(
                    mapper.writeValueAsString(packet.getEnvelope())));
        }
    }
}
```

> 说明：`im-outbound` 用 gatewayId 作 key，但每个网关实例是独立 consumer group（`im-gateway-<id>`），都会收到全部分区；靠 `gatewayId` 判断过滤本机。后续可优化为每网关独立 topic 避免无效消费。

- [ ] **Step 2: 整仓构建**

Run: `mvn -q -DskipTests package`
Expected: BUILD SUCCESS（两模块）。

- [ ] **Step 3: 端到端闭环手工验证**

前置：`docker compose --profile im --profile full up -d`（MySQL/Redis/Kafka/MongoDB）；backend、im-gateway 各起一个实例。
准备两个用户 A、B（用现有 `/api/auth/login` 各拿 access token）；先建单聊会话（可临时加一个建会话接口或直接调 `ConversationService.ensureSingleConversation` 的测试端点，A/B 的 userId 已知）。

步骤：
1. B 连 `ws://localhost:9001/im?token=<B_token>&deviceId=d1`（保持）。
2. A 连 `ws://localhost:9001/im?token=<A_token>&deviceId=d1`，发送：
   `{"op":"SEND","cid":"c_<Aid>_<Bid>","type":"TEXT","clientMsgId":"cli-1","body":{"text":"hello B"}}`
3. 预期：A 立刻收到 `{"op":"ACK","clientMsgId":"cli-1",...}`；B 收到 `{"op":"PUSH","seq":1,"body":{"text":"hello B"},...}`。
4. `mongosh` 查 `rbac_im.im_message`：存在一条 `cid=c_<Aid>_<Bid>, seq=1`。
5. 重复发送相同 `clientMsgId=cli-1`：Mongo 不新增、B 不重复收到（幂等生效）。

- [ ] **Step 4: Commit**

```bash
git add im-gateway/src/main/java/com/rbac/im/gateway/kafka/OutboundConsumer.java
git commit -m "feat(im-gateway): 出站消费推达在线连接，打通单聊文本闭环"
```

---

## 阶段收尾 / 下一阶段

本阶段完成后，系统具备：多模块工程、鉴权长连接、单聊文本端到端实时收发、消息定序落库、发送幂等。**下一阶段计划（另起文档）**依序覆盖 spec 里剩余里程碑：

- Phase 2：离线 + 多端同步（`pull(cid, sinceSeq)` 增量拉取）
- Phase 3：群聊（群会话 + 成员扇出）
- Phase 4：富媒体（MinIO 预签名上传/回显，IMAGE/AUDIO/FILE）
- Phase 5：链接卡片（OG 抓取 + SSRF 防护）
- Phase 6：撤回（RECALL 控制消息 + 时间窗口/权限）
- Phase 7：@提及（mentions/mentionAll + mention_seq + "有人@我"）
- Phase 8：已读未读（last_read_seq + 已读回执）
- Phase 9：压测（N 万连接 + QPS 观测报告）

---

## Self-Review 记录

- **Spec 覆盖**：本阶段对应 spec 里程碑 1~3（多模块/中间件/骨架、握手鉴权、单聊文本闭环）。富媒体/链接/撤回/@/已读/群聊/离线均明确留到后续 Phase，未遗漏。
- **占位符**：无 TBD/TODO；每个改代码的 Step 均给出完整代码与可执行命令。
- **类型一致性**：`Envelope`/`OutboundPacket` 字段在 Task 7 定义，Task 10/11/12 一致使用（`op/cid/senderId/deviceId/clientMsgId/type/body/seq/msgId/ts`；`gatewayId/targetUserId/deviceId/envelope`）；`SeqService.nextSeq`、`ConversationService.memberUserIds/ensureSingleConversation/singleCid`、`ImMessageRepository.existsBySenderIdAndClientMsgId/findByCidAndSeqGreaterThanOrderBySeqAsc`、`ChannelRegistry.add/remove/find`、`RouteService.register/unregister/renew`、`GatewayJwtVerifier.verify`/`AuthResult` 在各 Task 间签名一致。
- **已知取舍（非阻塞）**：`im-outbound` 各网关全量消费后按 gatewayId 过滤，后续可改每网关独立 topic；建单聊会话在本阶段靠测试端点/直调 service，正式建会话/建群接口在群聊 Phase 补。
