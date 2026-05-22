ALTER TABLE "deck_cards"
ADD COLUMN "is_field" boolean NOT NULL DEFAULT false;

ALTER TABLE "deck_cards"
ADD CONSTRAINT "deck_cards_field_slot_type_check"
CHECK (NOT "is_field" OR "slot_type" IN ('MAIN', 'SUB'));

CREATE INDEX "deck_cards_is_field_idx" ON "deck_cards"("is_field");

CREATE UNIQUE INDEX "deck_cards_one_field_main_per_deck_idx"
ON "deck_cards"("deck_id")
WHERE "is_field" AND "slot_type" = 'MAIN';
