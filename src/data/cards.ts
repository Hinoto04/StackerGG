export type CardImageQuality = "list" | "detail";
export const CARD_TYPES = ["MAIN", "SUB", "ACTIVE"] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const DEFAULT_LIST_RARITY = "N";
export const RARITY_SORT_ORDER = ["N", "R", "SR", "UR", "SP", "HI"] as const;
const CARD_TYPE_EXTRA_RARITIES: Record<CardType, readonly string[]> = {
  MAIN: ["UR", "MSP"],
  SUB: ["UR", "SSP"],
  ACTIVE: ["ASP"],
};

export function normalizeCardType(cardType: string) {
  return cardType.trim().toUpperCase();
}

export function normalizeRarity(rarity: string) {
  return rarity.trim().toUpperCase();
}

export function isCardType(cardType: string): cardType is CardType {
  return CARD_TYPES.includes(cardType as CardType);
}

export function getAllowedRaritiesForCardType(cardType: string) {
  const normalizedCardType = normalizeCardType(cardType);

  if (!isCardType(normalizedCardType)) {
    return [];
  }

  return ["N", "R", "SR", ...CARD_TYPE_EXTRA_RARITIES[normalizedCardType], "HI"];
}

export function getRaritySortRank(rarity: string) {
  const normalized = normalizeRarity(rarity);
  const rarityKey = normalized.endsWith("SP") ? "SP" : normalized;
  const index = RARITY_SORT_ORDER.indexOf(rarityKey as (typeof RARITY_SORT_ORDER)[number]);

  return index === -1 ? RARITY_SORT_ORDER.length : index;
}

export function compareRarities(a: string, b: string) {
  return getRaritySortRank(a) - getRaritySortRank(b) || normalizeRarity(a).localeCompare(normalizeRarity(b));
}

export interface CardRecord {
  /**
   * 카드 내부 식별자입니다.
   * 수록 번호가 고유하다면 collectionNumber와 동일하게 사용할 수 있습니다.
   */
  id: string;

  /**
   * 카드명 - 짧은 텍스트
   */
  name: string;

  /**
   * 카드 타입 - 짧은 텍스트
   */
  cardType: string;

  /**
   * 파워 - 특정 타입 카드만 가지는 정수 수치 정보
   * 파워가 없는 카드는 null을 사용합니다.
   */
  power: number | null;

  /**
   * 액티브 코스트 - 짧은 텍스트
   */
  activeCost: string;

  /**
   * 액티브 효과 - 줄바꿈을 포함할 수 있는 긴 텍스트
   */
  activeEffect: string;

  /**
   * 메인 코스트 - MAIN 카드만 사용합니다.
   */
  mainCost: string | null;

  /**
   * 메인 효과 - MAIN 카드만 사용합니다.
   */
  mainEffect: string | null;

  /**
   * 서브 코스트 - SUB 카드만 사용합니다.
   */
  subCost: string | null;

  /**
   * 서브 효과 - SUB 카드만 사용합니다.
   */
  subEffect: string | null;

  /**
   * 카드 목록 대표 이미지에 사용할 수록 번호입니다.
   * 수록 레어도 정보가 없을 때 기본 대표 이미지 경로에 사용합니다.
   */
  collectionNumber: string;
}

export interface PackRecord {
  /**
   * 팩 내부 식별자입니다.
   */
  id: string;

  /**
   * 팩 이름 - 짧은 텍스트
   */
  name: string;

  /**
   * 발매일 - 시간 정보를 포함하지 않는 날짜 문자열입니다.
   * DB에서는 date 타입으로 저장할 예정입니다.
   */
  releaseDate: string;

  /**
   * 코드 prefix - 짧은 텍스트
   */
  codePrefix: string;
}

export interface CardReleaseRecord {
  /**
   * 수록 정보 내부 식별자입니다.
   */
  id: string;

  /**
   * 카드명 - 짧은 텍스트
   * 수록 당시 표기명 보존이 필요할 수 있어 별도로 둡니다.
   */
  cardName: string;

  /**
   * 참조 카드 - 외부 키(카드)
   */
  cardId: string;

  /**
   * 레어도 - 짧은 텍스트
   */
  rarity: string;

  /**
   * 수록 팩 - 외부 키(팩)
   */
  packId: string;

  /**
   * 수록 번호 - 짧은 텍스트
   */
  collectionNumber: string;
}

export const STACKER_IMAGE_BASE_URL =
  process.env.NEXT_PUBLIC_CARD_IMAGE_BASE_URL ?? "https://images.hinoto.kr/StackerBattle";
