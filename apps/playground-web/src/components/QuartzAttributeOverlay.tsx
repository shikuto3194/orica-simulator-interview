import { useLayoutEffect, useRef, useState } from "react";
import {
  getQuartzAttributeSum,
  type CardDefinition,
  type GameState,
  type QuartzAttribute,
} from "@orica/rules-core";
import { SYMBOL_HEX } from "../utils/symbol-format";
import "./quartz-attribute-overlay.css";

const ATTRIBUTE_COLORS = {
  地: "#b87840",
  火: SYMBOL_HEX.red!,
  水: SYMBOL_HEX.blue!,
  風: SYMBOL_HEX.green!,
  時: SYMBOL_HEX.black!,
  空: "#ffd700",
  幻: "#c0c0c0",
} satisfies Record<QuartzAttribute, string>;

export function QuartzAttributeOverlay({
  state,
  hostInstanceId,
  getDefinition,
}: {
  state: GameState;
  hostInstanceId: string;
  getDefinition: (id: string) => CardDefinition | undefined;
}) {
  const attributes = (Object.keys(ATTRIBUTE_COLORS) as QuartzAttribute[])
    .map((attribute) => ({
      attribute,
      count: getQuartzAttributeSum(
        state,
        hostInstanceId,
        attribute,
        getDefinition
      ),
    }))
    .filter(({ count }) => count > 0);
  const overlayRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const hasValues = attributes.length > 0;
  const summary = attributes
    .map(({ attribute, count }) => `${attribute}${count}`)
    .join(" ");

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const measure = measureRef.current;
    const host = overlay?.parentElement;
    if (!overlay || !measure || !host) return;
    const resize = () => {
      // 常にカード幅で測る。拡張後の幅を測ると縮小・拡張が往復する。
      setExpanded(
        measure.scrollHeight > host.clientHeight ||
          measure.scrollWidth > measure.clientWidth
      );
    };
    const observer = new ResizeObserver(resize);
    observer.observe(measure);
    observer.observe(host);
    resize();
    return () => observer.disconnect();
  }, [summary]);

  if (!hasValues) return null;
  const labels = attributes.map(({ attribute, count }) => (
    <span
      key={attribute}
      className={`card-symbol-overlay-chunk${attribute === "時" ? " symbol-black" : ""}`}
      style={{ color: ATTRIBUTE_COLORS[attribute] }}
    >
      {attribute}
      {count}
    </span>
  ));
  return (
    <div
      ref={overlayRef}
      className={`quartz-attribute-overlay${expanded ? " quartz-attribute-overlay-expanded" : ""}`}
      data-testid={`quartz-attributes-${hostInstanceId}`}
      aria-label={`属性値合計: ${summary}`}
    >
      <div className="quartz-attribute-values">{labels}</div>
      <div
        ref={measureRef}
        className="quartz-attribute-measure quartz-attribute-values"
        aria-hidden="true"
      >
        {labels}
      </div>
    </div>
  );
}
