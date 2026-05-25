export type EffectSourceZone = "deck" | "stack" | "trash";
export type EffectChoiceSourceZone = "deck" | "hand" | "stack" | "trash";
export type EffectTargetZone = "deckBottom" | "hand" | "stack" | "trash";
export type EffectCardType = "ACTIVE" | "MAIN" | "SUB";

export type EffectCardFilter = {
  cardType?: EffectCardType;
};

export type EffectChoiceAction = {
  type: "chooseCards";
  source: EffectChoiceSourceZone;
  target: EffectTargetZone;
  count: number;
  filter?: EffectCardFilter;
  prompt: string;
  shuffleDeckAfter?: boolean;
  selectedPowerResult?: "modifyMainPower";
  afterActions?: EffectAction[];
};

export type EffectDrawThenChooseAction = {
  type: "drawThenChooseCards";
  drawCount: number;
  chooseCount: number;
  target: EffectTargetZone;
  filter?: EffectCardFilter;
  prompt: string;
};

export type EffectNumberInputAction = {
  type: "inputNumber";
  prompt: string;
  result: "draw" | "damageOpponent" | "moveTrashTopToDeckBottom" | "modifyMainPower";
  min?: number;
  defaultValue?: number;
};

export type EffectBooleanInputAction = {
  type: "inputBoolean";
  prompt: string;
  trueLabel?: string;
  falseLabel?: string;
  trueActions?: EffectAction[];
  falseActions?: EffectAction[];
  trueNotice?: string;
  falseNotice?: string;
};

export type EffectCardTypeDeclarationAction = {
  type: "inputCardType";
  prompt: string;
  trueActions?: EffectAction[];
  falseActions?: EffectAction[];
  trueNotice?: string;
  falseNotice?: string;
};

export type EffectInputAction = EffectNumberInputAction | EffectBooleanInputAction | EffectCardTypeDeclarationAction;

export type EffectAction =
  | {
      type: "draw";
      count: number;
    }
  | {
      type: "mulliganHand";
    }
  | {
      type: "drawThenTrashNonActive";
      count: number;
    }
  | EffectDrawThenChooseAction
  | {
      type: "moveTop";
      from: EffectSourceZone;
      to: EffectTargetZone;
      count: number;
    }
  | {
      type: "damageOpponent";
      amount: number;
    }
  | {
      type: "damageSelf";
      amount: number;
    }
  | {
      type: "changeOpponentLife";
      amount: number;
    }
  | {
      type: "modifyMainPower";
      amount: number;
    }
  | EffectInputAction
  | EffectChoiceAction;

export type ManualEffectStep = {
  reason: string;
  text: string;
};

export type CompiledEffect = {
  actions: EffectAction[];
  manualSteps: ManualEffectStep[];
};

function getFirstCount(text: string, fallback = 1) {
  const match = text.match(/(\d+)\s*장/);

  return match ? Number(match[1]) : fallback;
}

function getSelectedCount(text: string, fallback = getFirstCount(text)) {
  const directMatches = [...text.matchAll(/(\d+)\s*장을?\s*(?:선택|고른|골라)/g)];

  if (directMatches.length > 0) {
    return Number(directMatches.at(-1)?.[1] ?? fallback);
  }

  const selectedAfterMatch = text.match(/(?:선택한|고른)\s*(\d+)\s*장/);

  return selectedAfterMatch ? Number(selectedAfterMatch[1]) : fallback;
}

function normalizeEffectText(text: string) {
  return text
    .replace(/\s+/g, " ")
    .replace(/０/g, "0")
    .replace(/１/g, "1")
    .replace(/２/g, "2")
    .replace(/３/g, "3")
    .replace(/４/g, "4")
    .replace(/５/g, "5")
    .replace(/수 만큼/g, "수만큼")
    .trim();
}

