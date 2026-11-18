/**
 * エンジン内で固定の使用枠 (card-data に制限記述が無い) のラベルと制限。
 * 列挙・宣言・解決のエンジン側と、旧形式の移行 (migration.ts) が同じ定数を使う。
 * 値を複数箇所のリテラルで持たない (片方だけ変えると、移行した枠が列挙で効かなくなる)。
 */
import type { EffectUsageLimit } from "./types";

/** 契約合体の代理 (BSGE01-C09〜C13 の contractCombineProxyData: 合体元の代わりに手札から合体する) の枠。同名・ターンに1回。 */
export const CONTRACT_COMBINE_PROXY_USAGE_LABEL = "contract_combine_proxy";
/** 場の魔法の使用前誘発の枠。同名・ターンに1回。 */
export const FIELD_MAGIC_PRE_COST_TRIGGER_USAGE_LABEL =
  "field_magic_pre_cost_trigger";

const SAME_NAME_ONCE_PER_TURN: EffectUsageLimit = Object.freeze({
  kind: "per_card_name",
  duration: "turn",
});

/** ラベル → 制限。旧ラベルの移行もこの表を使う。 */
export const FIXED_RULE_LABEL_LIMITS: Readonly<
  Record<string, EffectUsageLimit>
> = {
  [CONTRACT_COMBINE_PROXY_USAGE_LABEL]: SAME_NAME_ONCE_PER_TURN,
  [FIELD_MAGIC_PRE_COST_TRIGGER_USAGE_LABEL]: SAME_NAME_ONCE_PER_TURN,
};

export const CONTRACT_COMBINE_PROXY_USAGE_LIMIT =
  FIXED_RULE_LABEL_LIMITS[CONTRACT_COMBINE_PROXY_USAGE_LABEL]!;
export const FIELD_MAGIC_PRE_COST_TRIGGER_USAGE_LIMIT =
  FIXED_RULE_LABEL_LIMITS[FIELD_MAGIC_PRE_COST_TRIGGER_USAGE_LABEL]!;
