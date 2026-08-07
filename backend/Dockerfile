# ---- 构建阶段：用 Maven 打出可执行 jar ----
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
# Docker 构建使用 Maven Central。Firebase Admin 的 Google BOM 依赖树较大，
# 在部分镜像站会出现大量小文件的高延迟下载。
COPY pom.xml .
COPY backend/pom.xml backend/pom.xml
COPY im-gateway/pom.xml im-gateway/pom.xml
COPY backend/src backend/src
RUN mvn -B -pl backend -am clean package -DskipTests

# ---- 运行阶段：精简 JRE 跑 jar ----
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/backend/target/rbac-server-0.0.1-SNAPSHOT.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
