/**
 * P3-86 Phase 3: EffectQueue 前面キュー操作のリグレッションガード（構造版）。
 *
 * 各キュー項目が自分の legal action だけを claim し、前面カードだけがその actions を
 * 表示する構造を守る。これにより、背面項目の発揮/解決ボタン漏れを防ぐ。
 */
import { describe, expect, it } from "vitest";
import type { EffectQueueItem } from "../src/components/EffectQueueOverlay";
import {
  actionablePrivateDeclarationFrontId,
  queueItemClaimsAction,
  isActionForEffectQueueFront,
  isAutomaticEffectQueueDrain,
} from "../src/components/EffectQueueOverlay";
import type { LegalAction } from "@orica/rules-core";

function makeItem(
  kind: EffectQueueItem["kind"],
  sourceRef: EffectQueueItem["sourceRef"],
  extra: Partial<EffectQueueItem> = {}
): EffectQueueItem {
  return {
    id: "i",
    kind,
    definitionId: "X",
    imagePath: null,
    cardName: "X",
    effectText: "",
    actingPlayerId: "alice",
    timingLabel: "",
    sourceRef,
    ...extra,
  };
}

const act = (kind: string, rest: Record<string, unknown> = {}): LegalAction =>
  ({ kind, ...rest }) as unknown as LegalAction;

