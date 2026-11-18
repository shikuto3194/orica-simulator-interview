import { describe, it, expect } from "vitest";
import {
  ZONE_VISIBILITY,
  applyFaceDownPolicyOnZoneChange,
} from "../src/zone/face-down-policy";
import type { CardInstance } from "../src/model";

function makeCard(overrides: Partial<CardInstance> = {}): CardInstance {
  return {
    instanceId: "card-1",
    definitionId: "DEF-001",
    originalDefinitionId: "DEF-001",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
    zoneRoleName: "spirit",
    normalCoreCount: 1,
    minimumRequiredCores: 1,
    exhaustState: "recovered",
    pendingLeaveKind: null,
    pendingLeaveCause: null,
    pendingLeaveChainId: null,
    deferZoneMoveUntilChainEnd: false,
    attachedToInstanceId: null,
    attachedChildrenIds: [],
    pendingLeaveLvSnapshot: null,
    underCards: [],
    divineTransformState: null,
    faceDown: true,
    ...overrides,
  };
}

describe("ZONE_VISIBILITY", () => {
  it("公開領域 (trash / reserve / void / field / count_area / in_use / revealed / mirage / set_aside) を public とする", () => {
    expect(ZONE_VISIBILITY.trash).toBe("public");
    expect(ZONE_VISIBILITY.reserve).toBe("public");
    expect(ZONE_VISIBILITY.void).toBe("public");
    expect(ZONE_VISIBILITY.field).toBe("public");
    expect(ZONE_VISIBILITY.count_area).toBe("public");
    expect(ZONE_VISIBILITY.in_use).toBe("public");
    expect(ZONE_VISIBILITY.revealed).toBe("public");
    // 2026-05-29 裁定: ミラージュは表向きセットで相手も閲覧可能
    expect(ZONE_VISIBILITY.mirage).toBe("public");
    // 手元はオープンゾーン (08b:23) で相手も閲覧可能
    expect(ZONE_VISIBILITY.set_aside).toBe("public");
  });

  it("非公開領域 (deck / life) を private とする", () => {
    expect(ZONE_VISIBILITY.deck).toBe("private");
    expect(ZONE_VISIBILITY.life).toBe("private");
  });

  it("コントローラ限定領域 (hand / burst) を controller_only とする", () => {
    expect(ZONE_VISIBILITY.hand).toBe("controller_only");
    expect(ZONE_VISIBILITY.burst).toBe("controller_only");
  });
});

describe("applyFaceDownPolicyOnZoneChange", () => {
  it("表向きカードはそのまま返す (faceDown=false)", () => {
    const card = makeCard({ faceDown: false });
    const result = applyFaceDownPolicyOnZoneChange(card, "trash");
    expect(result).toBe(card); // 同一参照 (no-op)
    expect(result.faceDown).toBe(false);
  });

  it("裏向きカード → 公開領域 (trash) で表向きに戻る", () => {
    const card = makeCard({ faceDown: true });
    const result = applyFaceDownPolicyOnZoneChange(card, "trash");
    expect(result.faceDown).toBe(false);
    expect(result).not.toBe(card);
  });

  it("裏向きカード → 公開領域 (reserve) で表向きに戻る", () => {
    const card = makeCard({ faceDown: true });
    const result = applyFaceDownPolicyOnZoneChange(card, "reserve");
    expect(result.faceDown).toBe(false);
  });

  it("裏向きカード → 公開領域 (void) で表向きに戻る", () => {
    const card = makeCard({ faceDown: true });
    const result = applyFaceDownPolicyOnZoneChange(card, "void");
    expect(result.faceDown).toBe(false);
  });

  it("裏向きカード → 手札 (controller_only) でも表向きに戻る (2026-05-29 裁定: 離場で解除)", () => {
    // 旧 (2026-05-05): 非公開領域は裏向き維持。
    // 新 (2026-05-29): 分身はフィールドを離れたら通常カードに戻る。手札の秘匿は
    // ゾーン可視性 (controller_only) が担保するため faceDown は不要。
    const card = makeCard({ faceDown: true });
    const result = applyFaceDownPolicyOnZoneChange(card, "hand");
    expect(result.faceDown).toBe(false);
    expect(result).not.toBe(card);
  });

  it("裏向きカード → デッキ (private) でも表向きに戻る (2026-05-29 裁定: 離場で解除)", () => {
    const card = makeCard({ faceDown: true });
    const result = applyFaceDownPolicyOnZoneChange(card, "deck");
    expect(result.faceDown).toBe(false);
  });

  it("裏向きカード → field でも表向きに戻る (明示 face-down は move_card.faceDown:true が別途強制)", () => {
    const card = makeCard({ zone: "hand", faceDown: true });
    const result = applyFaceDownPolicyOnZoneChange(card, "field");
    expect(result.faceDown).toBe(false);
  });
});
