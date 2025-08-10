import { eq } from "drizzle-orm";
import { dbClient, dbConn } from "@db/client.js";
import { users } from "@db/schema.js";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

dotenv.config();

async function insertAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error("❌ Please set ADMIN_EMAIL and ADMIN_PASSWORD in .env");
    dbConn.end();
    return;
  }

  // ตรวจสอบว่า admin มีอยู่แล้วหรือยัง
  const existing = await dbClient.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (existing) {
    console.log("⚠️ Admin user already exists:", existing.email);
    dbConn.end();
    return;
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  await dbClient.insert(users).values({
    name: "Admin",
    email: email,
    passwordHash: hashedPassword,
  });

  console.log("✅ Admin inserted:", email);
  dbConn.end();
}

insertAdmin();
