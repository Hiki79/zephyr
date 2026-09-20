import { useEffect, useMemo, useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { api, type Rule } from "../lib/api";
import { Empty } from "../components/bits";

export default function Rules() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    api
      .getRules()
      .then((data) => setRules(data.rules ?? []))
      .catch(() => setRules([]));
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rules;
    return rules.filter(
      (rule) =>
        rule.payload.toLowerCase().includes(needle) ||
        rule.proxy.toLowerCase().includes(needle) ||
        rule.type.toLowerCase().includes(needle)
    );
  }, [rules, query]);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="kicker">05 / RULES</div>
          <h1 className="title">规则</h1>
          <div className="subtitle">内核按这个顺序从上往下匹配，第一条命中的决定出站</div>
        </div>
      </div>

      <section className="card">
        <div className="toolbar">
          <label className="field round grow">
            <Search />
            <input
              id="rule-search"
              value={query}
              placeholder="按域名、类型或策略组筛选"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <span className="card-desc">
            {filtered.length} / {rules.length} 条
          </span>
        </div>

        {filtered.length === 0 ? (
          <Empty
            icon={<SlidersHorizontal />}
            title={rules.length === 0 ? "还没有规则" : "没有匹配的规则"}
            desc={
              rules.length === 0
                ? "规则来自当前订阅的配置文件，添加订阅后会显示在这里。"
                : "换个关键词试试。"
            }
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 60 }} className="r">
                  #
                </th>
                <th style={{ width: 190 }}>类型</th>
                <th>匹配内容</th>
                <th style={{ width: 200 }}>出站</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 500).map((rule, index) => (
                <tr key={`${rule.type}-${rule.payload}-${index}`}>
                  <td className="r sub num">{index + 1}</td>
                  <td className="sub mono" style={{ fontSize: 12 }}>
                    {rule.type}
                  </td>
                  <td className="ell" title={rule.payload}>
                    {rule.payload || "--"}
                  </td>
                  <td className="ell">{rule.proxy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {filtered.length > 500 && (
          <div className="table-foot">
            <span>只显示前 500 条，用搜索缩小范围</span>
          </div>
        )}
      </section>
    </>
  );
}
