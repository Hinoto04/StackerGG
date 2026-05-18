CREATE TABLE "decks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "author_name" text,
  "description" text
);

CREATE TABLE "deck_cards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "deck_id" uuid NOT NULL,
  "card_id" uuid NOT NULL,
  "slot_type" text NOT NULL,
  "quantity" integer NOT NULL DEFAULT 1,
  "display_order" integer NOT NULL DEFAULT 0,
  CONSTRAINT "deck_cards_deck_id_fkey" FOREIGN KEY ("deck_id") REFERENCES "decks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "deck_cards_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "deck_cards_slot_type_check" CHECK ("slot_type" IN ('MAIN', 'SUB', 'ACTIVE')),
  CONSTRAINT "deck_cards_quantity_check" CHECK ("quantity" BETWEEN 1 AND 3)
);

CREATE UNIQUE INDEX "deck_cards_deck_card_unique" ON "deck_cards"("deck_id", "card_id");
CREATE INDEX "deck_cards_deck_id_idx" ON "deck_cards"("deck_id");
CREATE INDEX "deck_cards_card_id_idx" ON "deck_cards"("card_id");
CREATE INDEX "deck_cards_slot_type_idx" ON "deck_cards"("slot_type");
