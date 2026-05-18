DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "decks" WHERE "author_id" IS NULL) THEN
    IF NOT EXISTS (SELECT 1 FROM "users" WHERE "login_id" = 'legacy_deck_author') THEN
      INSERT INTO "users" ("login_id", "email", "display_name", "role")
      VALUES ('legacy_deck_author', 'legacy-deck-author@stacker.local', 'Legacy Deck Author', 'USER');
    END IF;

    UPDATE "decks"
    SET "author_id" = (
      SELECT "id"
      FROM "users"
      WHERE "login_id" = 'legacy_deck_author'
      LIMIT 1
    )
    WHERE "author_id" IS NULL;
  END IF;
END $$;

ALTER TABLE "decks" DROP CONSTRAINT IF EXISTS "decks_author_id_fkey";
ALTER TABLE "decks" ALTER COLUMN "author_id" SET NOT NULL;
ALTER TABLE "decks" ADD CONSTRAINT "decks_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "decks" DROP COLUMN IF EXISTS "author_name";
