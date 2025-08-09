import "dotenv/config";
import { dbClient } from "@db/client.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { users, events } from "@db/schema.js"; // ใช้ schema ที่คุณมี
import { eq, and, count } from "drizzle-orm";
import cors from "cors";
import Debug from "debug";
import type { ErrorRequestHandler } from "express";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import type  { JwtPayload } from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
const debug = Debug("pf-backend");

dotenv.config();

//Intializing the express app
const app = express();

//Middleware
app.use(morgan("dev", { immediate: false }));
app.use(helmet());
app.use(
  cors({
    origin: false, // Disable CORS
    // origin: "*", // Allow all origins
  })
);
// Extracts the entire body portion of an incoming request stream and exposes it on req.body.
app.use(express.json());

const JWT_SECRET = 'secret'

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; isAdmin: boolean };
    }
  }
}

// ===== REGISTER =====
app.post("/auth/register", async (req, res, next) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) throw new Error("Missing fields");

    const hash = await bcrypt.hash(password, 10);
    const inserted = await dbClient.insert(users).values({
      id: crypto.randomUUID(),
      email,
      passwordHash: hash,
      name,
    });
    res.status(201).json({ message: "User registered" });
  } catch (err) {
    next(err);
  }
});

// ===== LOGIN =====
app.post("/auth/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const [user] = await dbClient.select().from(users).where(eq(users.email, email));
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: "Invalid credentials" });

    req.session

    const token = jwt.sign({ id: user.id, name: user.name }, JWT_SECRET, { expiresIn: '1h'} );
    res.cookie("token", token, {
      maxAge: 3600
    });
    res.json({ 
      message: 'login success',
      token 
    });
  } catch (err) {
    next(err);
  }
});

// ===== Middleware เช็ค JWT =====
function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; isAdmin: boolean };
    req.user = decoded
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// ===== GET ALL EVENTS =====
app.get("/events", authMiddleware, async (req, res, next) => {
  try {
    const allEvents = await dbClient.query.events.findMany();

    res.json({
      message: "Get All Event Successful!!!",
      events: allEvents,
    });
  } catch (err) {
    next(err);
  }
});

// ===== CREATE EVENT (admin only) =====
app.post("/events", authMiddleware, async (req, res, next) => {
  try {
    const user_id = req.user!.id
    const { title, description, imageUrl, maxParticipants, eventDate } = req.body;
    await dbClient.insert(events).values({
      id: crypto.randomUUID(),
      title,
      description,
      imageUrl,
      maxParticipants,
      eventDate: new Date(eventDate),
      createBy: user_id
    });
    res.status(201).json({ message: "Event created" });
  } catch (err) {
    next(err);
  }
});

// ===== UPDATE EVENT (user's event only) =====
app.patch("/events", authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { id, title, description, imageUrl, maxParticipants, eventDate } = req.body;

      // ตรวจสอบว่าเป็นเจ้าของ event
    const [existing] = await dbClient.select().from(events).where(eq(events.id, id));
    if (!existing) return res.status(404).json({ error: "Event not found" });
    if (existing.createBy !== userId) return res.status(403).json({ error: "Forbidden" });

    await dbClient.update(events).set({
      title,
      description,
      imageUrl,
      maxParticipants,
      eventDate: new Date(eventDate),
    }).where(eq(events.id, id));

    res.json({ message: "Event updated" });
  } catch (err) {
    next(err);
  }
});

// ===== DELETE EVENT (user's event only) =====
app.delete("/events", authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { id } = req.body;

    const [existing] = await dbClient.select().from(events).where(eq(events.id, id));
    if (!existing) return res.status(404).json({ error: "Event not found" });
    if (existing.createBy !== userId) return res.status(403).json({ error: "Forbidden" });

    await dbClient.delete(events).where(eq(events.id, id));
    res.json({ message: "Event deleted" });
    
  } catch (err) {
    next(err);   
  }
});

app.patch("/events/done", authMiddleware, async (req, res, next) => {
  try {
    const { id, isDone } = req.body;

    // ตรวจสอบสิทธิ์: ต้องเป็นเจ้าของ event หรือ admin
    const event = await dbClient.select().from(events).where(eq(events.id, id)).limit(1);
    if (!event.length) {
      return res.status(404).json({ error: "Event not found" });
    }

    // อัปเดตสถานะ
    await dbClient
      .update(events)
      .set({ isDone })
      .where(eq(events.id, id));

    res.json({ success: true , event: id });
  } catch (err) {
    next(err);
  }
});

// JSON Error Middleware
const jsonErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
  debug(err.message);
  const errorResponse = {
    message: err.message || "Internal Server Error",
    type: err.name || "Error",
    stack: err.stack,
  };
  res.status(500).send(errorResponse);
};
app.use(jsonErrorHandler);

// Running app
const PORT = process.env.PORT || 3000;
// * Running app
app.listen(PORT, async () => {
  debug(`Listening on port ${PORT}: http://localhost:${PORT}`);
});