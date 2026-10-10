import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  endScrollTop,
  indexOfKey,
  liveKeysOf,
  nearEnd,
  patchPrefix,
  pinnedIndices,
  prefixHeights,
  prependShift,
  pruneMeasured,
  scrollCompensation,
  visibleRange,
} from './virtualRange.js';
import './styles.js';
import '../styles/telas/ui-shell.css';

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
  role,
}) {
  const scroller = useRef(null);
  const ro = useRef(null);
  const measured = useRef(new Map());
  const prefixRef = useRef([0]);
  const firstKey = useRef(null);
  const stick = useRef(!!followEnd);
  const raf = useRef(0);
  const rafMeasure = useRef(0);
  const pending = useRef(new Map());
  const itemsRef = useRef(items);
  const getKeyRef = useRef(getKey);
  const estimateRef = useRef(estimateSize);
  itemsRef.current = items;
  getKeyRef.current = getKey;
  estimateRef.current = estimateSize;

  const [scrollTop, setScrollTop] = useState(() => (followEnd ? 1e9 : 0));
  const [viewport, setViewport] = useState(0);
  const [rev, setRev] = useState(0);
  const [pinned, setPinned] = useState(null);

  const listRole = role ?? (followEnd ? 'log' : 'list');
  const itemRole = listRole === 'list' ? 'listitem' : undefined;

  const range = useMemo(() => {
    const r = visibleRange({
      items,
      getKey,
      measured: measured.current,
      estimate: estimateSize,
      scrollTop,
      viewport,
      overscan,
      prefix: prefixRef.current,
    });
    prefixRef.current = r.prefix;
    return r;
  }, [items, getKey, estimateSize, scrollTop, viewport, overscan, rev]);

  const bindScroller = useCallback(el => {
    if (ro.current) {
      ro.current.disconnect();
      ro.current = null;
    }
    scroller.current = el;
    if (!el) return;
    setViewport(el.clientHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(() => setViewport(el.clientHeight));
    obs.observe(el);
    ro.current = obs;
  }, []);

  useEffect(() => () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    if (rafMeasure.current) cancelAnimationFrame(rafMeasure.current);
    if (ro.current) ro.current.disconnect();
  }, []);

  useLayoutEffect(() => {
    pruneMeasured(measured.current, liveKeysOf(items, getKey));
    const shift = prependShift(firstKey.current, items, getKey, measured.current, estimateSize);
    firstKey.current = items.length ? getKey(items[0], 0) : null;
    prefixRef.current = prefixHeights(items, getKey, measured.current, estimateSize);
    const el = scroller.current;
    if (el && shift) {
      el.scrollTop += shift;
      setScrollTop(el.scrollTop);
    }
  }, [items, getKey, estimateSize]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!followEnd || !stick.current || !el || !items.length) return;
    const top = endScrollTop(el.scrollHeight, el.clientHeight);
    el.scrollTop = top;
    setScrollTop(top);
  }, [followEnd, items, range.total, rev]);

  const flushMeasures = useCallback(() => {
    const list = itemsRef.current;
    const keyOf = getKeyRef.current;
    const estimate = estimateRef.current;
    const batch = pending.current;
    if (!batch.size) return;
    let prefix = prefixRef.current;
    if (!prefix || prefix.length !== list.length + 1) {
      prefix = prefixHeights(list, keyOf, measured.current, estimate);
    }
    const el = scroller.current;
    const st = el ? el.scrollTop : 0;
    let scrollAdj = 0;
    let changed = false;
    for (const [key, height] of batch) {
      const prev = measured.current.get(key);
      if (prev === height) continue;
      const old = prev > 0 ? prev : estimate;
      const delta = height - old;
      measured.current.set(key, height);
      const idx = indexOfKey(list, keyOf, key);
      if (idx >= 0) {
        scrollAdj += scrollCompensation(prefix[idx], st, delta);
        prefix = patchPrefix(prefix, idx, delta);
      }
      changed = true;
    }
    batch.clear();
    if (!changed) return;
    prefixRef.current = prefix;
    if (el && scrollAdj) {
      el.scrollTop += scrollAdj;
      setScrollTop(el.scrollTop);
    }
    setRev(n => n + 1);
  }, []);

  const measure = useCallback((key, height) => {
    if (!(height > 0) || measured.current.get(key) === height) return;
    pending.current.set(key, height);
    if (rafMeasure.current) return;
    rafMeasure.current = requestAnimationFrame(() => {
      rafMeasure.current = 0;
      flushMeasures();
    });
  }, [flushMeasures]);

  const onScroll = e => {
    const el = e.currentTarget;
    stick.current = nearEnd(el.scrollTop, el.scrollHeight, el.clientHeight);
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      setScrollTop(el.scrollTop);
    });
  };

  const onFocusIn = e => {
    const row = e.target.closest('[data-vlist-index]');
    if (!row || !scroller.current?.contains(row)) return;
    const idx = Number(row.dataset.vlistIndex);
    if (!Number.isInteger(idx) || !items[idx]) return;
    setPinned(getKey(items[idx], idx));
  };

  const onFocusOut = e => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setPinned(null);
  };

  const pinIdx = pinned != null ? indexOfKey(items, getKey, pinned) : -1;
  const shown = pinnedIndices(range.start, range.end, pinIdx);

  return (
    <div
      ref={bindScroller}
      className={'ui-vlist' + (className ? ' ' + className : '')}
      style={style}
      onScroll={onScroll}
      onFocus={onFocusIn}
      onBlur={onFocusOut}
      role={listRole}
    >
      {!items.length ? empty : (
        <div className="ui-vlist-inner" style={{ height: range.total }}>
          {shown.map(index => {
            const item = items[index];
            const key = getKey(item, index);
            return (
              <VirtualRow
                key={key}
                id={key}
                index={index}
                top={range.prefix[index]}
                setSize={items.length}
                measure={measure}
                itemRole={itemRole}
              >
                {renderItem(item, index)}
              </VirtualRow>
            );
          })}
        </div>
      )}
    </div>
  );
}

function VirtualRow({ id, index, top, setSize, measure, itemRole, children }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => measure(id, el.offsetHeight);
    report();
    if (typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(report);
    obs.observe(el);
    return () => obs.disconnect();
  }, [id, measure]);
  return (
    <div
      ref={ref}
      className="ui-vlist-row"
      role={itemRole}
      aria-setsize={setSize}
      aria-posinset={index + 1}
      data-vlist-index={index}
      style={{ top }}
    >
      {children}
    </div>
  );
}
