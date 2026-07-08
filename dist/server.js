// server.js
import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer } from "ws";
import { createServer as createViteServer } from "vite";
import { MongoClient } from "mongodb";
var MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://itsnexverra_db_user:gMMR5ur0z283BIey@cluster0.cgvtzxd.mongodb.net/?appName=Cluster0";
var client = new MongoClient(MONGODB_URI);
var isConnected = false;
var isSeeding = false;
async function getDb() {
  if (!isConnected) {
    await client.connect();
    isConnected = true;
  }
  return client.db("onix_digital");
}
async function seedDefaultAdmin(database) {
  if (isSeeding) return;
  isSeeding = true;
  try {
    const usersCol = database.collection("users");
    const adminExists = await usersCol.findOne({ email: "admin@onix.com" });
    if (!adminExists) {
      await usersCol.insertOne({
        _id: "admin-default",
        name: "Onix Admin",
        surname: "Master",
        email: "admin@onix.com",
        passwordHash: "admin123",
        role: "admin",
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      console.log("[MongoDB] Default administrator account successfully seeded.");
    }
  } catch (err) {
    console.error("[MongoDB] Failed to seed default admin:", err);
  }
}
var MongoCollection = class {
  constructor(collectionName) {
    this.collectionName = collectionName;
  }
  async find(query = {}) {
    try {
      const dbInstance = await getDb();
      await seedDefaultAdmin(dbInstance);
      const col = dbInstance.collection(this.collectionName);
      return await col.find(query).toArray();
    } catch (err) {
      console.error(`[MongoDB] Error finding in ${this.collectionName}:`, err);
      return [];
    }
  }
  async findOne(query) {
    try {
      const dbInstance = await getDb();
      await seedDefaultAdmin(dbInstance);
      const col = dbInstance.collection(this.collectionName);
      return await col.findOne(query);
    } catch (err) {
      console.error(`[MongoDB] Error finding one in ${this.collectionName}:`, err);
      return null;
    }
  }
  async insertOne(doc) {
    try {
      const dbInstance = await getDb();
      await seedDefaultAdmin(dbInstance);
      const col = dbInstance.collection(this.collectionName);
      const newDoc = {
        ...doc,
        _id: doc._id || Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
      };
      await col.insertOne(newDoc);
      return newDoc;
    } catch (err) {
      console.error(`[MongoDB] Error inserting into ${this.collectionName}:`, err);
      throw err;
    }
  }
  async updateOne(query, update) {
    try {
      const dbInstance = await getDb();
      await seedDefaultAdmin(dbInstance);
      const col = dbInstance.collection(this.collectionName);
      const { _id, ...cleanUpdate } = update;
      const result = await col.updateOne(query, { $set: cleanUpdate });
      return result.modifiedCount > 0 || result.matchedCount > 0;
    } catch (err) {
      console.error(`[MongoDB] Error updating in ${this.collectionName}:`, err);
      return false;
    }
  }
  async deleteOne(query) {
    try {
      const dbInstance = await getDb();
      await seedDefaultAdmin(dbInstance);
      const col = dbInstance.collection(this.collectionName);
      const result = await col.deleteOne(query);
      return result.deletedCount > 0;
    } catch (err) {
      console.error(`[MongoDB] Error deleting from ${this.collectionName}:`, err);
      return false;
    }
  }
};
var MongoDatabase = class {
  constructor() {
    this.users = new MongoCollection("users");
    this.conversations = new MongoCollection("conversations");
  }
};
var db = new MongoDatabase();
var PORT = 3e3;
async function startServer() {
  const app = express();
  const server = http.createServer(app);
  app.use(express.json());
  const userSockets = /* @__PURE__ */ new Map();
  const adminSockets = /* @__PURE__ */ new Set();
  app.post("/api/auth/register", async (req, res) => {
    try {
      const { name, surname, email, password, website } = req.body;
      if (!name || !email || !password) {
        return res.status(400).json({ error: "Name, email, and password are required" });
      }
      const existingUser = await db.users.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ error: "User with this email already exists" });
      }
      const newUser = await db.users.insertOne({
        name,
        surname: surname || "",
        email,
        passwordHash: password,
        // Plain string storage for demo simplicity as required
        role: "user",
        website: website || "",
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      await db.conversations.insertOne({
        _id: newUser._id,
        email: newUser.email,
        name: `${newUser.name} ${newUser.surname || ""}`.trim(),
        messages: [
          {
            id: "welcome-" + Date.now(),
            sender: "admin",
            text: `Hi ${newUser.name}! Welcome to Onix Digital. How can we help you grow your website today?`,
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          }
        ],
        status: "active",
        lastUpdated: (/* @__PURE__ */ new Date()).toISOString()
      });
      res.status(201).json({
        success: true,
        user: {
          id: newUser._id,
          name: newUser.name,
          surname: newUser.surname,
          email: newUser.email,
          role: newUser.role,
          website: newUser.website
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to register" });
    }
  });
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "Email and password are required" });
      }
      const user = await db.users.findOne({ email });
      if (!user || user.passwordHash !== password) {
        return res.status(401).json({ error: "Invalid email or password" });
      }
      res.json({
        success: true,
        user: {
          id: user._id,
          name: user.name,
          surname: user.surname,
          email: user.email,
          role: user.role,
          website: user.website
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to login" });
    }
  });
  app.get("/api/auth/me", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const userId = authHeader.replace("Bearer ", "").trim();
      const user = await db.users.findOne({ _id: userId });
      if (!user) {
        return res.status(401).json({ error: "User session expired or invalid" });
      }
      res.json({
        success: true,
        user: {
          id: user._id,
          name: user.name,
          surname: user.surname,
          email: user.email,
          role: user.role,
          website: user.website
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "Authorization failed" });
    }
  });
  app.post("/api/contact", async (req, res) => {
    try {
      const { name, surname, email, website } = req.body;
      if (!name || !email) {
        return res.status(400).json({ error: "Name and email are required" });
      }
      let generatedAccount = null;
      let user = await db.users.findOne({ email });
      if (!user) {
        const autoPassword = "onix" + Math.floor(100 + Math.random() * 900);
        user = await db.users.insertOne({
          name,
          surname: surname || "",
          email,
          passwordHash: autoPassword,
          role: "user",
          website: website || "",
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        });
        generatedAccount = {
          email: user.email,
          password: autoPassword
        };
        await db.conversations.insertOne({
          _id: user._id,
          email: user.email,
          name: `${user.name} ${user.surname || ""}`.trim(),
          messages: [
            {
              id: "welcome-system",
              sender: "admin",
              text: `Thanks for submitting our contact form, ${name}! We have automatically created an Onix Portal account for you so you can live-chat with our experts. Use Password: ${autoPassword}`,
              timestamp: (/* @__PURE__ */ new Date()).toISOString()
            }
          ],
          status: "active",
          lastUpdated: (/* @__PURE__ */ new Date()).toISOString()
        });
      } else {
        const conversation = await db.conversations.findOne({ _id: user._id });
        const systemMsg = {
          id: "system-" + Date.now(),
          sender: "admin",
          text: `Thank you for sending another inquiry from the Contact form! Our strategic team has received your information.`,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        };
        if (conversation) {
          const updatedMessages = [...conversation.messages, systemMsg];
          await db.conversations.updateOne(
            { _id: user._id },
            { messages: updatedMessages, lastUpdated: (/* @__PURE__ */ new Date()).toISOString() }
          );
        } else {
          await db.conversations.insertOne({
            _id: user._id,
            email: user.email,
            name: `${user.name} ${user.surname || ""}`.trim(),
            messages: [systemMsg],
            status: "active",
            lastUpdated: (/* @__PURE__ */ new Date()).toISOString()
          });
        }
      }
      res.json({
        success: true,
        message: "Inquiry successfully submitted!",
        autoAccount: generatedAccount
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to submit inquiry" });
    }
  });
  const requireAdmin = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: "No authorization header" });
    }
    const adminId = authHeader.replace("Bearer ", "").trim();
    const admin = await db.users.findOne({ _id: adminId, role: "admin" });
    if (!admin) {
      return res.status(403).json({ error: "Access denied. Admins only." });
    }
    next();
  };
  app.get("/api/admin/users", requireAdmin, async (req, res) => {
    try {
      const users = await db.users.find();
      const cleanUsers = users.map((u) => ({
        id: u._id,
        name: u.name,
        surname: u.surname,
        email: u.email,
        role: u.role,
        website: u.website,
        createdAt: u.createdAt
      }));
      res.json(cleanUsers);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      if (id === "admin-default") {
        return res.status(400).json({ error: "Cannot delete the default administrator account" });
      }
      await db.users.deleteOne({ _id: id });
      await db.conversations.deleteOne({ _id: id });
      res.json({ success: true, message: "User deleted successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.delete("/api/admin/conversations/:id", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      await db.conversations.deleteOne({ _id: id });
      res.json({ success: true, message: "Conversation deleted successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get("/api/admin/conversations", requireAdmin, async (req, res) => {
    try {
      const conversations = await db.conversations.find();
      conversations.sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime());
      res.json(conversations);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", (socket) => {
    let clientSessionId = null;
    let isAdminClient = false;
    socket.on("message", async (rawData) => {
      try {
        const message = JSON.parse(rawData.toString());
        const { type } = message;
        if (type === "register") {
          const { userId, role, email, name } = message;
          clientSessionId = userId;
          if (role === "admin") {
            isAdminClient = true;
            adminSockets.add(socket);
            console.log(`[WS] Admin connected.`);
          } else {
            userSockets.set(userId, socket);
            console.log(`[WS] User connected: ${userId} (${email})`);
            let conversation = await db.conversations.findOne({ _id: userId });
            if (!conversation) {
              conversation = await db.conversations.insertOne({
                _id: userId,
                email: email || "anonymous@onix.com",
                name: name || "Anonymous User",
                messages: [
                  {
                    id: "welcome-ws",
                    sender: "admin",
                    text: `Hello ${name || "there"}! Let us know how we can support your growth strategy in real time.`,
                    timestamp: (/* @__PURE__ */ new Date()).toISOString()
                  }
                ],
                status: "active",
                lastUpdated: (/* @__PURE__ */ new Date()).toISOString()
              });
            }
            socket.send(JSON.stringify({
              type: "history",
              conversation
            }));
          }
        } else if (type === "user_msg") {
          const { text, userId, name, email } = message;
          if (!userId) return;
          const newMsg = {
            id: "msg-" + Date.now(),
            sender: "user",
            text,
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          };
          let conv = await db.conversations.findOne({ _id: userId });
          if (!conv) {
            conv = await db.conversations.insertOne({
              _id: userId,
              email: email || "guest@onix.com",
              name: name || "Guest User",
              messages: [newMsg],
              status: "active",
              lastUpdated: (/* @__PURE__ */ new Date()).toISOString()
            });
          } else {
            const updatedMsgs = [...conv.messages, newMsg];
            await db.conversations.updateOne(
              { _id: userId },
              { messages: updatedMsgs, status: "active", lastUpdated: (/* @__PURE__ */ new Date()).toISOString() }
            );
            conv.messages = updatedMsgs;
          }
          const adminPayload = JSON.stringify({
            type: "incoming_msg",
            userId,
            conversation: conv,
            message: newMsg
          });
          adminSockets.forEach((adminSock) => {
            if (adminSock.readyState === 1) {
              adminSock.send(adminPayload);
            }
          });
          socket.send(JSON.stringify({
            type: "confirm_msg",
            message: newMsg
          }));
        } else if (type === "admin_msg") {
          const { text, targetUserId } = message;
          if (!targetUserId) return;
          const newMsg = {
            id: "msg-" + Date.now(),
            sender: "admin",
            text,
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          };
          let conv = await db.conversations.findOne({ _id: targetUserId });
          if (conv) {
            const updatedMsgs = [...conv.messages, newMsg];
            await db.conversations.updateOne(
              { _id: targetUserId },
              { messages: updatedMsgs, lastUpdated: (/* @__PURE__ */ new Date()).toISOString() }
            );
            conv.messages = updatedMsgs;
            const userSock = userSockets.get(targetUserId);
            if (userSock && userSock.readyState === 1) {
              userSock.send(JSON.stringify({
                type: "incoming_msg",
                message: newMsg
              }));
            }
            const syncPayload = JSON.stringify({
              type: "sync_msg",
              userId: targetUserId,
              conversation: conv,
              message: newMsg
            });
            adminSockets.forEach((adminSock) => {
              if (adminSock !== socket && adminSock.readyState === 1) {
                adminSock.send(syncPayload);
              }
            });
            socket.send(JSON.stringify({
              type: "confirm_msg",
              userId: targetUserId,
              message: newMsg
            }));
          }
        } else if (type === "resolve_chat") {
          const { targetUserId } = message;
          if (!targetUserId) return;
          await db.conversations.updateOne({ _id: targetUserId }, { status: "resolved" });
          const userSock = userSockets.get(targetUserId);
          if (userSock && userSock.readyState === 1) {
            userSock.send(JSON.stringify({
              type: "resolved"
            }));
          }
          adminSockets.forEach((adminSock) => {
            if (adminSock.readyState === 1) {
              adminSock.send(JSON.stringify({
                type: "chat_resolved",
                userId: targetUserId
              }));
            }
          });
        }
      } catch (err) {
        console.error("WS error parsing message:", err);
      }
    });
    socket.on("close", () => {
      if (isAdminClient) {
        adminSockets.delete(socket);
        console.log(`[WS] Admin disconnected.`);
      } else if (clientSessionId) {
        userSockets.delete(clientSessionId);
        console.log(`[WS] User disconnected: ${clientSessionId}`);
      }
    });
  });
  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url || "", `http://${request.headers.host}`).pathname;
    if (pathname === "/ws/chat") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}
startServer();
//# sourceMappingURL=server.js.map
