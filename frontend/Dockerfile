# ---- 构建阶段：npm 打出静态文件 ----
FROM node:22 AS build
WORKDIR /app
# npm 走国内镜像，加速依赖下载
RUN npm config set registry https://registry.npmmirror.com
COPY package*.json ./
RUN npm ci
COPY . .
# build-only 只跑 vite build（跳过 type-check，首次部署更省心）
RUN npm run build-only

# ---- 运行阶段：nginx 发静态文件 + 反代后端 ----
FROM nginx:1.27
COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