describe("queueItemClaimsAction (P3-86 Phase 3 item↔action 単一正源)", () => {
  it("visible optional skipOnly keeps an explicit decline; orphan and mandatory drains stay automatic", () => {
    const item = makeItem(
      "triggered",
      { type: "triggered", data: { pendingId: "live" } as never },
      { sourceInstanceId: "s1" }
    );
    const action = act("resolve_pending_triggered_effect", {
      pendingId: "live",
      sourceInstanceId: "s1",
      skipOnly: true,
      executionMode: "optional",
    });
    expect(isAutomaticEffectQueueDrain(action, [item])).toBe(false);
    expect(isActionForEffectQueueFront(action, item)).toBe(true);
    expect(isAutomaticEffectQueueDrain(action, [])).toBe(true);
    expect(
      isAutomaticEffectQueueDrain(
        { ...action, executionMode: "mandatory" } as LegalAction,
        [item]
      )
    ).toBe(true);
  });
  it("画像のない整理用操作は自動処理し、実際の選択は残す", () => {
    const item = makeItem(
      "triggered",
      { type: "triggered", data: { pendingId: "live" } as never },
      { sourceInstanceId: "s1" }
    );
    expect(
      isAutomaticEffectQueueDrain(
        act("select_pending_to_resolve", { pendingId: "used" }),
        [item]
      )
    ).toBe(true);
    expect(
      isAutomaticEffectQueueDrain(
        act("select_pending_to_resolve", { pendingId: "live" }),
        [item]
      )
    ).toBe(false);
    expect(
      isAutomaticEffectQueueDrain(
        act("resolve_pending_triggered_effect", {
          sourceInstanceId: "s1",
          skipOnly: true,
        }),
        []
      )
    ).toBe(true);
    expect(
      isAutomaticEffectQueueDrain(
        act("resolve_pending_triggered_effect", {
          sourceInstanceId: "s1",
          canSkipDuplicate: true,
        }),
        []
      )
    ).toBe(false);
    expect(isAutomaticEffectQueueDrain(act("pass_stack"), [])).toBe(false);
  });
  it("画像のない操作候補は前面へ漏れず、パスは残る", () => {
    const front = makeItem(
      "triggered",
      { type: "triggered", data: { pendingId: "front" } as never },
      { sourceInstanceId: "s1" }
    );
    expect(
      isActionForEffectQueueFront(
        act("resolve_pending_triggered_effect", {
          pendingId: "hidden",
          skipOnly: true,
        }),
        front
      )
    ).toBe(false);
    expect(
      isActionForEffectQueueFront(
        act("select_pending_to_resolve", {
          pendingId: "hidden",
          sourceInstanceId: "s2",
        }),
        front
      )
    ).toBe(false);
    expect(
      isActionForEffectQueueFront(
        act("resolve_pending_triggered_effect", {
          pendingId: "front",
          sourceInstanceId: "s1",
        }),
        front
      )
    ).toBe(true);
    expect(
      isActionForEffectQueueFront(
        act("resolve_pending_triggered_effect", { pendingId: "front" }),
        undefined
      )
    ).toBe(false);
    expect(isActionForEffectQueueFront(act("pass_stack"), front)).toBe(true);
  });
  it("private_declaration は declarationId 一致の declare/skip のみ claim する", () => {
    const item = makeItem("private_declaration", {
      type: "privateDeclaration",
      data: { declarationId: "d1" } as never,
    });
    expect(
      queueItemClaimsAction(
        item,
        act("declare_private_triggered_effect", { declarationId: "d1" })
      )
    ).toBe(true);
    expect(
      queueItemClaimsAction(
        item,
        act("skip_private_triggered_effect", { declarationId: "d1" })
      )
    ).toBe(true);
    // 別 declarationId (背面の別項目) は claim しない。
    expect(
      queueItemClaimsAction(
        item,
        act("declare_private_triggered_effect", { declarationId: "d2" })
      )
    ).toBe(false);
    // パス等のグローバル行動は claim しない。
    expect(queueItemClaimsAction(item, act("pass_stack"))).toBe(false);
  });

  it("triggered は pendingId+source 一致の resolve / select のみ claim する", () => {
    const item = makeItem(
      "triggered",
      { type: "triggered", data: { pendingId: "p1" } as never },
      { sourceInstanceId: "s1", registrationIndex: 0 }
    );
    expect(
      queueItemClaimsAction(
        item,
        act("resolve_pending_triggered_effect", {
          pendingId: "p1",
          sourceInstanceId: "s1",
          registrationIndex: 0,
        })
      )
    ).toBe(true);
    expect(
      queueItemClaimsAction(
        item,
        act("select_pending_to_resolve", { pendingId: "p1" })
      )
    ).toBe(true);
    expect(
      queueItemClaimsAction(
        item,
        act("select_pending_to_resolve", {
          pendingId: "p1",
          sourceInstanceId: "s1",
          registrationIndex: 0,
        })
      )
    ).toBe(true);
    expect(
      queueItemClaimsAction(
        item,
        act("resolve_pending_triggered_effect", {
          pendingId: "p1",
          sourceInstanceId: "s2",
          registrationIndex: 0,
        })
      )
    ).toBe(false);
    expect(
      queueItemClaimsAction(
        item,
        act("select_pending_to_resolve", {
          pendingId: "p1",
          sourceInstanceId: "s2",
          registrationIndex: 0,
        })
      )
    ).toBe(false);
    expect(
      queueItemClaimsAction(
        item,
        act("select_pending_to_resolve", {
          pendingId: "p1",
          sourceInstanceId: "s1",
          registrationIndex: 1,
        })
      )
    ).toBe(false);
    expect(
      queueItemClaimsAction(
        item,
        act("select_pending_to_resolve", { pendingId: "p2" })
      )
    ).toBe(false);
  });

  it("battle_immediate は promptId 一致の resolve のみ claim する", () => {
    const item = makeItem("battle_immediate", {
      type: "battleImmediate",
      data: { promptId: "bp1" } as never,
    });
    expect(
      queueItemClaimsAction(
        item,
        act("resolve_battle_immediate_effect", { promptId: "bp1" })
      )
    ).toBe(true);
    expect(
      queueItemClaimsAction(
        item,
        act("resolve_battle_immediate_effect", { promptId: "bp2" })
      )
    ).toBe(false);
  });

  it("burst_check は checkId+source 一致の resolve/decline を claim する", () => {
    const item = makeItem(
      "burst_check",
      { type: "burstCheck", data: { checkId: "bc1" } as never },
      { sourceInstanceId: "burst-src", registrationIndex: 1 }
    );
    expect(
      queueItemClaimsAction(
        item,
        act("resolve_pending_burst_check", {
          checkId: "bc1",
          sourceInstanceId: "burst-src",
          registrationIndex: 1,
          choiceIndex: 0,
        })
      )
    ).toBe(true);
    expect(
      queueItemClaimsAction(
        item,
        act("resolve_pending_burst_check", {
          checkId: "bc1",
          sourceInstanceId: "burst-src",
          registrationIndex: 1,
          choiceIndex: 1,
        })
      )
    ).toBe(true);
    expect(
      queueItemClaimsAction(
        item,
        act("decline_pending_burst_check", { checkId: "bc1" })
      )
    ).toBe(true);
    expect(
      queueItemClaimsAction(
        item,
        act("resolve_pending_burst_check", {
          checkId: "bc2",
          sourceInstanceId: "burst-src",
          registrationIndex: 1,
        })
      )
    ).toBe(false);
    expect(
      queueItemClaimsAction(
        item,
        act("resolve_pending_burst_check", {
          checkId: "bc1",
          sourceInstanceId: "other-src",
          registrationIndex: 1,
        })
      )
    ).toBe(false);
  });

  it("stack 系項目はどの action も claim しない (パスはグローバル行動)", () => {
    const item = makeItem("stack", { type: "stack", data: {} as never });
    expect(queueItemClaimsAction(item, act("pass_stack"))).toBe(false);
    expect(
      queueItemClaimsAction(
        item,
        act("declare_private_triggered_effect", { declarationId: "d1" })
      )
    ).toBe(false);
  });
});

describe("actionablePrivateDeclarationFrontId (P3-86 front-fix 回帰ガード)", () => {
  it("declare_private action があれば対応する ppd-<declarationId> を返す", () => {
    expect(
      actionablePrivateDeclarationFrontId([
        act("declare_private_triggered_effect", { declarationId: "d1" }),
      ])
    ).toBe("ppd-d1");
  });

  it("actionable 宣言の declarationId を指す (前面=末尾の既定でなく)", () => {
    // 複数の非公開宣言があっても legal-actions は [0] のみ declare を surface する。
    // その declarationId の項目を前面化対象として返し、操作可能なカードを前面に出す。
    expect(
      actionablePrivateDeclarationFrontId([
        act("pass_battle_flash"),
        act("declare_private_triggered_effect", { declarationId: "first" }),
        act("skip_private_triggered_effect", { declarationId: "first" }),
      ])
    ).toBe("ppd-first");
  });

  it("declare action が無ければ null (deferred 中 = 被応答スタックを前面のまま維持)", () => {
    expect(actionablePrivateDeclarationFrontId([act("pass_stack")])).toBeNull();
    expect(actionablePrivateDeclarationFrontId([])).toBeNull();
    expect(actionablePrivateDeclarationFrontId(undefined)).toBeNull();
  });
});
