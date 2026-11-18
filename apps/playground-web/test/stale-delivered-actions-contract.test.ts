/**
 * room 対戦の送信中に、配送された古い合法手由来のパス系ボタンを残さない契約。
 *
 * 操作直後の楽観 state は効果キューを即座に消すが、`state.viewerLegalActions`
 * (配送一覧) は確定 state が届くまで操作前のまま。キュー項目に紐づかないパス系だけが
 * ActionBar に残り、サーバー応答まで約 1～2 秒「スタックパス」が見えていた。
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { LegalAction } from "@orica/rules-core";
import { PASS_ACTION_KINDS } from "../src/components/action-ui";
import {
  dropStaleDeliveredPassActions,
  resolveViewerActions,
} from "../src/utils/stale-delivered-actions";

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (relative: string) =>
  readFileSync(resolve(__dirname, relative), "utf8");
const BATTLE_SCREEN = read("../src/components/BattleScreen.tsx");
const PUBLIC_DISCLOSURE = read("../src/components/PublicDisclosurePanel.tsx");

function action(kind: string, actionId: string): LegalAction {
  return { kind, actionId, actingPlayerId: "alice" } as unknown as LegalAction;
}

const passStack = action("pass_stack", "legal:pass-stack:alice");
const passPre = action("pass_pre_declaration_stack", "legal:pass-pre:alice");
const passFlash = action("pass_battle_flash", "legal:pass-flash:alice");
const resolveTriggered = action("resolve_pending_triggered_effect", "r1");
const endAttack = action("end_attack_step", "e1");
const all = [passStack, passPre, passFlash, resolveTriggered, endAttack];

describe("dropStaleDeliveredPassActions", () => {
  it("配送一覧かつ送信中は、パス系 3 種だけを除く", () => {
    expect(
      dropStaleDeliveredPassActions(all, {
        deliveredByServer: true,
        dispatchPending: true,
      })
    ).toEqual([resolveTriggered, endAttack]);
  });

  it("送信中でなければ配送一覧をそのまま返す", () => {
    expect(
      dropStaleDeliveredPassActions(all, {
        deliveredByServer: true,
        dispatchPending: false,
      })
    ).toEqual(all);
  });

  it("配送一覧でなければ (ローカル再計算) 送信中でも変えない", () => {
    expect(
      dropStaleDeliveredPassActions(all, {
        deliveredByServer: false,
        dispatchPending: true,
      })
    ).toEqual(all);
  });

  it("入力配列を破壊しない", () => {
    const input = [...all];
    dropStaleDeliveredPassActions(input, {
      deliveredByServer: true,
      dispatchPending: true,
    });
    expect(input).toEqual(all);
  });

  it("パス系の集合は 3 種のみ", () => {
    expect([...PASS_ACTION_KINDS].sort()).toEqual([
      "pass_battle_flash",
      "pass_pre_declaration_stack",
      "pass_stack",
    ]);
  });
});

describe("resolveViewerActions (myActions の正源)", () => {
  const delivered = { actingPlayerId: "alice", actions: all };

  it("room + 本人宛の配送一覧: ローカル再計算せず配送一覧を使う", () => {
    const computeLocalActions = vi.fn(() => [endAttack]);
    expect(
      resolveViewerActions({
        roomId: "room-1",
        delivered,
        viewingPlayer: "alice",
        dispatchPending: false,
        computeLocalActions,
      })
    ).toEqual(all);
    expect(computeLocalActions).not.toHaveBeenCalled();
  });

  it("room + 送信中: 配送一覧からパス系だけが消える", () => {
    expect(
      resolveViewerActions({
        roomId: "room-1",
        delivered,
        viewingPlayer: "alice",
        dispatchPending: true,
        computeLocalActions: () => [],
      })
    ).toEqual([resolveTriggered, endAttack]);
  });

  it("room + 他人宛の配送一覧: 空 (ローカル再計算もしない)", () => {
    const computeLocalActions = vi.fn(() => [passStack]);
    expect(
      resolveViewerActions({
        roomId: "room-1",
        delivered,
        viewingPlayer: "bob",
        dispatchPending: true,
        computeLocalActions,
      })
    ).toEqual([]);
    expect(computeLocalActions).not.toHaveBeenCalled();
  });

  it("room + 配送一覧なし: ローカル再計算で、送信中でもパス系を隠さない", () => {
    expect(
      resolveViewerActions({
        roomId: "room-1",
        delivered: undefined,
        viewingPlayer: "alice",
        dispatchPending: true,
        computeLocalActions: () => all,
      })
    ).toEqual(all);
  });

  it("roomId なし: 配送欄が残っていても無視してローカル再計算 (非 room は不変)", () => {
    expect(
      resolveViewerActions({
        roomId: null,
        delivered,
        viewingPlayer: "alice",
        dispatchPending: true,
        computeLocalActions: () => [passStack, endAttack],
      })
    ).toEqual([passStack, endAttack]);
  });
});

describe("配線とSSOT", () => {
  it("myActions は resolveViewerActions を「配送一覧使用中の送信中」フラグ付きで呼ぶ", () => {
    expect(BATTLE_SCREEN).toMatch(
      /const deliveredPending =\s*dispatchPending && !!roomId && !!state\.viewerLegalActions;/
    );
    expect(BATTLE_SCREEN).toMatch(
      /resolveViewerActions\(\{[^}]*roomId,[^}]*delivered: state\.viewerLegalActions,[^}]*dispatchPending: deliveredPending,/s
    );
  });

  it("useMemo の依存は deliveredPending のみ (生の dispatchPending を入れない)", () => {
    // 配送一覧が無い通常の room で、送信の開始/終了ごとに再計算させないため。
    const deps = BATTLE_SCREEN.match(
      /\.filter\(\(a\) => !isUnsupportedPaidPreventionImmunityCardVariant\(a\)\);\s*\}, \[([^\]]*)\]\);/s
    );
    expect(deps).not.toBeNull();
    expect(deps![1]).toMatch(/\bdeliveredPending\b/);
    expect(deps![1]).not.toMatch(/\bdispatchPending\b/);
  });

  it("パス系 kind を BattleScreen 内で再列挙せず、公開情報パネルは集合を参照する", () => {
    const literals = [...PASS_ACTION_KINDS].filter((kind) =>
      BATTLE_SCREEN.includes(`"${kind}"`)
    );
    expect(
      literals.length,
      `BattleScreen.tsx が ${literals.join(",")} を再列挙`
    ).toBeLessThan(2);
    expect(BATTLE_SCREEN).not.toMatch(/queueIndependentPassKinds/);
    // PublicDisclosurePanel の他の kind 参照は型の絞り込み用。列挙の判定だけ集合を使う。
    expect(PUBLIC_DISCLOSURE).toContain("PASS_ACTION_KINDS.has(kind)");
  });
});
