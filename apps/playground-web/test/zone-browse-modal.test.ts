import { zoneDisplayLabel } from "@orica/rules-core";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ZONE_BROWSE_MODAL = readFileSync(
  resolve(__dirname, "../src/components/ZoneBrowseModal.tsx"),
  "utf8"
);
const BATTLE_SCREEN = readFileSync(
  resolve(__dirname, "../src/components/BattleScreen.tsx"),
  "utf8"
);
const BATTLE_CSS = readFileSync(
  resolve(__dirname, "../src/battle.css"),
  "utf8"
);

describe("ZoneBrowseModal", () => {
  it("明示リストを自分/相手 + ゾーン単位でグルーピング表示できる", () => {
    expect(ZONE_BROWSE_MODAL).toContain("groupByOwnerZone?: boolean");
    expect(ZONE_BROWSE_MODAL).toContain("zoneOwnerPlayerId");
    expect(ZONE_BROWSE_MODAL).toContain("zoneOwnerLabel");
    expect(ZONE_BROWSE_MODAL).toContain("zone-browse-groups");
    expect(ZONE_BROWSE_MODAL).toContain("zone-browse-group-title");
  });

  it("フィールド重なりリストは本体/煌臨元/text_role 単位でグルーピング表示できる", () => {
    expect(ZONE_BROWSE_MODAL).toContain("groupByFieldStackRole?: boolean");
    expect(ZONE_BROWSE_MODAL).toContain("underCardRoleLabel");
    expect(ZONE_BROWSE_MODAL).toContain('title: "本体"');
    expect(ZONE_BROWSE_MODAL).toContain('title: "煌臨元"');
    expect(ZONE_BROWSE_MODAL).toContain("normalizeUnderCardRoleTag");
    expect(ZONE_BROWSE_MODAL).toContain("fieldStackRoleGroups");
  });

  it("詳細モーダルは定義単体ではなく GameState の current CardInstance を渡す", () => {
    expect(ZONE_BROWSE_MODAL).toContain(
      "const [detailInstanceId, setDetailInstanceId]"
    );
    expect(ZONE_BROWSE_MODAL).toMatch(
      /const detailInstance = detailInstanceId[\s\S]*state\.cardInstances\.find/
    );
    expect(ZONE_BROWSE_MODAL).toMatch(
      /<CardDetailModal[\s\S]*cardInstance=\{detailInstance\}[\s\S]*gameState=\{state\}[\s\S]*getCardDefinitionById=\{getDefinition\}/
    );
    expect(ZONE_BROWSE_MODAL).not.toContain("useState<CardDefinition | null>");
  });

  it("公開情報ログ用 snapshot browse は live instance があっても定義詳細だけを開ける", () => {
    expect(ZONE_BROWSE_MODAL).toContain(
      "export interface ZoneBrowseSnapshotCard"
    );
    expect(ZONE_BROWSE_MODAL).toContain("snapshotCards?: readonly");
    expect(ZONE_BROWSE_MODAL).toContain("const snapshotItems = useMemo");
    expect(ZONE_BROWSE_MODAL).toContain("badgeLabel?: string");
    expect(ZONE_BROWSE_MODAL).toContain("detailStateLabel?: string");
    expect(ZONE_BROWSE_MODAL).toContain("zone-browse-card-badge");
    expect(ZONE_BROWSE_MODAL).toContain(
      "setDetailDefinitionId(item.definitionIdSnapshot)"
    );
    expect(ZONE_BROWSE_MODAL).toContain(
      "setDetailHistoryStateLabel(item.detailStateLabel)"
    );
    expect(ZONE_BROWSE_MODAL).toContain(
      "historyStateLabel: detailHistoryStateLabel"
    );
    expect(ZONE_BROWSE_MODAL).not.toContain(
      "const instance = entry.instanceId"
    );
    expect(ZONE_BROWSE_MODAL).not.toContain(
      "setDetailInstanceId(item.instance"
    );
  });

  it("対象選択のゾーン候補だけ grouped browse を有効にする", () => {
    expect(BATTLE_SCREEN).toMatch(
      /titleOverride="ゾーン候補"[\s\S]*groupByOwnerZone[\s\S]*viewingPlayerId=\{viewingPlayer\}/
    );
  });

  it("ゾーン候補の grouped browse は所有者とゾーン名を見出しに出す", () => {
    expect(zoneDisplayLabel("hand")).toBe("手札");
    expect(ZONE_BROWSE_MODAL).toMatch(
      /title: `\$\{zoneOwnerLabel\(ownerId, viewingPlayerId\)\}の\$\{[\s\S]*zoneDisplayLabel\(\s*zoneKey\s*\)/
    );
  });

  // 直接開いたゾーンからの候補選択は
  // e2e/scenario-direct-zone-browse-target-selection.spec.ts で実操作を検証する。

  it("フィールド重なりブラウズだけ role grouped browse を有効にする", () => {
    expect(BATTLE_SCREEN).toMatch(
      /instanceIds=\{fieldStackBrowse\.instanceIds\}[\s\S]*titleOverride=\{fieldStackBrowse\.title\}[\s\S]*groupByFieldStackRole/
    );
  });

  it("grouped browse は desktop grid と mobile single column を持つ", () => {
    expect(BATTLE_CSS).toMatch(
      /\.zone-browse-groups\s*\{\s*display: grid;[\s\S]*grid-template-columns: repeat\(auto-fit, minmax\(220px, 1fr\)\);/
    );
    expect(BATTLE_CSS).toMatch(
      /\.zone-browse-groups\s*\{\s*grid-template-columns: 1fr;/
    );
  });

  it("フィールド重なり grouped browse は小さいロールを横詰めし大きいロールだけ幅広にする", () => {
    expect(ZONE_BROWSE_MODAL).toContain("zone-browse-groups-field-stack");
    expect(ZONE_BROWSE_MODAL).toContain("zone-browse-group-pack");
    expect(ZONE_BROWSE_MODAL).toContain("zone-browse-group-wide");
    expect(ZONE_BROWSE_MODAL).toContain("--zone-browse-group-cards");
    expect(BATTLE_CSS).toContain(".zone-browse-groups-field-stack");
    expect(BATTLE_CSS).toContain(
      ".zone-browse-groups-field-stack .zone-browse-group-wide"
    );
    expect(BATTLE_CSS).toContain("overflow-x: auto");
  });

  it("deck browse の畳み未知区間は裏面2枚ぶんの幅を予約する", () => {
    expect(BATTLE_CSS).toMatch(
      /\.deck-browse-hidden-collapsed\s*\{\s*width: 192px;[\s\S]*align-items: center;/
    );
    expect(BATTLE_CSS).toMatch(
      /\.deck-browse-hidden-collapsed\s*\{\s*width: 144px;/
    );
  });
});
