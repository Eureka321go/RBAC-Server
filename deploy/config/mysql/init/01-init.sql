-- MySQL 容器首次启动时自动执行（仅空数据卷时运行一次）
-- 确保数据库字符集为 utf8mb4，并给应用账号授权

CREATE DATABASE IF NOT EXISTS `rbac`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

-- rbac 账号已由 compose 的 MYSQL_USER 创建，这里补充授权
GRANT ALL PRIVILEGES ON `rbac`.* TO 'rbac'@'%';
FLUSH PRIVILEGES;
