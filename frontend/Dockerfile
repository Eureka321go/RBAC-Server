# ---- 构建阶段：npm 打出静态文件 ----
# 指定"从哪个基础镜像开始"，先找一个半成品打底，别从零开始
FROM node:22 AS build
# 设定之后命令的工作目录，"cd 到这个目录再干活"
WORKDIR /app
# 在构建镜像时执行一条命令
# npm 走国内镜像，加速依赖下载
RUN npm config set registry https://registry.npmmirror.com
#把宿主机的文件拷进镜像
COPY package*.json ./
RUN npm ci
COPY . .
# build-only 只跑 vite build（跳过 type-check，首次部署更省心）
RUN npm run build-only

# ---- 运行阶段：nginx 发静态文件 + 反代后端 ----
FROM nginx:1.27
COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html
#声明容器会用哪个端口
EXPOSE 80
