# Zephyr

一个 Windows 上的 mihomo 内核代理客户端。Tauri 2 + React 19 + TypeScript，
内核以 sidecar 形式随应用一起打包，不需要单独下载。

## 界面

Swiss 网格 + 企业级极简 + 一点老 Apple 的质感。正蓝侧栏、纸白画布、
极细分割线、低对比阴影，只做浅色。设计稿在 `design/`：

- `design/mockup.html` — 当前定稿的静态效果图（总览 + 节点两屏）
- `design/mockup-v1.html` — 第一版，雾蓝配色，已废弃
- `design/paper-blue-fragment.html` — 正蓝侧栏方向的参考稿

一屏最多两块蓝：侧栏和总览页的流量卡。其余全部白底。

## 目录

```
src/                  前端
  lib/api.ts          invoke 包装，后端命令的类型定义
  lib/store.ts        zustand 全局状态、事件订阅、轮询
  lib/format.ts       字节、时延、地区、时间的格式化
  components/         通用控件与流量图
  pages/              七个页面，与侧栏一一对应
src-tauri/src/
  lib.rs              Tauri 命令、应用状态、启动流程
  core.rs             mihomo 进程生命周期与配置合并
  mihomo.rs           内核 RESTful API 客户端
  profiles.rs         订阅拉取与解析
  settings.rs         应用设置的读写
  sysproxy_win.rs     Windows 系统代理开关
src-tauri/binaries/   mihomo sidecar
```

## 运行

```powershell
pnpm install
pnpm tauri dev
```

打包：

```powershell
pnpm tauri build
```

产物是 NSIS 安装包。

## 数据位置

`%APPDATA%\dev.zephyr.app`

- `settings.json` 应用设置
- `profiles.json` + `profiles/*.yaml` 订阅
- `runtime/config.yaml` 合并后真正交给内核的配置
- `runtime/` 下还有 geo 数据和 `cache.db`

首次启动时，如果本机已经装了 Stelliberty 或 Clash Verge，
会把它们的 geo 数据复制过来，省掉第一次下载。

## 几个实现细节

**配置合并**：订阅的 YAML 原样保留，只覆盖端口、控制端口、模式、TUN、DNS
这些运行时字段，所以机场自己的规则和策略组不会被改动。

**切换成本**：出站模式走内核 API 热切换，不重启；端口、TUN、局域网这些
写在配置文件里的开关才会重启内核。

**流量曲线**：后端订阅内核的 `/traffic` 流，转成 `zephyr://traffic` 事件推给
前端，断线自己重连，所以内核重启只表现为曲线上的一小段空白。

**退出**：关窗口时会关掉内核并把系统代理恢复原样，不会留一个指向死端口的
系统设置。

**端口冲突**：Clash Verge 默认也用 7897。启动前会先试探端口，被占用就往后
找一个空闲的，写回设置并在界面上提示。如果内核最终没拿到代理端口，总览页会
直接说明，并且禁掉系统代理开关，免得把系统代理指到一个没人监听的端口上。