export function createCardReleaseId(collectionNumber: string, rarity: string) {
  return `${collectionNumber}-${rarity}`;
}

export function getCardImageUrl(collectionNumber: string, rarity: string, quality: CardImageQuality) {
  const folder = quality === "list" ? "webpsm" : "webp";
  const fileName = encodeURIComponent(`${collectionNumber}-${rarity}`);

  return `${STACKER_IMAGE_BASE_URL}/${folder}/${fileName}.webp`;
}

export function getRepresentativeCardRelease(
  card: Pick<CardRecord, "collectionNumber"> & {
    releases?: readonly Pick<CardReleaseRecord, "collectionNumber" | "rarity">[];
  },
) {
  const sortedReleases = [...(card.releases ?? [])].sort(
    (a, b) => compareRarities(a.rarity, b.rarity) || a.collectionNumber.localeCompare(b.collectionNumber),
  );

  return sortedReleases[0] ?? { collectionNumber: card.collectionNumber, rarity: DEFAULT_LIST_RARITY };
}

export function getRepresentativeCardImageUrl(
  card: Pick<CardRecord, "collectionNumber"> & {
    releases?: readonly Pick<CardReleaseRecord, "collectionNumber" | "rarity">[];
  },
  quality: CardImageQuality,
) {
  return getReleaseCardImageUrl(getRepresentativeCardRelease(card), quality);
}

export function getReleaseCardImageUrl(release: Pick<CardReleaseRecord, "collectionNumber" | "rarity">, quality: CardImageQuality) {
  return getCardImageUrl(release.collectionNumber, release.rarity, quality);
}

export const packs: PackRecord[] = [
  {
    id: "bp01",
    name: "팩 이름 예시 1",
    releaseDate: "2026-05-18",
    codePrefix: "BP01",
  },
];

export const cards: CardRecord[] = [
  {
    id: "BP01-KR01",
    name: "카드명 예시 1",
    cardType: "MAIN",
    power: 2,
    activeCost: "1",
    activeEffect: "액티브 효과 텍스트를 입력합니다.",
    mainCost: "2",
    mainEffect: "메인 효과 텍스트를 입력합니다.",
    subCost: null,
    subEffect: null,
    collectionNumber: "BP01-KR01",
  },
  {
    id: "BP01-KR02",
    name: "카드명 예시 2",
    cardType: "SUB",
    power: null,
    activeCost: "1",
    activeEffect: "액티브 효과 텍스트를 입력합니다.",
    mainCost: null,
    mainEffect: null,
    subCost: "1",
    subEffect: "서브 효과 텍스트를 입력합니다.",
    collectionNumber: "BP01-KR02",
  },
  {
    id: "BP01-KR03",
    name: "카드명 예시 3",
    cardType: "ACTIVE",
    power: null,
    activeCost: "1",
    activeEffect: "액티브 효과 텍스트를 입력합니다.",
    mainCost: null,
    mainEffect: null,
    subCost: null,
    subEffect: null,
    collectionNumber: "BP01-KR03",
  },
  {
    id: "BP01-KR04",
    name: "카드명 예시 4",
    cardType: "MAIN",
    power: 3,
    activeCost: "1",
    activeEffect: "액티브 효과 텍스트를 입력합니다.",
    mainCost: "3",
    mainEffect: "메인 효과 텍스트를 입력합니다.",
    subCost: null,
    subEffect: null,
    collectionNumber: "BP01-KR04",
  },
];

export const cardReleases: CardReleaseRecord[] = [
  {
    id: createCardReleaseId("BP01-KR01", "N"),
    cardName: "카드명 예시 1",
    cardId: "BP01-KR01",
    rarity: "N",
    packId: "bp01",
    collectionNumber: "BP01-KR01",
  },
  {
    id: createCardReleaseId("BP01-KR01", "SR"),
    cardName: "카드명 예시 1",
    cardId: "BP01-KR01",
    rarity: "SR",
    packId: "bp01",
    collectionNumber: "BP01-KR01",
  },
  {
    id: createCardReleaseId("BP01-KR02", "N"),
    cardName: "카드명 예시 2",
    cardId: "BP01-KR02",
    rarity: "N",
    packId: "bp01",
    collectionNumber: "BP01-KR02",
  },
];

export function getCardReleases(cardId: string) {
  return cardReleases.filter((release) => release.cardId === cardId);
}

export function getPack(packId: string) {
  return packs.find((pack) => pack.id === packId) ?? null;
}
