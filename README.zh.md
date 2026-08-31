# DeepSeek Harness 版 Sublyx Image

中文 | [English](README.md)

这是一个面向 DSH/Cordis 的 `api.sublyx.org` 图像插件。

插件提供三个 Agent 工具：

- `image_generate_sublyx`：文生图、单图编辑、可选 mask、顺序批量和 dry-run。
- `image_model_sublyx`：查看模型基线、读取或显式修改持久化默认模型。
- `image_key_sublyx`：在用户明确要求后查看、保存或清除脱敏 Key。

## 已确认的接口

截至 2026-08-31，使用已配置 Key 查询 `https://api.sublyx.org/v1/models`
返回的图像模型为 `gpt-image-2`。插件按 OpenAI Images API 兼容方式调用：

| 场景 | 端点 | 请求格式 |
| --- | --- | --- |
| 文生图 | `/v1/images/generations` | JSON |
| 图片编辑 | `/v1/images/edits` | multipart/form-data |

默认尺寸为 `1024x1024`。插件允许传入其他 `WIDTHxHEIGHT`，是否可用由当前上游模型校验。
模型也保留为可配置字符串，以便 Sublyx 后续增加模型时无需立刻升级插件。

## 安装

在插件目录打包：

```sh
npm install
npm run check
npm pack
```

然后把生成的 `.tgz` 安装到实际使用的 DSH profile：

```sh
dsh plugin --profile web add ./dsh-plugin-sublyx-image-0.1.0.tgz
dsh --profile web --dump-config
```

组合配置中应出现 `sublyx-image`。

发布到 GitHub 后也可以按 DSH 的 GitHub package spec 安装：

```sh
dsh plugin --profile web add github:<owner>/dsh-plugin-sublyx-image#<commit-sha>
```

## 配置 Key

推荐用隐藏终端输入：

```sh
dsh plugin --profile web exec sublyx-image set-key
```

整条命令里没有 Key，不要把任何一段替换成 Key。先运行整条命令并按回车，
看到单独的 `Sublyx API Key:` 提示后，再粘贴 Key 并按回车；输入过程不会显示真实字符。

非交互环境可以使用标准输入：

```sh
printf '%s' "$SUBLYX_API_KEY" | dsh plugin --profile web exec sublyx-image set-key --stdin
```

查看脱敏配置：

```sh
dsh plugin --profile web exec sublyx-image config
```

默认配置文件是 `~/.dsh/sublyx-image/config.json`。环境变量 `SUBLYX_API_KEY`
或 `SUBLYX_IMAGE_API_KEY` 会覆盖本地保存值，但不会写入磁盘。

## 使用示例

可以直接对 Agent 说：

```text
用 Sublyx 生成一张 1024x1024 的极简产品图。
用 C:\images\input.png 作为输入图，把背景改成白色。
用输入图和 C:\images\mask.png 做局部修改。
先 dry-run，不要产生付费请求。
把 Sublyx 默认模型改成 gpt-image-2。
```

`count` 和 `prompts` 中的每一项都是独立请求，可能分别计费。批量任务顺序执行，
遇到首次失败即停止。带 `[NO-AUTO-RETRY]` 的错误不会自动重试，因为上一次请求
可能已经被上游受理或计费。

## 输出与安全

图片默认保存到 `~/Pictures/sublyx-image`。如果当前 DSH 模型支持图片输入且附件服务
已挂载，插件会把结果作为 DSH 图片附件返回；否则只返回绝对文件路径。

插件会限制输入与响应大小、校验本地图像实际格式、拒绝上游返回的非 HTTPS 或私网图片
URL，并且只向与 `apiBaseUrl` 同源的下载请求携带 Key。

## 合规提示

使用者必须自行遵守 Sublyx 的当前服务条款、地区限制、上游政策和适用法律。
Sublyx 网站显示其条款于 2026-05-01 更新，并声明服务不面向中国大陆地区。
本插件不提供代理、地区伪装或任何绕过平台限制的功能。

## 开发

```sh
npm install
npm run check
npm run self-test
```

测试只使用本地 mock server，不会发起付费图像请求。

本项目基于 `dsh-plugin-88api-image` 的 MIT 许可代码修改，版权声明见 [LICENSE](LICENSE)。
