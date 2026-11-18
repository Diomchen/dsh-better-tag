# 发布

## 当前流程（tag 触发）

1. 改 `package.json` 的 `version`，提交到 `main`。
2. 打 tag 并推送：

   ```sh
   git tag -a v0.1.1 -m "dsh-better-tag 0.1.1"
   git push origin main v0.1.1
   ```

3. [`.github/workflows/release.yml`](../.github/workflows/release.yml) 会：
   - 校验 tag 与 `package.json` 版本一致；
   - 跑 `npm test` / `npm run check`；
   - 打 tarball，建 GitHub Release 并附上 tarball；
   - `npm publish --provenance --access public`。

当前 npm 发布用仓库 Secret `NPM_TOKEN`（npm 的 granular “Publish” token）。首次发布会给一个
`0.0.0-stage` 占位版本做审核，通常一两分钟后自动替换成正式版本。

## 迁移到 npm Trusted Publishing（推荐）

Trusted Publishing 不再需要长期 token，GitHub Actions 用 OIDC 换短时凭证发布。npm 会从
2027-01 起限制绕过 2FA 的 token 直接发布，所以这条迁移迟早要做。

### 前置条件：启用正式 2FA

**邮箱验证码不算**。npm 的 Trusted Publisher 接口要求账户启用 TOTP 或安全密钥，否则会返回：

```json
{"message":"Please enable 2fa for your account"}
```

两种启用方式：

- **安全密钥 / Passkey（最快）**：npmjs.com → 账户 → Two-Factor Authentication → Security key →
  Continue，用 macOS 的 Touch ID 或硬件密钥注册。
- **认证器 App（TOTP）**：在自己的终端跑
  `npx npm@11.15.0 profile enable-2fa auth-and-writes`，输入账户密码，扫描终端二维码并保存恢复码。
  （CLI 会要求账户密码，不要把密码交给别人代跑。）

### 配置 Trusted Publisher

npmjs.com → `dsh-better-tag` 包设置 → **Trusted Publisher** → **GitHub Actions**：

| 字段 | 值 |
| --- | --- |
| Organization or user | `Diomchen` |
| Repository | `dsh-better-tag` |
| Workflow filename | `release.yml` |
| Environment name | 留空 |
| Allowed actions | 勾选 `npm publish`（`npm stage publish` 默认允许） |

### 删掉 token 并验证

1. 删除仓库 Secret `NPM_TOKEN`（Settings → Secrets and variables → Actions）。
2. 把 `release.yml` 里 `NPM_TOKEN` 的注释与 env 更新为 OIDC 说明（可选；secret 不存在时
   `NODE_AUTH_TOKEN` 为空，npm 会自动走 OIDC）。
3. 发一个 patch tag 验证整条链路：Actions 里应看到 npm 以 OIDC 发布，npm 包详情会出现
   provenance 徽章。

> 本仓库的 release workflow 已使用 Node 24（自带 npm 11 ≥ 11.5.1），满足 Trusted Publishing
> 对 npm CLI 版本的要求；`id-token: write` 权限也已声明。
