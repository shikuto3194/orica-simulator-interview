import { useMemo, useState } from "react";
import { qaData } from "../qa-data";

export function QaTab() {
  const [query, setQuery] = useState("");
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({});
  const results = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return qaData;
    return qaData.filter((item) =>
      [item.question, item.answer, ...item.tags]
        .join("\n")
        .toLowerCase()
        .includes(keyword)
    );
  }, [query]);

  return (
    <>
      <div className="db-workspace-controls">
        <h2>QA（ルール・裁定）</h2>
        <label className="db-qa-search-label" htmlFor="db-qa-query">
          キーワード検索
        </label>
        <input
          id="db-qa-query"
          className="db-qa-search"
          type="search"
          placeholder="例: 真・導託 / コアの移動 など"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="db-workspace-cards db-qa-results">
        <div className="db-qa-results-heading">
          <strong>検索結果</strong>
          <span role="status">{results.length} 件</span>
        </div>
        <div className="db-qa-list">
          {results.length === 0 && (
            <p className="db-qa-empty">一致するQAが見つかりませんでした。</p>
          )}
          {results.map((item) => {
            const open = !!openItems[item.id];
            return (
              <section className="db-qa-item" key={item.id}>
                <button
                  className="db-qa-question"
                  aria-expanded={open}
                  aria-controls={item.id}
                  onClick={() =>
                    setOpenItems((previous) => ({
                      ...previous,
                      [item.id]: !previous[item.id],
                    }))
                  }
                >
                  <strong>Q{Number(item.id.replace("qa-", ""))}</strong>
                  <span>{item.question}</span>
                  <span aria-hidden="true">{open ? "▲" : "▼"}</span>
                </button>
                <div id={item.id} className="db-qa-answer" hidden={!open}>
                  <strong className="db-qa-answer-label">A.</strong>
                  <div
                    className="db-qa-answer-text"
                    dangerouslySetInnerHTML={{ __html: item.answer }}
                  />
                  <div className="db-qa-tags">
                    {item.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                    <time dateTime={item.updatedAt}>
                      更新: {item.updatedAt}
                    </time>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
