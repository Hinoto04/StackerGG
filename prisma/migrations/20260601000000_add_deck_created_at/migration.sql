ALTER TABLE "decks"
ADD COLUMN "created_at" timestamptz NOT NULL DEFAULT now();

CREATE INDEX "decks_created_at_idx" ON "decks"("created_at");
