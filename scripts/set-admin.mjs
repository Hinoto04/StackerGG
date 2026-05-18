import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";

config({ path: ".env.local" });
config();

const identifier = process.argv[2];
const role = (process.argv[3] ?? "ADMIN").toUpperCase();

if (!identifier || !["ADMIN", "USER"].includes(role)) {
  console.error("Usage: npm run user:admin -- <loginId-or-email> [ADMIN|USER]");
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  }),
});

try {
  const user = await prisma.user.update({
    where: identifier.includes("@") ? { email: identifier.toLowerCase() } : { loginId: identifier },
    data: { role },
    select: {
      loginId: true,
      email: true,
      role: true,
    },
  });

  console.log(`${user.loginId} <${user.email}> role=${user.role}`);
} finally {
  await prisma.$disconnect();
}
