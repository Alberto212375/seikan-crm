const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL || "admin@local.test";
  const password = process.env.SEED_ADMIN_PASSWORD || "Admin123!";

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const prisma = new PrismaClient({
    adapter: new PrismaPg(pool),
    log: ["error", "warn"],
  });

  try {
    const hash = await bcrypt.hash(password, 10);

    // ✅ Upsert "updatable" : force role ADMIN + update password/name à chaque seed
    await prisma.user.upsert({
      where: { email },
      update: { password: hash, name: "Admin", role: "ADMIN" },
      create: { email, password: hash, name: "Admin", role: "ADMIN" },
    });

    console.log("Seed OK:", { email, password });
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
