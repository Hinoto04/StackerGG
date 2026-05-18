export type CardImageQuality = "list" | "detail";

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
   * 효과 - 줄바꿈을 포함할 수 있는 긴 텍스트
   */
  effect: string;

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
   * 카드 목록 대표 이미지에 사용할 수록 번호입니다.
   * 목록 이미지는 이 값과 레어도 N을 조합합니다.
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
  process.env.NEXT_PUBLIC_CARD_IMAGE_BASE_URL ?? "https://images.hinoto.kr/stackerbattle";
export const DEFAULT_LIST_RARITY = "N";

export function createCardReleaseId(collectionNumber: string, rarity: string) {
  return `${collectionNumber}-${rarity}`;
}

export function getCardImageUrl(collectionNumber: string, rarity: string, quality: CardImageQuality) {
  const folder = quality === "list" ? "webpsm" : "webp";
  const fileName = encodeURIComponent(`${collectionNumber}-${rarity}`);

  return `${STACKER_IMAGE_BASE_URL}/${folder}/${fileName}.webp`;
}

export function getRepresentativeCardImageUrl(card: Pick<CardRecord, "collectionNumber">, quality: CardImageQuality) {
  return getCardImageUrl(card.collectionNumber, DEFAULT_LIST_RARITY, quality);
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
    effect: "효과 텍스트를 입력합니다.\n줄바꿈이 필요한 경우 그대로 저장합니다.",
    cardType: "main",
    power: 2,
    collectionNumber: "BP01-KR01",
  },
  {
    id: "BP01-KR02",
    name: "카드명 예시 2",
    effect: "효과 텍스트를 입력합니다.",
    cardType: "sub",
    power: null,
    collectionNumber: "BP01-KR02",
  },
  {
    id: "BP01-KR03",
    name: "카드명 예시 3",
    effect: "효과 텍스트를 입력합니다.",
    cardType: "active",
    power: null,
    collectionNumber: "BP01-KR03",
  },
  {
    id: "BP01-KR04",
    name: "카드명 예시 4",
    effect: "효과 텍스트를 입력합니다.",
    cardType: "main",
    power: 3,
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
