-- Ban-lock: full API/session lockout when true (enforced in auth middleware + login/refresh).
ALTER TABLE "User" ADD COLUMN "banLocked" BOOLEAN NOT NULL DEFAULT false;
