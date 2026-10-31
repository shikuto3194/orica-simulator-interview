import type { CardDefinition } from "@orica/rules-core";
import { BSAZ01_CARDS } from "./cards/BSAZ01.js";
import { BSAZ02_CARDS } from "./cards/BSAZ02.js";
import { BSAZ03_CARDS } from "./cards/BSAZ03.js";
import { BSDB01_CARDS } from "./cards/BSDB01.js";
import { BSES01_CARDS } from "./cards/BSES01.js";
import { BSFT01_CARDS } from "./cards/BSFT01.js";
import { BSGE01_CARDS } from "./cards/BSGE01.js";
import { BSKB01_CARDS } from "./cards/BSKB01.js";
import { BSLH01_CARDS } from "./cards/BSLH01.js";
import { BSRK01_CARDS } from "./cards/BSRK01.js";
import { BSSA01_CARDS } from "./cards/BSSA01.js";
import { BSSG01_CARDS } from "./cards/BSSG01.js";
import { BSSG02_CARDS } from "./cards/BSSG02.js";
import { BSSL01_CARDS } from "./cards/BSSL01.js";
import { BSTH001_CARDS } from "./cards/BSTH001.js";
import { BSTH002_CARDS } from "./cards/BSTH002.js";
import { BSTH003_CARDS } from "./cards/BSTH003.js";
import { BSTH004_CARDS } from "./cards/BSTH004.js";
import { BSTH005_CARDS } from "./cards/BSTH005.js";
import { BSTH01_CARDS } from "./cards/BSTH01.js";
import { BSTH02_CARDS } from "./cards/BSTH02.js";
import { BSTH02_5_CARDS } from "./cards/BSTH02.5.js";
import { BSTH02_7_CARDS } from "./cards/BSTH02.7.js";
import { BSTH03_CARDS } from "./cards/BSTH03.js";
import { BSTH04_CARDS } from "./cards/BSTH04.js";
import { BSTH04_5_CARDS } from "./cards/BSTH04.5.js";
import { BSTH05_CARDS } from "./cards/BSTH05.js";
import { BSTH05_5_CARDS } from "./cards/BSTH05.5.js";
import { BSTH06_CARDS } from "./cards/BSTH06.js";
import { BSTH07_CARDS } from "./cards/BSTH07.js";
import { BSTH07_8_CARDS } from "./cards/BSTH07.8.js";
import { BSTH08_CARDS } from "./cards/BSTH08.js";
import { BSTH08_5_CARDS } from "./cards/BSTH08.5.js";
import { BSTH09_CARDS } from "./cards/BSTH09.js";
import { BSTH09_2_CARDS } from "./cards/BSTH09.2.js";
import { BSTH10_CARDS } from "./cards/BSTH10.js";
import { BSTH10_5_CARDS } from "./cards/BSTH10.5.js";
import { BSTH11_CARDS } from "./cards/BSTH11.js";
import { BSTS01_CARDS } from "./cards/BSTS01.js";

export const ALL_CARDS: CardDefinition[] = [
  ...BSAZ01_CARDS,
  ...BSAZ02_CARDS,
  ...BSAZ03_CARDS,
  ...BSDB01_CARDS,
  ...BSES01_CARDS,
  ...BSFT01_CARDS,
  ...BSGE01_CARDS,
  ...BSKB01_CARDS,
  ...BSLH01_CARDS,
  ...BSRK01_CARDS,
  ...BSSA01_CARDS,
  ...BSSG01_CARDS,
  ...BSSG02_CARDS,
  ...BSSL01_CARDS,
  ...BSTH001_CARDS,
  ...BSTH002_CARDS,
  ...BSTH003_CARDS,
  ...BSTH004_CARDS,
  ...BSTH005_CARDS,
  ...BSTH01_CARDS,
  ...BSTH02_CARDS,
  ...BSTH02_5_CARDS,
  ...BSTH02_7_CARDS,
  ...BSTH03_CARDS,
  ...BSTH04_CARDS,
  ...BSTH04_5_CARDS,
  ...BSTH05_CARDS,
  ...BSTH05_5_CARDS,
  ...BSTH06_CARDS,
  ...BSTH07_CARDS,
  ...BSTH07_8_CARDS,
  ...BSTH08_CARDS,
  ...BSTH08_5_CARDS,
  ...BSTH09_CARDS,
  ...BSTH09_2_CARDS,
  ...BSTH10_CARDS,
  ...BSTH10_5_CARDS,
  ...BSTH11_CARDS,
  ...BSTS01_CARDS,
];

export function getCardByNo(cardNo: string): CardDefinition | undefined {
  return ALL_CARDS.find((card) => card.cardNo === cardNo);
}
