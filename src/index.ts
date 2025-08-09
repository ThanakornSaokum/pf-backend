import "dotenv/config";
import { dbClient } from "@db/client.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { users, events, eventParticipants } from "@db/schema.js"; // ใช้ schema ที่คุณมี
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
      isAdmin: false,
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

    const token = jwt.sign({ id: user.id, isAdmin: user.isAdmin }, JWT_SECRET, { expiresIn: '1h'} );
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
    const allEvents = await dbClient
      .select({
        id: events.id,
        title: events.title,
        description: events.description,
        imageUrl: events.imageUrl,
        maxParticipants: events.maxParticipants,
        eventDate: events.eventDate,
        totalParticipants: count(eventParticipants.eventId),
      })
      .from(events)
      .leftJoin(eventParticipants, eq(events.id, eventParticipants.eventId))
      .groupBy(events.id);

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
    const { title, description, imageUrl, maxParticipants, eventDate } = req.body;
    await dbClient.insert(events).values({
      id: crypto.randomUUID(),
      title,
      description,
      imageUrl,
      maxParticipants,
      eventDate: new Date(eventDate),
    });
    res.status(201).json({ message: "Event created" });
  } catch (err) {
    next(err);
  }
});

// ===== UPDATE EVENT (admin only) =====
app.patch("/events", authMiddleware, async (req, res, next) => {
  try {
    const { id, title, description, imageUrl, maxParticipants, eventDate } = req.body;
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

// ===== DELETE EVENT (admin only) =====
app.delete("/events", authMiddleware, async (req, res, next) => {
  try {
    const { id } = req.body;
    await dbClient.delete(events).where(eq(events.id, id));
    res.json({ message: "Event deleted" });
  } catch (err) {
    next(err);   
  }
});

// ===== JOIN EVENT (user only) =====
app.post("/events/join", authMiddleware, async (req, res, next) => {
  try {
    const eventId = req.body;
    const userId = req.user?.id; // ใช้ userId จาก req.user

    if (!userId) return res.status(401).json({ error: "Not found User!" });

    // Check the user is available
    const [user] = await dbClient.select().from(users).where(eq(users.id, userId));
    if (!user) return res.status(400).json({ error: "Not found that user" });

    // Check count joined
    const countResult = await dbClient
      .select({ count: count() })
      .from(eventParticipants)
      .where(eq(eventParticipants.eventId, eventId));

    const [event] = await dbClient.select().from(events).where(eq(events.id, eventId));
    if (!event) return res.status(404).json({ error: "Event not found" });

    if (countResult[0].count >= event.maxParticipants)
      return res.status(400).json({ error: "Event full" });

    // join ได้
    await dbClient.insert(eventParticipants).values({
      userId,
      eventId,
    });
    res.json({ message: "Joined event" });
  } catch (err) {
    next(err);
  }
});

// ===== CANCEL EVENT PARTICIPATION (user only) =====
app.post("/events/cancel", authMiddleware, async (req, res, next) => {
  try {
    const eventId = req.body
    const userId = req.user?.id;

    if (!userId) return res.status(401).json({ error: "User not found" });

    // ตรวจสอบว่า user มีอยู่ในระบบ
    const [user] = await dbClient.select().from(users).where(eq(users.id, userId));
    if (!user) return res.status(400).json({ error: "User that not found" });

    // ตรวจสอบว่า event มีอยู่
    const [event] = await dbClient.select().from(events).where(eq(events.id, eventId));
    if (!event) return res.status(404).json({ error: "Not Found Event" });

    // ตรวจสอบว่าผู้ใช้เข้าร่วม event นี้หรือไม่
    const existingParticipant = await dbClient
      .select()
      .from(eventParticipants)
      .where(and(
        eq(eventParticipants.eventId, eventId),
        eq(eventParticipants.userId, userId)
        ))
    if (existingParticipant.length === 0) {
      return res.status(400).json({ error: "User is not join this event" });
    }

    // ยกเลิกการเข้าร่วม
    await dbClient
      .delete(eventParticipants)
      .where(and(
        eq(eventParticipants.eventId, eventId),
        eq(eventParticipants.userId, userId)
      ))
    res.json({ message: "Cancel the event success!!!" });
  } catch (err) {
    next(err);
  }
});

// Detail that participants
app.get("/events/participants", authMiddleware, async (req, res, next) => {
  try {
    const eventId = req.body;

    // check event is available
    const [event] = await dbClient.select().from(events).where(eq(events.id, eventId));
    if (!event) return res.status(404).json({ error: "Event not found" });

    // count of participants
    const countResult = await dbClient
      .select({ totalParticipants: count() })
      .from(eventParticipants)
      .where(eq(eventParticipants.eventId, eventId));

    // get the participants
    const participants = await dbClient
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
      })
      .from(eventParticipants)
      .innerJoin(users, eq(eventParticipants.userId, users.id))
      .where(eq(eventParticipants.eventId, eventId));

    res.json({
      message: "Get Participants Successful!!",
      totalParticipants: countResult[0].totalParticipants,
      participants,
    });
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