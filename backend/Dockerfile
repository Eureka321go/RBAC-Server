# ---- 构建阶段：用 Maven 打出可执行 jar ----
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
# 阿里云 Maven 镜像，加速依赖下载
COPY settings.xml /root/.m2/settings.xml
COPY pom.xml .
COPY src ./src
RUN mvn -B clean package -DskipTests

# ---- 运行阶段：精简 JRE 跑 jar ----
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/target/rbac-server-0.0.1-SNAPSHOT.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