function splitEffectSentences(text: string) {
  return normalizeEffectText(text)
    .split(/(?<=다\.|한다\.|된다\.|없다\.|있다\.)\s*/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function getCardTypeFilter(sentence: string): EffectCardFilter | undefined {
  if (sentence.includes("액티브 스태커")) {
    return { cardType: "ACTIVE" };
  }

  if (sentence.includes("메인 스태커")) {
    return { cardType: "MAIN" };
  }

  if (sentence.includes("서브 스태커")) {
    return { cardType: "SUB" };
  }

  return undefined;
}

function manual(reason: string, text: string): ManualEffectStep {
  return {
    reason,
    text,
  };
}

function choiceAction(
  source: EffectChoiceSourceZone,
  target: EffectTargetZone,
  count: number,
  prompt: string,
  sentence: string,
  options?: Pick<EffectChoiceAction, "afterActions" | "selectedPowerResult" | "shuffleDeckAfter">,
): EffectChoiceAction {
  return {
    type: "chooseCards",
    source,
    target,
    count,
    filter: getCardTypeFilter(sentence),
    prompt,
    ...options,
  };
}

function hasUnresolvedTimingOrBranch(sentence: string) {
  return (
    /다음\s*(?:턴|자신의 턴|상대)/.test(sentence) ||
    /이번 턴.*때마다/.test(sentence) ||
    /때마다/.test(sentence) ||
    /공격하려면/.test(sentence) ||
    /맞으면|틀리면/.test(sentence) ||
    /일 때/.test(sentence) ||
    /같도록/.test(sentence)
  );
}

function hasOnlyManualRuleText(sentence: string) {
  return (
    /발동할 수 있다/.test(sentence) ||
    /한 턴에 한 번/.test(sentence) ||
    /코스트/.test(sentence) ||
    /파워/.test(sentence) ||
    /공격할 수/.test(sentence) ||
    /대미지(?:를|가).*감소/.test(sentence) ||
    /드로우 페이즈|스킵/.test(sentence) ||
    /원하는 순서대로/.test(sentence) ||
    /선언/.test(sentence) ||
    /확인한다/.test(sentence)
  );
}

function getHandChoiceTarget(sentence: string): EffectTargetZone | null {
  if (/트래시/.test(sentence)) {
    return "trash";
  }

  if (/덱 맨 아래|덱에 넣/.test(sentence)) {
    return "deckBottom";
  }

  if (/스택 존/.test(sentence)) {
    return "stack";
  }

  return null;
}

function buildHandChoicePrompt(target: EffectTargetZone, sentence: string) {
  if (sentence.includes("상대가 선택")) {
    return "상대가 선택한 것으로 처리할 손패를 선택하세요.";
  }

  if (target === "trash") {
    return "트래시할 손패를 선택하세요.";
  }

  if (target === "deckBottom") {
    return "덱 맨 아래로 보낼 손패를 선택하세요.";
  }

  return "스택 존으로 보낼 손패를 선택하세요.";
}

function compileSequentialOwnDrawThenHandChoice(sentence: string): EffectAction[] | null {
  const drawMatch = sentence.match(/자신은\s*(\d+)\s*장\s*드로우/);

  if (!drawMatch) {
    return null;
  }

  const target = getHandChoiceTarget(sentence);

  if (!target || !/(패|그 중|드로우한 카드).*(\d+)\s*장/.test(sentence)) {
    return null;
  }

  const countMatch = sentence.match(/(?:패|그 중|드로우한 카드)[^.]*?(\d+)\s*장을?/);
  const count = countMatch ? Number(countMatch[1]) : 1;

  return [
    /그 중|드로우한 카드/.test(sentence)
      ? {
          type: "drawThenChooseCards",
          drawCount: Number(drawMatch[1]),
          chooseCount: count,
          target,
          filter: getCardTypeFilter(sentence),
          prompt: buildHandChoicePrompt(target, sentence),
        }
      : { type: "draw", count: Number(drawMatch[1]) },
    ...(/그 중|드로우한 카드/.test(sentence) ? [] : [choiceAction("hand", target, count, buildHandChoicePrompt(target, sentence), sentence)]),
  ];
}

function compileSentence(sentence: string): { actions: EffectAction[]; manualSteps: ManualEffectStep[] } {
  const actions: EffectAction[] = [];
  const manualSteps: ManualEffectStep[] = [];

  if (!sentence) {
    return { actions, manualSteps };
  }

  if (/덱에 넣은 수만큼\s*드로우/.test(sentence)) {
    return { actions, manualSteps };
  }

  if (/카드 종류를 선언하고 드로우/.test(sentence)) {
    if (/맞으면\s*상대에게\s*\d+\s*대미지/.test(sentence)) {
      const opponentDamage = Number(sentence.match(/상대에게\s*(\d+)\s*대미지/)?.[1] ?? 1);
      const selfDamage = Number(sentence.match(/자신에게\s*(\d+)\s*대미지/)?.[1] ?? 0);

      actions.push({
        type: "inputCardType",
        prompt: "선언할 카드 타입을 선택하세요.",
        trueActions: [{ type: "damageOpponent", amount: opponentDamage }],
        falseActions: selfDamage > 0 ? [{ type: "damageSelf", amount: selfDamage }] : undefined,
        falseNotice: selfDamage > 0 ? undefined : "틀렸을 때 자신이 받는 대미지는 수동 처리하세요.",
      });
      return { actions, manualSteps };
    }

    if (/맞으면.*자신의 트래시 존에서.*선택.*(?:패|손|추가)/.test(sentence)) {
      actions.push({
        type: "inputCardType",
        prompt: "선언할 카드 타입을 선택하세요.",
        trueActions: [choiceAction("trash", "hand", getSelectedCount(sentence), "손으로 가져올 트래시 카드를 선택하세요.", sentence)],
        falseActions: [{ type: "changeOpponentLife", amount: getSelectedCount(sentence) }],
        falseNotice: "틀렸을 때 상대 트래시에서 상대 덱으로 돌아가는 처리는 상대 라이프 회복으로 처리했습니다.",
      });
      return { actions, manualSteps };
    }

    if (/맞으면.*트래시 존 맨 위에서\s*\d+\s*장.*스택 존/.test(sentence)) {
      actions.push({
        type: "inputCardType",
        prompt: "선언할 카드 타입을 선택하세요.",
        trueActions: [
          {
            type: "moveTop",
            from: "trash",
            to: "stack",
            count: getFirstCount(sentence),
          },
        ],
        falseActions: [
          {
            type: "moveTop",
            from: "stack",
            to: "trash",
            count: 1,
          },
        ],
      });
      return { actions, manualSteps };
    }

    if (/맞으면.*자신(?:의)?\s*메인 스태커의 파워를\s*\d+\s*상승/.test(sentence)) {
      actions.push({
        type: "inputCardType",
        prompt: "선언할 카드 타입을 선택하세요.",
        trueActions: [
          {
            type: "modifyMainPower",
            amount: Number(sentence.match(/파워를\s*(\d+)\s*상승/)?.[1] ?? 0),
          },
        ],
        falseNotice: "틀렸을 때의 후속 효과는 수동 처리하세요.",
      });
      return { actions, manualSteps };
    }

    actions.push({
      type: "inputCardType",
      prompt: "선언할 카드 타입을 선택하세요.",
      trueNotice: "맞았을 때의 후속 효과는 수동 처리하세요.",
      falseNotice: "틀렸을 때의 후속 효과는 수동 처리하세요.",
    });
    return { actions, manualSteps };
  }

  if (hasUnresolvedTimingOrBranch(sentence)) {
    manualSteps.push(manual("조건·지속·분기 효과라서 현재 상태에서 자동 적용하지 않습니다.", sentence));
    return { actions, manualSteps };
  }

  const sequentialDrawThenChoice = compileSequentialOwnDrawThenHandChoice(sentence);

  if (sequentialDrawThenChoice) {
    actions.push(...sequentialDrawThenChoice);
    return { actions, manualSteps };
  }

  if (/자신은\s*\d+\s*장\s*드로우.*그 중 액티브 스태커가 아닌 카드를 모두 트래시/.test(sentence)) {
    actions.push({
      type: "drawThenTrashNonActive",
      count: getFirstCount(sentence),
    });

    return { actions, manualSteps };
  }

  if (/자신과 상대의 패를 모두 덱에 넣고 셔플/.test(sentence)) {
    actions.push({ type: "mulliganHand" });
    manualSteps.push(manual("상대 패는 모델링하지 않으므로 상대 쪽 패 셔플/재드로우는 수동 확인이 필요합니다.", sentence));
    return { actions, manualSteps };
  }

  if (/자신의 패를 모두 덱에 넣고 셔플/.test(sentence)) {
    actions.push({ type: "mulliganHand" });
    return { actions, manualSteps };
  }

  if (/자신(?:의)?\s*메인 스태커의 파워를\s*\d+\s*상승/.test(sentence)) {
    actions.push({
      type: "modifyMainPower",
      amount: Number(sentence.match(/파워를\s*(\d+)\s*상승/)?.[1] ?? 0),
    });

    return { actions, manualSteps };
  }

  if (/패에서\s*메인 스태커\s*\d+\s*장을?\s*트래시.*트래시한 메인 스태커의 파워만큼.*자신(?:의)?\s*메인 스태커의 파워를 상승/.test(sentence)) {
    actions.push(
      choiceAction("hand", "trash", getFirstCount(sentence), "트래시할 메인 스태커를 선택하세요.", sentence, {
        selectedPowerResult: "modifyMainPower",
      }),
    );

    return { actions, manualSteps };
  }

  if (/트래시한 메인 스태커의 파워만큼.*자신(?:의)?\s*메인 스태커의 파워를 상승/.test(sentence)) {
    actions.push({
      type: "inputNumber",
      prompt: "트래시한 메인 스태커의 파워를 입력하세요.",
      result: "modifyMainPower",
      min: 0,
      defaultValue: 1,
    });

    return { actions, manualSteps };
  }

  if (/파워만큼.*트래시 존 맨 위.*덱 맨 아래/.test(sentence)) {
    actions.push({
      type: "inputNumber",
      prompt: "이 효과로 덱 맨 아래로 보낼 카드 수를 입력하세요.",
      result: "moveTrashTopToDeckBottom",
      min: 0,
      defaultValue: 1,
    });

    return { actions, manualSteps };
  }

  if (/상대.*덱 맨 위.*트래시/.test(sentence)) {
    actions.push({
      type: "changeOpponentLife",
      amount: -getSelectedCount(sentence),
    });

    if (/확인|보고/.test(sentence)) {
      manualSteps.push(manual("상대 덱 확인/선택은 실제 카드 내용 대신 상대 라이프 감소로만 처리했습니다.", sentence));
    }

    return { actions, manualSteps };
  }

  if (/상대.*덱 맨 위.*스택 존/.test(sentence)) {
    actions.push({
      type: "changeOpponentLife",
      amount: -getFirstCount(sentence),
    });
    manualSteps.push(manual("상대 스택 존은 별도 영역이 없어 상대 덱 매수 감소만 처리했습니다.", sentence));
    return { actions, manualSteps };
  }

  if (/상대는\s*\d+\s*장\s*드로우/.test(sentence)) {
    actions.push({
      type: "changeOpponentLife",
      amount: -getFirstCount(sentence),
    });

    if (/액티브|덱 맨 아래|트래시|서로 확인/.test(sentence)) {
      manualSteps.push(manual("상대가 드로우한 카드의 공개/타입/이후 위치 처리는 수동 확인이 필요합니다.", sentence));
    }

    return { actions, manualSteps };
  }

  if (/상대.*트래시 존.*(?:상대.*덱|덱 맨 아래|덱 맨 위|덱에 넣)/.test(sentence)) {
    actions.push({
      type: "changeOpponentLife",
      amount: getSelectedCount(sentence),
    });
    manualSteps.push(manual("상대 트래시에서 상대 덱으로 돌아가는 카드는 상대 라이프 회복으로 처리했습니다.", sentence));
    return { actions, manualSteps };
  }

  if (/서로는.*트래시 존 맨 위.*덱 맨 아래/.test(sentence)) {
    const count = getFirstCount(sentence);
    actions.push(
      {
        type: "moveTop",
        from: "trash",
        to: "deckBottom",
        count,
      },
      {
        type: "changeOpponentLife",
        amount: count,
      },
    );
    return { actions, manualSteps };
  }

  if (/서로는.*덱 맨 위.*트래시/.test(sentence)) {
    const count = getFirstCount(sentence);
    actions.push(
      {
        type: "moveTop",
        from: "deck",
        to: "trash",
        count,
      },
      {
        type: "changeOpponentLife",
        amount: -count,
      },
    );
    return { actions, manualSteps };
  }

  if (/서로는.*덱 맨 위.*스택 존/.test(sentence)) {
    const count = getFirstCount(sentence);
    actions.push(
      {
        type: "moveTop",
        from: "deck",
        to: "stack",
        count,
      },
      {
        type: "changeOpponentLife",
        amount: -count,
      },
    );
    return { actions, manualSteps };
  }

  if (/자신.*덱.*(?:찾|선택).*(?:패|손|추가)/.test(sentence)) {
    actions.push(
      choiceAction("deck", "hand", getSelectedCount(sentence), "덱에서 손으로 가져올 카드를 선택하세요.", sentence, {
        shuffleDeckAfter: /셔플/.test(sentence),
      }),
    );

    return { actions, manualSteps };
  }

  if (/자신.*트래시 존에서.*선택.*덱(?: 맨 아래|에 넣)/.test(sentence)) {
    actions.push(
      choiceAction(
        "trash",
        "deckBottom",
        getSelectedCount(sentence),
        sentence.includes("이 카드 이외") ? "덱으로 되돌릴 트래시 카드(이 카드 이외)를 선택하세요." : "덱으로 되돌릴 트래시 카드를 선택하세요.",
        sentence,
        {
          shuffleDeckAfter: /셔플/.test(sentence),
        },
      ),
    );

    return { actions, manualSteps };
  }

  if (/자신.*트래시 존에서.*선택.*(?:패|손|추가)/.test(sentence)) {
    actions.push(choiceAction("trash", "hand", getSelectedCount(sentence), "손으로 가져올 트래시 카드를 선택하세요.", sentence));
    return { actions, manualSteps };
  }

  if (/자신.*스택 존.*선택.*(?:패|손|추가)/.test(sentence)) {
    actions.push(choiceAction("stack", "hand", getSelectedCount(sentence), "손으로 가져올 스택 카드를 선택하세요.", sentence));
    return { actions, manualSteps };
  }

  if (/서로는.*(?:패|손패).*\d+\s*장.*덱 맨 아래/.test(sentence)) {
    const count = getSelectedCount(sentence);
    actions.push(
      choiceAction("hand", "deckBottom", count, "덱 맨 아래로 보낼 손패를 선택하세요.", sentence),
      {
        type: "changeOpponentLife",
        amount: count,
      },
    );

    return { actions, manualSteps };
  }

  const handChoiceTarget = /(?:패|손패)/.test(sentence) ? getHandChoiceTarget(sentence) : null;

  if (handChoiceTarget) {
    const afterDrawMatch = sentence.match(/(\d+)\s*장\s*드로우/);
    actions.push(
      choiceAction("hand", handChoiceTarget, getSelectedCount(sentence), buildHandChoicePrompt(handChoiceTarget, sentence), sentence, {
        afterActions: afterDrawMatch ? [{ type: "draw", count: Number(afterDrawMatch[1]) }] : undefined,
      }),
    );

    return { actions, manualSteps };
  }

  if (/드로우한 카드.*선택한\s*\d+\s*장.*트래시/.test(sentence)) {
    actions.push(choiceAction("hand", "trash", getSelectedCount(sentence), "트래시할 드로우 카드를 선택하세요.", sentence));
    return { actions, manualSteps };
  }

  if (/상대에게\s*\d+\s*대미지/.test(sentence)) {
    const amount = Number(sentence.match(/상대에게\s*(\d+)\s*대미지/)?.[1] ?? 1);

    actions.push({
      type: "damageOpponent",
      amount,
    });

    return { actions, manualSteps };
  }

  if (/자신에게\s*\d+\s*대미지/.test(sentence)) {
    const amount = Number(sentence.match(/자신에게\s*(\d+)\s*대미지/)?.[1] ?? 1);

    actions.push({
      type: "damageSelf",
      amount,
    });

    return { actions, manualSteps };
  }

  if (/받은 대미지.*상대에게.*대미지|받은 대미지만큼\s*상대에게\s*대미지/.test(sentence)) {
    actions.push({
      type: "inputNumber",
      prompt: "상대에게 줄 대미지 수치를 입력하세요.",
      result: "damageOpponent",
      min: 0,
      defaultValue: 1,
    });

    return { actions, manualSteps };
  }

  if (/드로우/.test(sentence)) {
    if (/파워만큼/.test(sentence)) {
      actions.push({
        type: "inputNumber",
        prompt: "드로우할 카드 수를 입력하세요.",
        result: "draw",
        min: 0,
        defaultValue: 1,
      });

      return { actions, manualSteps };
    }

    if (/수만큼|파워만큼|모두|그 중|중\s*액티브/.test(sentence)) {
      manualSteps.push(manual("드로우 수나 드로우한 카드의 후속 처리가 현재 상태에 따라 달라집니다.", sentence));
      return { actions, manualSteps };
    }

    actions.push({
      type: "draw",
      count: getFirstCount(sentence),
    });

    return { actions, manualSteps };
  }

  if (/까지/.test(sentence)) {
    manualSteps.push(manual("‘까지’가 포함된 선택 수량은 플레이어가 실제 수량을 정해야 하므로 수동 처리합니다.", sentence));
    return { actions, manualSteps };
  }

  if (/덱 맨 위에서.*(?:카드\s*)?\d+\s*장.*트래시/.test(sentence)) {
    actions.push({
      type: "moveTop",
      from: "deck",
      to: "trash",
      count: getFirstCount(sentence),
    });

    return { actions, manualSteps };
  }

  if (/덱 맨 위에서.*(?:카드\s*)?\d+\s*장.*스택 존/.test(sentence)) {
    actions.push({
      type: "moveTop",
      from: "deck",
      to: "stack",
      count: getFirstCount(sentence),
    });

    return { actions, manualSteps };
  }

  if (/트래시 존 맨 위에서.*(?:카드\s*)?\d+\s*장.*스택 존/.test(sentence)) {
    actions.push({
      type: "moveTop",
      from: "trash",
      to: "stack",
      count: getFirstCount(sentence),
    });

    return { actions, manualSteps };
  }

  if (/트래시 존 맨 위(?:에서)?.*(?:카드\s*)?\d+\s*장.*덱 맨 아래/.test(sentence)) {
    actions.push({
      type: "moveTop",
      from: "trash",
      to: "deckBottom",
      count: getFirstCount(sentence),
    });

    return { actions, manualSteps };
  }

  if (/스택 존 맨 위에서.*(?:카드\s*)?\d+\s*장.*트래시/.test(sentence)) {
    actions.push({
      type: "moveTop",
      from: "stack",
      to: "trash",
      count: getFirstCount(sentence),
    });

    return { actions, manualSteps };
  }

  if (/스택 존 맨 위에서.*(?:카드\s*)?\d+\s*장.*덱 맨 아래/.test(sentence)) {
    actions.push({
      type: "moveTop",
      from: "stack",
      to: "deckBottom",
      count: getFirstCount(sentence),
    });

    return { actions, manualSteps };
  }

  if (/(?:패|손패|트래시 존|트래시|스택 존).*(선택)/.test(sentence)) {
    manualSteps.push(manual("선택 대상 또는 이동 위치를 규칙으로 해석하지 못했습니다.", sentence));
    return { actions, manualSteps };
  }

  if (hasOnlyManualRuleText(sentence)) {
    manualSteps.push(manual("상태 변경, 제한, 확인 또는 정렬 효과라서 현재 자동 처리 범위 밖입니다.", sentence));
    return { actions, manualSteps };
  }

  manualSteps.push(manual("아직 자동 처리 규칙이 없는 효과입니다.", sentence));
  return { actions, manualSteps };
}

export function compileEffectText(text: string): CompiledEffect {
  const actions: EffectAction[] = [];
  const manualSteps: ManualEffectStep[] = [];
  const sentences = splitEffectSentences(text);

  for (let index = 0; index < sentences.length; index += 1) {
    let sentence = sentences[index];

    if (/카드 종류를 선언하고 드로우/.test(sentence)) {
      while (sentences[index + 1] && /^(맞으면|틀리면)/.test(sentences[index + 1])) {
        index += 1;
        sentence = `${sentence} ${sentences[index]}`;
      }
    }

    if (/자신은\s*\d+\s*장\s*드로우/.test(sentence)) {
      while (sentences[index + 1] && /^(그 중|드로우한 카드)/.test(sentences[index + 1])) {
        index += 1;
        sentence = `${sentence} ${sentences[index]}`;
      }
    }

    if (/패에서\s*메인 스태커.*트래시/.test(sentence)) {
      while (sentences[index + 1] && /^트래시한 메인 스태커의 파워만큼/.test(sentences[index + 1])) {
        index += 1;
        sentence = `${sentence} ${sentences[index]}`;
      }
    }

    const compiled = compileSentence(sentence);
    actions.push(...compiled.actions);
    manualSteps.push(...compiled.manualSteps);
  }

  return {
    actions,
    manualSteps,
  };
}
