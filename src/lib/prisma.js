import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis;

function buildPrismaClient() {
  const baseUrl = process.env.DATABASE_URL || "";
  const separator = baseUrl.includes("?") ? "&" : "?";
  const poolUrl = `${baseUrl}${separator}connection_limit=25&pool_timeout=60`;

  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    datasources: {
      db: { url: poolUrl },
    },
  });
}

const prisma = globalForPrisma.__prisma ?? buildPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__prisma = prisma;
}

export default prisma;
