import { useEffect, useRef, useState } from "react";
import { runtimes } from "../app/registry";
import { useStore } from "../app/store";

const FIND_NOT_FOUND = 1;

export function SearchBar({ tabId }: { tabId: string }) {
  const setOpen = useStore((s) => s.setSearchOpen);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [count, setCount] = useState<{ current: number; total: number } | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const bus = runtimes.get(tabId)?.eventBus;
    if (!bus) return;
    const onCount = ({ matchesCount }: { matchesCount: { current: number; total: number } }) => setCount(matchesCount);
    const onState = ({ state, matchesCount }: { state: number; matchesCount: { current: number; total: number } }) => {
      setNotFound(state === FIND_NOT_FOUND);
      if (matchesCount) setCount(matchesCount);
    };
    bus.on("updatefindmatchescount", onCount);
    bus.on("updatefindcontrolstate", onState);
    return () => {
      bus.off("updatefindmatchescount", onCount);
      bus.off("updatefindcontrolstate", onState);
      bus.dispatch("findbarclose", { source: null });
    };
  }, [tabId]);

  const find = (type: "" | "again", findPrevious = false, q = query) => {
    runtimes.get(tabId)?.eventBus?.dispatch("find", {
      source: null,
      type,
      query: q,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious,
      matchDiacritics: false,
    });
  };

  return (
    <div className="search-bar">
      <input
        ref={inputRef}
        className={notFound && query ? "not-found" : ""}
        placeholder="Belgede ara…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          find("", false, e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") find("again", e.shiftKey);
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      <span className="search-count">
        {query && count ? (count.total ? `${count.current} / ${count.total}` : "Bulunamadı") : ""}
      </span>
      <button onClick={() => find("again", true)} title="Önceki (Shift+Enter)" disabled={!query}>
        ↑
      </button>
      <button onClick={() => find("again")} title="Sonraki (Enter)" disabled={!query}>
        ↓
      </button>
      <button onClick={() => setOpen(false)} title="Kapat (Esc)">
        ✕
      </button>
    </div>
  );
}
