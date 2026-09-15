import "dotenv/config";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  // fail loudly rather than silently allowing the server to run without a secret
  throw new Error(
    "JWT_SECRET is not set. Add it to server/.env before starting the server.",
  );
}

app.use(cors());
app.use(express.json());

// password below is bcrypt-hashed at startup
const users = [
  {
    id: 1,
    name: "Admin User",
    email: "admin@viek.test",
    passwordHash: bcrypt.hashSync("password123", 10),
  },
];

let clients = [
  {
    id: 1,
    name: "Acme Limited",
    email: "contact@acme.test",
  },
  {
    id: 2,
    name: "Bright Solutions",
    email: "hello@bright.test",
  },
];
let nextClientId = 3; //BUG FIX: see note on id generation below

const projects = [
  {
    id: 1,
    name: "Website Development",
    clientId: 1,
  },
  {
    id: 2,
    name: "Mobile Application",
    clientId: 2,
  },
  {
    id: 3,
    name: "UI/UX Design",
    clientId: 1,
  },
];

// rate limiting on login
//BUG FIX(security): login had no brute-force protection at all.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: {
    message:
      "Too many login attempts from this IP, please try again after 15 minutes",
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Login
app.post("/api/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({
      message: "Email and password are required",
    });
  }

  const user = users.find((item) => item.email === email);

  // BUG FIX(security): compare against bcrypt hash, and use thesame
  // generic error message whether the email or the password was wrong,
  // so the API doesn't leak which one was incorrect (user enumeration).

  const passwordMatches = user
    ? await bcrypt.compare(password, user.passwordHash)
    : false;

  if (!user || !passwordMatches) {
    return res.status(401).json({
      message: "Invalid email or password",
    });
  }

  // BUG FIX (security) : real, expiring, signed JWT instead of a single
  // hardcoded tring every user shared.
  const token = jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: "2h",
  });

  const { passwordHash, ...safeUser } = user;
  res.json({
    token,
    user: safeUser,
  });
});

// Authentication middleware
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  const token = authHeader.slice("Bearer ".length);

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch (err) {
    // covers both expired and tampered/invalid tokens.
    return res.status(401).json({
      message: "Session expired or invalid. Please log in again.",
    });
  }
}

// Get clients
app.get("/api/clients", authenticate, (req, res) => {
  res.json({
    data: clients,
  });
});

// Add client
app.post("/api/clients", authenticate, (req, res) => {
  const { name, email } = req.body || {};

  if (!name || !email) {
    return res.status(400).json({
      message: "Name and email are required",
    });
  }

  // Light input validation (security/data-quality hardening, not in original spec)
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    return res
      .status(400)
      .json({ message: "A valid email address is required" });
  }

  // BUG FIX: clients.length + 1 breaks once a client is deleted (id collisions).
  // Using a monotonically increasing counter instead.
  const newClient = {
    id: nextClientId++,
    name: name.trim(),
    email: email.trim(),
  };

  clients.push(newClient);

  res.status(201).json({
    data: newClient,
  });
});

// Delete client
app.delete("/api/clients/:id", authenticate, (req, res) => {
  // BUG FIX: req.params.id is always a string; client.id is a number.
  // comparing them with !== always evaluated true, so no client was ever removed.

  const id = Number(req.params.id);

  if (Number.isNaN(id)) {
    return res.status(400).json({
      message: "Invalid client ID",
    });
  }

  const originalLength = clients.length;

  clients = clients.filter((client) => client.id !== id);

  if (clients.length === originalLength) {
    return res.status(404).json({
      message: "Client not found",
    });
  }

  res.json({
    message: "Client deleted successfully",
  });
});

// Get projects
app.get("/api/projects", authenticate, (req, res) => {
  const { clientId } = req.query;

  let result = projects;

  if (clientId) {
    // BUG FIX : req.query.clientId is always a string; project.clientId is a number.
    const numericClientId = Number(clientId);
    result = projects.filter((project) => project.clientId === numericClientId);
  }

  res.json({
    projects: result,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    message: "Not Found",
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({
    message: "Something went wrong. Please try again.",
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
