import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { endScrollTop, nearEnd, visibleRange } from './virtualRange.js';
import '../tokens.css';
import '../styles/telas/ui-state.css';

const keyPadrao = (item, i) => (item && item.id != null ? item.id : i);

/**
 * Lista virtual com altura medida (variável), âncora no fim e key estável.
 * Sem lib externa: só o que está na tela entra no DOM (10.000 itens fluem).
 */
export function VirtualList({
  items,
  getKey = keyPadrao,
  renderItem,
  estimateSize = 72,
  overscan = 8,
  followEnd = false,
  className = '',
  style,
  empty = null,
}) {
  const scroller = useRef(null);
  const measured = useRef(new Map());
  const stick = useRef(!!followEnd);
  const raf = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);
  const [rev, setRev] = useState(0);

  const range = useMemo(
    () => visibleRange({
      items,
      getKey,
      measured: measured.current,
      estimate: estimateSize,
      scrollTop,
      viewport,
      overscan,
    }),
    [items, getKey, estimateSize, scrollTop, viewport, overscan, rev],
  );

  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setViewport(el.clientHeight));
    ro.observe(el);
    setViewport(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!followEnd || !stick.current || !el) return;
    el.scrollTop = endScrollTop(el.scrollHeight, el.clientHeight);
  }, [followEnd, items, range.total, rev]);

  const measure = useCallback((key, height) => {
    if (!(height > 0) || measured.current.get(key) === height) return;
    measured.current.set(key, height);
    setRev(n => n + 1);
  }, []);

  const onScroll = e => {
    const el = e.currentTarget;
    stick.current = nearEnd(el.scrollTop, el.scrollHeight, el.clientHeight);
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      setScrollTop(el.scrollTop);
    });
  };

  if (!items.length) return empty;

  return (
    <div
      ref={scroller}
      className={'ui-vlist' + (className ? ' ' + className : '')}
      style={style}
      onScroll={onScroll}
      role="list"
    >
      <div className="ui-vlist-inner" style={{ height: range.total }}>
        <div className="ui-vlist-window" style={{ transform: `translateY(${range.offset}px)` }}>
          {items.slice(range.start, range.end).map((item, i) => {
            const index = range.start + i;
            const key = getKey(item, index);
            return (
              <VirtualRow key={key} id={key} measure={measure}>
                {renderItem(item, index)}
              </VirtualRow>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function VirtualRow({ id, measure, children }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => measure(id, el.getBoundingClientRect().height);
    report();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [id, measure]);
  return <div ref={ref} role="listitem">{children}</div>;
}
