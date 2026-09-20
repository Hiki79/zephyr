import { useEffect, useState } from "react";
import { FolderOpen, RotateCw } from "lucide-react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import { Segmented, Switch } from "../components/bits";

export default function SettingsPage() {
  const settings = useStore((s) => s.settings);
  const status = useStore((s) => s.status);
  const patchSettings = useStore((s) => s.patchSettings);
  const toast = useStore((s) => s.toast);

  const [mixedPort, setMixedPort] = useState("");
  const [ctrlPort, setCtrlPort] = useState("");
  const [testUrl, setTestUrl] = useState("");
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setMixedPort(String(settings.mixedPort));
    setCtrlPort(String(settings.ctrlPort));
    setTestUrl(settings.testUrl);
  }, [settings]);

  if (!settings) return null;

  /** Ports only commit on blur, so typing does not restart the core per keystroke. */
  async function commitPort(key: "mixedPort" | "ctrlPort", raw: string) {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1024 || value > 65535) {
      toast("端口需要是 1024 到 65535 之间的整数", "err");
      setMixedPort(String(settings!.mixedPort));
      setCtrlPort(String(settings!.ctrlPort));
      return;
    }
    if (value === settings![key]) return;
    try {
      await patchSettings({ [key]: value } as never);
      toast("端口已更新，内核已重启");
    } catch {
      /* the store already reported it */
    }
  }

  async function restart() {
    setRestarting(true);
    try {
      await api.restartCore();
      toast("内核已重启");
    } catch (e) {
      toast(String(e), "err");
    } finally {
      setRestarting(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="kicker">07 / SETTINGS</div>
          <h1 className="title">设置</h1>
          <div className="subtitle">端口与网络行为的改动会重启内核，模式切换不会</div>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={() => api.openConfigDir()}>
            <FolderOpen />
            配置目录
          </button>
          <button className="btn" onClick={restart} disabled={restarting}>
            <RotateCw className={restarting ? "spin" : ""} />
            重启内核
          </button>
        </div>
      </div>

      <div className="stack">
        <section className="card">
          <div className="card-head">
            <div>
              <h2>网络</h2>
              <div className="card-desc">代理端口与出站行为</div>
            </div>
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-title">混合端口</div>
              <div className="setting-desc">HTTP 和 SOCKS5 共用的本地端口，系统代理也指向它</div>
            </div>
            <div className="setting-control">
              <label className="field port-input">
                <input
                  id="mixed-port"
                  className="num"
                  value={mixedPort}
                  onChange={(e) => setMixedPort(e.target.value)}
                  onBlur={() => commitPort("mixedPort", mixedPort)}
                />
              </label>
            </div>
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-title">控制端口</div>
              <div className="setting-desc">Zephyr 通过它操作内核，一般不用改</div>
            </div>
            <div className="setting-control">
              <label className="field port-input">
                <input
                  id="ctrl-port"
                  className="num"
                  value={ctrlPort}
                  onChange={(e) => setCtrlPort(e.target.value)}
                  onBlur={() => commitPort("ctrlPort", ctrlPort)}
                />
              </label>
            </div>
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-title">出站模式</div>
              <div className="setting-desc">规则按订阅的规则分流，全局把所有流量送到当前节点</div>
            </div>
            <div className="setting-control">
              <Segmented
                value={settings.mode}
                options={[
                  { value: "rule", label: "规则" },
                  { value: "global", label: "全局" },
                  { value: "direct", label: "直连" },
                ]}
                onChange={(mode) => patchSettings({ mode }).catch(() => {})}
              />
            </div>
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-title">允许局域网连接</div>
              <div className="setting-desc">同一网络下的手机、平板可以用这台电脑当代理</div>
            </div>
            <div className="setting-control">
              <Switch
                label="允许局域网连接"
                checked={settings.allowLan}
                onChange={(allowLan) => patchSettings({ allowLan }).catch(() => {})}
              />
            </div>
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-title">IPv6</div>
              <div className="setting-desc">关闭时只走 IPv4，遇到解析异常可以先关掉</div>
            </div>
            <div className="setting-control">
              <Switch
                label="IPv6"
                checked={settings.ipv6}
                onChange={(ipv6) => patchSettings({ ipv6 }).catch(() => {})}
              />
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2>测速</h2>
              <div className="card-desc">决定节点页显示的延迟怎么测</div>
            </div>
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-title">测速地址</div>
              <div className="setting-desc">建议用返回 204 的轻量地址</div>
            </div>
            <div className="setting-control">
              <label className="field" style={{ width: 300 }}>
                <input
                  id="test-url"
                  value={testUrl}
                  onChange={(e) => setTestUrl(e.target.value)}
                  onBlur={() => {
                    const value = testUrl.trim();
                    if (value && value !== settings.testUrl) {
                      patchSettings({ testUrl: value }).catch(() => {});
                    }
                  }}
                />
              </label>
            </div>
          </div>

          <div className="setting-row">
            <div>
              <div className="setting-title">统一延迟</div>
              <div className="setting-desc">扣掉握手耗时，不同协议之间的延迟更有可比性</div>
            </div>
            <div className="setting-control">
              <Switch
                label="统一延迟"
                checked={settings.unifiedDelay}
                onChange={(unifiedDelay) => patchSettings({ unifiedDelay }).catch(() => {})}
              />
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <div>
              <h2>关于</h2>
              <div className="card-desc">内核与运行信息</div>
            </div>
          </div>
          <div className="setting-row">
            <div>
              <div className="setting-title">mihomo 内核</div>
              <div className="setting-desc">随 Zephyr 一起打包，不需要单独下载</div>
            </div>
            <div className="setting-control num sel-text">{status?.coreVersion ?? "未运行"}</div>
          </div>
          <div className="setting-row">
            <div>
              <div className="setting-title">控制地址</div>
              <div className="setting-desc">也可以用外部面板连接这个地址</div>
            </div>
            <div className="setting-control mono sel-text" style={{ fontSize: 12.5 }}>
              127.0.0.1:{settings.ctrlPort}
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
