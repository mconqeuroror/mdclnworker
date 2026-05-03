-- Sexting Scripts: reusable NSFW photo-sequence blueprints.
-- `SextingScript`      — one script (built-in or user-owned) with N scenes + AI-expanded templates.
-- `SextingScriptRun`   — one execution of a script, grouping the generated Generation rows.

CREATE TABLE "SextingScript" (
    "id"                TEXT NOT NULL,
    "userId"            TEXT,
    "slug"              TEXT,
    "name"              TEXT NOT NULL,
    "description"       TEXT,
    "isBuiltIn"         BOOLEAN NOT NULL DEFAULT false,
    "isPublic"          BOOLEAN NOT NULL DEFAULT false,
    "picCount"          INTEGER NOT NULL,
    "creditsPerPic"     INTEGER NOT NULL,
    "sceneDescriptions" JSONB NOT NULL DEFAULT '[]',
    "basePrompts"       JSONB NOT NULL DEFAULT '[]',
    "themeHint"         TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SextingScript_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SextingScript_slug_key"      ON "SextingScript"("slug");
CREATE        INDEX "SextingScript_userId_idx"    ON "SextingScript"("userId");
CREATE        INDEX "SextingScript_isBuiltIn_idx" ON "SextingScript"("isBuiltIn");

ALTER TABLE "SextingScript"
    ADD CONSTRAINT "SextingScript_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


CREATE TABLE "SextingScriptRun" (
    "id"            TEXT NOT NULL,
    "scriptId"      TEXT NOT NULL,
    "userId"        TEXT NOT NULL,
    "modelId"       TEXT NOT NULL,
    "outfit"        TEXT NOT NULL,
    "environment"   TEXT NOT NULL,
    "generationIds" JSONB NOT NULL DEFAULT '[]',
    "status"        TEXT NOT NULL DEFAULT 'running',
    "creditsSpent"  INTEGER NOT NULL DEFAULT 0,
    "errorMessage"  TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt"   TIMESTAMP(3),

    CONSTRAINT "SextingScriptRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SextingScriptRun_scriptId_idx" ON "SextingScriptRun"("scriptId");
CREATE INDEX "SextingScriptRun_userId_idx"   ON "SextingScriptRun"("userId");

ALTER TABLE "SextingScriptRun"
    ADD CONSTRAINT "SextingScriptRun_scriptId_fkey"
    FOREIGN KEY ("scriptId") REFERENCES "SextingScript"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SextingScriptRun"
    ADD CONSTRAINT "SextingScriptRun_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
