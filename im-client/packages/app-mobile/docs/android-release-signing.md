# Android Release 签名证书

此文档包含 Android 发布签名凭据。请勿将证书或本文档上传到公开仓库、发送至公共群组，或写入应用代码。

| 项目 | 值 |
| --- | --- |
| 包名 | `com.rayim.eureka32.app` |
| 证书文件 | `android/app/eureka32-release.keystore` |
| 格式 | PKCS#12 |
| 别名 | `eureka32-release` |
| 证书算法 | RSA 4096 / SHA256withRSA |
| 有效期 | 10,000 天 |
| 存储库密码 | `4c547d1defce63828b755a1e9dc8ee0115a1643fb7d5e1ab` |
| 私钥密码 | `4c547d1defce63828b755a1e9dc8ee0115a1643fb7d5e1ab` |

> PKCS#12 格式使用同一个密码保护存储库与私钥。

可通过以下命令检查证书信息：

```bash
cd im-client/packages/app-mobile/android
keytool -list -v -keystore app/eureka32-release.keystore -alias eureka32-release
```
