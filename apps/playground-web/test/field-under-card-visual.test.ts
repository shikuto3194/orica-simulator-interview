import { describe, expect, it } from "vitest";
import type { CardInstance } from "@orica/rules-core";
import {
  buildFieldStackBrowseByCard,
  buildFieldSharedCardGroups,
  buildSharedFieldCardBrowseByCard,
  getAttachedFieldBravesForHost,
  getFieldUnderCardVisual,
  getLocalFieldUnderCardVisual,
} from "../src/utils/field-under-card-visual";

describe("field under-card visual", () => {
  it("normalizes legacy bullet edit roleTag labels in the browse title", () => {
    const host = {
      instanceId: "host-1",
      underCards: [
        { cardInstanceId: "under-1", role: "text_role", roleTag: "装弾" },
        { cardInstanceId: "under-2", role: "text_role", roleTag: "装弾" },
      ],
    } as unknown as CardInstance;

    expect(getFieldUnderCardVisual(host)?.browseTitle).toBe(
      "バレットエディット"
    );
  });

  it("keeps a true-buddy shared source in both anchor-local browse lists", () => {
    const shared = {
      instanceId: "buddy",
      definitionId: "BUDDY",
      zone: "field",
    } as CardInstance;
    const left = {
      instanceId: "left",
      zone: "field",
      underCards: [{ cardInstanceId: "buddy", role: "advent_source" }],
    } as CardInstance;
    const right = {
      instanceId: "right",
      zone: "field",
      underCards: [{ cardInstanceId: "buddy", role: "advent_source" }],
    } as CardInstance;
    const getDefinition = (id: string) =>
      id === "BUDDY"
        ? ({ hostDualAdventGrant: { slots: [{}, {}] } } as never)
        : undefined;

    const groups = buildFieldSharedCardGroups(
      [shared, left, right],
      getDefinition
    );
    expect(groups).toEqual([
      {
        kind: "true-buddy",
        sharedCardId: "buddy",
        anchorCardIds: ["left", "right"],
      },
    ]);
    expect(
      buildSharedFieldCardBrowseByCard([shared, left, right], getDefinition)
    ).toEqual(
      new Map([
        ["left", { instanceIds: ["left", "buddy"], title: "真・バディ" }],
        ["right", { instanceIds: ["right", "buddy"], title: "真・バディ" }],
      ])
    );
  });

  it("detects an imagin brave as one shared physical card", () => {
    const left = { instanceId: "left", zone: "field" } as CardInstance;
    const right = { instanceId: "right", zone: "field" } as CardInstance;
    const brave = {
      instanceId: "imagin",
      zone: "field",
      attachedToInstanceId: "left",
      imaginRightCombinedWith: "right",
    } as CardInstance;

    expect(
      buildFieldSharedCardGroups([left, right, brave], () => undefined)
    ).toEqual([
      {
        kind: "imagin-brave",
        sharedCardId: "imagin",
        anchorCardIds: ["left", "right"],
      },
    ]);
    expect(
      buildSharedFieldCardBrowseByCard([left, right, brave], () => undefined)
    ).toEqual(
      new Map([
        [
          "left",
          {
            instanceIds: ["left", "imagin"],
            title: "異魔神合体",
          },
        ],
        [
          "right",
          {
            instanceIds: ["right", "imagin"],
            title: "異魔神合体",
          },
        ],
      ])
    );
  });

  it("routes an attached brave detail request through the host stack browse", () => {
    const host = {
      instanceId: "host",
      zone: "field",
      attachedChildrenIds: ["brave"],
      attachedToInstanceId: null,
      imaginRightCombinedWith: null,
      underCards: [],
    } as unknown as CardInstance;
    const brave = {
      instanceId: "brave",
      zone: "field",
      zoneRoleName: "brave",
      attachedChildrenIds: [],
      attachedToInstanceId: "host",
      imaginRightCombinedWith: null,
      underCards: [],
    } as unknown as CardInstance;

    const browse = buildFieldStackBrowseByCard([host, brave], () => undefined);

    expect(browse.get("host")).toEqual({
      instanceIds: ["host", "brave"],
      title: "合体スピリット",
    });
    expect(browse.get("brave")).toBe(browse.get("host"));
  });

  it("combines attached braves and under-cards in one host stack browse", () => {
    const host = {
      instanceId: "host",
      zone: "field",
      attachedChildrenIds: ["brave"],
      attachedToInstanceId: null,
      imaginRightCombinedWith: null,
      underCards: [{ cardInstanceId: "under", role: "advent_source" }],
    } as unknown as CardInstance;
    const brave = {
      instanceId: "brave",
      zone: "field",
      zoneRoleName: "brave",
      attachedChildrenIds: [],
      attachedToInstanceId: "host",
      imaginRightCombinedWith: null,
      underCards: [],
    } as unknown as CardInstance;
    const under = {
      instanceId: "under",
      zone: "field",
      attachedChildrenIds: [],
      attachedToInstanceId: null,
      imaginRightCombinedWith: null,
      underCards: [],
    } as unknown as CardInstance;

    const browse = buildFieldStackBrowseByCard(
      [host, brave, under],
      () => undefined
    );

    expect(browse.get("host")).toEqual({
      instanceIds: ["host", "brave", "under"],
      title: "フィールド重なり",
    });
    expect(browse.get("brave")).toBe(browse.get("host"));
  });

  it("derives attached brave browse from the child-side attachment pointer", () => {
    const host = {
      instanceId: "host",
      zone: "field",
      attachedChildrenIds: ["stale-trash"],
      attachedToInstanceId: null,
      imaginRightCombinedWith: null,
      underCards: [],
    } as unknown as CardInstance;
    const staleTrash = {
      instanceId: "stale-trash",
      zone: "trash",
      attachedChildrenIds: [],
      attachedToInstanceId: null,
      imaginRightCombinedWith: null,
      underCards: [],
    } as unknown as CardInstance;
    const liveBrave = {
      instanceId: "live-brave",
      zone: "field",
      zoneRoleName: "brave",
      attachedChildrenIds: [],
      attachedToInstanceId: "host",
      imaginRightCombinedWith: null,
      underCards: [],
    } as unknown as CardInstance;
    const cards = [host, staleTrash, liveBrave];

    expect(
      getAttachedFieldBravesForHost(cards, host).map((card) => card.instanceId)
    ).toEqual(["live-brave"]);

    const browse = buildFieldStackBrowseByCard(cards, () => undefined);

    expect(browse.get("host")).toEqual({
      instanceIds: ["host", "live-brave"],
      title: "合体スピリット",
    });
    expect(browse.has("stale-trash")).toBe(false);
  });

  it("does not treat text-role under-card attachments as combined braves", () => {
    const host = {
      instanceId: "host",
      zone: "field",
      attachedChildrenIds: [],
      attachedToInstanceId: null,
      imaginRightCombinedWith: null,
      underCards: [
        {
          cardInstanceId: "bullet",
          role: "text_role",
          roleTag: "バレットエディット",
        },
      ],
    } as unknown as CardInstance;
    const bullet = {
      instanceId: "bullet",
      zone: "field",
      zoneRoleName: "bullet-edit",
      attachedChildrenIds: [],
      attachedToInstanceId: "host",
      imaginRightCombinedWith: null,
      underCards: [],
    } as unknown as CardInstance;
    const cards = [host, bullet];

    expect(getAttachedFieldBravesForHost(cards, host)).toEqual([]);

    const browse = buildFieldStackBrowseByCard(cards, () => undefined);

    expect(browse.get("host")).toEqual({
      instanceIds: ["host", "bullet"],
      title: "バレットエディット",
    });
  });

  it("separates branch-local under cards from the shared source", () => {
    const anchor = {
      instanceId: "left",
      underCards: [
        { cardInstanceId: "shared", role: "advent_source" },
        { cardInstanceId: "local", role: "advent_source" },
      ],
    } as CardInstance;

    expect(
      getLocalFieldUnderCardVisual(anchor, "shared")?.browseInstanceIds
    ).toEqual(["left", "local"]);
  });
});
