import { expect, it } from "vitest";
import { recomputeAndRebuildContinuousEffects } from "../../../packages/rules-core/src/effect/continuous-effect-rebuild";
import {
  dioscuriaUnderCardState,
  dioscuriaLookup as lookup,
} from "../../../packages/rules-core/test/helpers/dioscuria-under-cards";
import { getCurrentEffectDisplaysForCard } from "../src/utils/granted-effect-display";
import { listBorrowableCardEventEffectCandidates } from "../../../packages/rules-core/src/effect/effect-borrowing";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "@orica/rules-core";

it.each([4, 5])(
  "コア%dのディオスクリアは取得元本文と実際のタイミング拡張を表示する",
  (cores) => {
    const state = dioscuriaUnderCardState();
    const host = state.cardInstances.find((c) => c.instanceId === "dioscuria")!;
    host.normalCoreCount = cores;
    for (const id of ["heras", "electris", "siren"]) {
      host.underCards.push({
        cardInstanceId: id,
        role: "text_role",
        roleTag: "ＣＦアルティメット",
      });
      Object.assign(state.cardInstances.find((c) => c.instanceId === id)!, {
        zone: "field",
        attachedToInstanceId: host.instanceId,
      });
    }
    const current = recomputeAndRebuildContinuousEffects(state, lookup);
    const displays = getCurrentEffectDisplaysForCard(
      current,
      host,
      lookup(host.definitionId)!,
      lookup
    );
    expect(displays.length).toBeGreaterThan(0);
    expect(new Set(displays.map((d) => d.sourceDefinition?.cardNo))).toEqual(
      new Set(["BSAZ02-TR01(A)", "BSAZ02-R01", "BSAZ02-C03"])
    );
    expect(displays.every((d) => !!d.text)).toBe(true);
    expect(displays.map((d) => d.text).join("\n")).not.toContain(
      "手札/トラッシュの系統"
    );
    const text = displays.map((d) => d.text).join("\n");
    expect(text).toContain("エレクトリスから取得（Lv条件を無視）");
    expect(text).not.toContain("【アルドノアドライブ：");
    expect(text).not.toMatch(/Lv\d/);
    if (cores === 5) {
      expect(text).not.toContain("のアタック時");
      expect(text).toContain("のアタック/ブロック時");
    } else {
      expect(text).toContain("のアタック時");
    }
    const restriction = displays.find(
      (d) =>
        d.sourceDefinition?.cardNo === "BSAZ02-R01" &&
        d.text?.includes("相手は手札")
    );
    expect(restriction?.effect.timing.kind).toBe("continuous");
    expect(restriction?.text).toContain(
      cores === 5 ? "のアタック/ブロック時" : "のアタック時"
    );
    // 同じ取得本文は効果借用のアタック時判定にも使う。
    const candidates = listBorrowableCardEventEffectCandidates(
      current,
      host.instanceId,
      host.definitionId,
      host.instanceId,
      lookup(host.definitionId)!,
      ["attack"],
      lookup
    );
    expect(candidates.filter((c) => c.grantedEffectCeId)).toHaveLength(2);
    expect(
      candidates.some(
        (c) => c.grantedEffectCeId === restriction!.continuousEffect.effectId
      )
    ).toBe(false);
  }
);

for (const receiver of ["clone", "dioscuria"] as const) {
  it(`${receiver}: オルテュギア本文中のキーワード参照を見出しとして削除しない`, () => {
    const definition = lookup("BSAZ02-X03")!;
    const card = (no: string, id: string, zone: "field" | "deck" = "field") =>
      createCardInstance(lookup(no)!, {
        instanceId: id,
        ownerPlayerId: "alice",
        zone,
        normalCoreCount: zone === "field" ? 1 : 0,
      });
    const donor = card(definition.cardNo, "ortygia");
    const drive = card("BSAZ02-C10", "drive");
    const target = card(
      receiver === "clone" ? "BSAZ02-C01" : "BSAZ02-TX01(B)",
      "receiver",
      receiver === "clone" ? "deck" : "field"
    );
    const host = receiver === "clone" ? donor : target;
    drive.attachedToInstanceId = host.instanceId;
    host.underCards = [
      {
        cardInstanceId: drive.instanceId,
        role: "text_role",
        roleTag: "アルドノアドライブ",
      },
    ];
    if (receiver === "dioscuria") {
      target.normalCoreCount = 5;
      donor.attachedToInstanceId = target.instanceId;
      host.underCards.push({
        cardInstanceId: donor.instanceId,
        role: "text_role",
        roleTag: "ＣＦアルティメット",
      });
    }
    let state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [donor, drive, target],
    });
    if (receiver === "clone") {
      state = executeEffect({
        state,
        chainId: "test:ortygia-display",
        sourceInstanceId: donor.instanceId,
        actingPlayerId: "alice",
        effect: definition.effects![0]!,
        getCardDefinitionById: lookup,
      });
    }
    const current = recomputeAndRebuildContinuousEffects(state, lookup);
    const recipient = current.cardInstances.find(
      (c) => c.instanceId === target.instanceId
    )!;
    expect(recipient.zone).toBe("field");
    const text = getCurrentEffectDisplaysForCard(
      current,
      recipient,
      lookup(recipient.definitionId)!,
      lookup
    )
      .map((display) => display.text)
      .join("\n");
    expect(text).toContain("オルテュギアから取得");
    expect(text).toContain(definition.textLines[5]);
    expect(text).not.toContain(definition.textLines[2]);
  });
}
