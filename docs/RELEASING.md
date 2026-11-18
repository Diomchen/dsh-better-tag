# 发布

## 当前流程（tag 触发，npm Trusted Publishing）

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
   - 通过 **OIDC** 发布到 npm（`npm publish --provenance`），不需要任何长期 token。

当前 npm 包的 Trusted Publisher 配置（2026-11-18 创建）：

| 字段 | 值 |
| --- | --- |
| 类型 | GitHub Actions |
| 仓库 | `Diomchen/dsh-better-tag` |
| 工作流 | `release.yml` |
| 允许的操作 | `publish`、`stage publish` |
| trust id | `3c33835b-7de7-494e-88fc-243efae7d591` |

仓库 Secret 里的 `NPM_TOKEN` 已删除；发布链路只依赖 GitHub Actions 的
`id-token: write` 权限和上面的信任关系。

> 首次发布新包时 npm 可能先给一个 `0.0.0-stage` 占位版本做审核，通常一两分钟后自动替换成正式版本。

## 重建 Trusted Publisher（换仓库/工作流时）

1. npm 账户必须启用 **2FA**：npm 已不支持新配置 TOTP，只能用
   **Security key / Passkey**（macOS 可用 Touch ID）：
   npmjs.com → 账户 → Two-Factor Authentication → Security key → Continue。
2. npmjs.com → `dsh-better-tag` 包设置 → **Trusted Publisher** → **GitHub Actions**，
   填入上表的仓库和 `release.yml`，勾选允许 `npm publish`。
3. 确认 workflow 里有：

   ```yaml
   permissions:
     contents: write
     id-token: write
   ```

4. 推一个 `v*` tag 验证：Actions 日志里应看到 npm 从 OIDC 换取凭证，
   而不是读取 token。

## 常见问题

- **`403 Please enable 2fa for your account`**：账户没有真正的 2FA 认证器。
  邮箱验证码不算；需要在 npmjs.com 添加 Security key。
- **`EOTP ... Open this URL in your browser`**：CLI 需要一次 2FA 授权，
  在浏览器里用 Touch ID 完成后重试。
- **`npm publish` 报 404 / 401**：检查 Trusted Publisher 的仓库名、工作流文件名
  是否和本仓库完全一致（大小写敏感）。
