import { createContext, type ComponentProps } from "react";

/** 前面キューの出典個体。カード名・定義IDでは照合しない。 */
export const EffectSourceContext = createContext<string | null>(null);

export function EffectSourceScope({
  sourceInstanceId,
  ...props
}: ComponentProps<"div"> & { sourceInstanceId: string | null }) {
  return (
    <EffectSourceContext.Provider value={sourceInstanceId}>
      <div {...props} />
    </EffectSourceContext.Provider>
  );
}
