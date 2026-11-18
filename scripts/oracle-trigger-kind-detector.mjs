/** Normal oracle event metadata must exactly match its own printed body. */
export const PRINTED_ORACLE_EVENTS = {
  召喚: "summon",
  煌臨: "advent",
  配置: "place",
  使用: "use_magic",
  アクセル使用: "use_accel",
};
const normalize = (text) =>
  text.replace(/\s/g, "").replaceAll("／", "/").replaceAll("：", ":");

export function findOracleTriggerKindIssues(face) {
  if (!face.grandwalkerData) return [];
  const lines = Array.isArray(face.textLines) ? face.textLines : [];
  const header = lines.findIndex((line) =>
    /^【(?:真・)?(?:神託|導託):/.test(normalize(line))
  );
  if (header < 0) return [];
  const refs = [];
  const expected = new Set();
  for (let index = header + 1; index < lines.length; index++) {
    const line = normalize(lines[index]);
    if (/^(?:■|【|Lv\d)/.test(line)) break;
    if (!/^◆対象の自分の/.test(line)) continue;
    refs.push(index);
    const match =
      /^◆対象の自分の.+?(?:を|の)((?:召喚|煌臨|配置|使用|【アクセル】の使用)(?:\/(?:召喚|煌臨|配置|使用|【アクセル】の使用))*)(?:を)?したとき、/.exec(
        line
      );
    if (!match) {
      return [
        {
          kind: "oracle_trigger_source_unrecognized",
          textRef: [header, index],
          detail:
            "Normal oracle event wording could not be audited; review its printed body.",
        },
      ];
    }
    for (const event of match[1].split("/"))
      expected.add(
        PRINTED_ORACLE_EVENTS[
          event.replace("【アクセル】の使用", "アクセル使用")
        ]
      );
  }
  // Placement oracle is independent; a placement-only body has no normal event list.
  if (refs.length === 0) return [];
  const actual = face.grandwalkerData.oracleTriggerKinds;
  const textRef = [header, ...refs];
  if (!Array.isArray(actual) || actual.length === 0)
    return [
      {
        kind: "oracle_trigger_kinds_missing",
        textRef,
        detail:
          "Normal oracle requires a nonempty explicit oracleTriggerKinds array.",
        expected: [...expected],
        actual: actual ?? null,
      },
    ];
  if (
    new Set(actual).size !== actual.length ||
    actual.length !== expected.size ||
    actual.some((event) => !expected.has(event))
  )
    return [
      {
        kind: "oracle_trigger_kinds_mismatch",
        textRef,
        detail:
          "oracleTriggerKinds must contain exactly the normal events printed in this oracle body.",
        expected: [...expected],
        actual,
      },
    ];
  return [];
}
