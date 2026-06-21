import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { createHash, createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  checkDatabaseConnection,
  createSession,
  findSurvey,
  findSurveyResponses,
  initializeDatabase,
  insertResponse,
  insertSurvey,
  readDatabase,
  removeSurvey,
  removeSurveyResponses,
  removeSession,
  sessionExists,
  setSurveyStatus,
  updateSurvey
} from "./database.ts";
import type { Database, Survey, SurveyResponse } from "./database.ts";

const require = createRequire(import.meta.url);
const QRCode = require("./vendor/qrcode/QRCode/index.js");
const QRErrorCorrectLevel = require("./vendor/qrcode/QRCode/QRErrorCorrectLevel.js");

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(rootDir, "src");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || (process.env.RENDER ? "0.0.0.0" : "127.0.0.1");
const adminPasswordHash = String(process.env.ADMIN_PASSWORD_HASH || "");
const adminPassword = String(process.env.ADMIN_PASSWORD || "");
const deviceHashSecret = String(process.env.DEVICE_HASH_SECRET || "");
const configuredPublicOrigin = String(process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "")
  .trim()
  .replace(/\/+$/, "");
const sessionLifetimeMs = 8 * 60 * 60 * 1000;
const scryptAsync = promisify(scrypt);
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const responseRates = new Map<string, { count: number; resetAt: number }>();

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".ts": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function send(res: ServerResponse, status: number, body: string | Buffer, type = "text/plain; charset=utf-8") {
  if (type.includes("application/json")) res.setHeader("Cache-Control", "no-store");
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  send(res, status, JSON.stringify(body), "application/json; charset=utf-8");
}

function slugify(value: string) {
  const ascii = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii || `survey-${Date.now()}`;
}

function surveyShortCode(id: string) {
  return createHash("sha256").update(id).digest("hex").slice(0, 12);
}

function requestOrigin(req: IncomingMessage) {
  if (configuredPublicOrigin) return new URL(configuredPublicOrigin).origin;
  const forwarded = req.headers["x-forwarded-proto"];
  const protocolHeader = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const protocol = protocolHeader?.split(",")[0].trim() || "http";
  const requestHost = req.headers.host || `localhost:${port}`;
  return `${protocol}://${requestHost}`;
}

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function applySecurityHeaders(req: IncomingMessage, res: ServerResponse) {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (isSecureRequest(req)) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

function requestIp(req: IncomingMessage) {
  const remote = req.socket.remoteAddress || "unknown";
  const isLoopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  const forwarded = req.headers["x-forwarded-for"];
  if ((isLoopback || process.env.RENDER === "true") && forwarded) {
    const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return value.split(",")[0].trim();
  }
  return remote;
}

function getCookie(req: IncomingMessage, name: string) {
  const cookies = String(req.headers.cookie || "").split(";");
  for (const cookie of cookies) {
    const [key, ...parts] = cookie.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return "";
}

function isSecureRequest(req: IncomingMessage) {
  const forwarded = req.headers["x-forwarded-proto"];
  const protocol = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return protocol?.split(",")[0].trim() === "https";
}

function sessionCookie(req: IncomingMessage, token: string, maxAge: number) {
  const secure = isSecureRequest(req) ? "; Secure" : "";
  return `satisfaction_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function getVisitorToken(req: IncomingMessage) {
  const token = getCookie(req, "survey_visitor");
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : "";
}

function hashVisitorToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function hashNetworkAddress(address: string) {
  return createHmac("sha256", deviceHashSecret).update(address).digest("hex");
}

function getUserAgent(req: IncomingMessage) {
  const header = req.headers["user-agent"];
  const value = Array.isArray(header) ? header[0] : header || "";
  return value.slice(0, 500).replace(/[\u0000-\u001f\u007f]/g, " ");
}

function visitorCookie(req: IncomingMessage, token: string) {
  const secure = isSecureRequest(req) ? "; Secure" : "";
  return `survey_visitor=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`;
}

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function sessionIsValid(req: IncomingMessage) {
  const token = getCookie(req, "satisfaction_session");
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  return sessionExists(hashSessionToken(token));
}

async function passwordsMatch(input: string) {
  if (adminPasswordHash) {
    const [, saltHex, expectedHex] = adminPasswordHash.split("$");
    const expected = Buffer.from(expectedHex || "", "hex");
    if (!/^[0-9a-f]{32}$/i.test(saltHex || "") || expected.length !== 64) return false;

    const actual = (await scryptAsync(input, Buffer.from(saltHex, "hex"), expected.length)) as Buffer;
    return timingSafeEqual(expected, actual);
  }

  const expected = createHash("sha256").update(adminPassword).digest();
  const actual = createHash("sha256").update(input).digest();
  return timingSafeEqual(expected, actual);
}

function checkRateLimit(
  store: Map<string, { count: number; resetAt: number }>,
  key: string,
  limit: number,
  windowMs: number
) {
  const now = Date.now();
  const current = store.get(key);
  if (!current || current.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

function originIsAllowed(req: IncomingMessage) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function summarizeSurvey(survey: Survey, responses: SurveyResponse[]) {
  const owned = responses.filter((response) => response.surveyId === survey.id);
  const total = owned.length;
  const average = total === 0 ? 0 : owned.reduce((sum, item) => sum + item.rating, 0) / total;
  const distribution = [1, 2, 3, 4, 5].map((rating) => ({
    rating,
    count: owned.filter((response) => response.rating === rating).length
  }));

  return {
    ...survey,
    responses: total,
    average: Number(average.toFixed(1)),
    distribution
  };
}

function summarizeDatabase(database: Database) {
  const surveys = database.surveys.map((survey) => summarizeSurvey(survey, database.responses));
  const totalResponses = database.responses.length;
  const average =
    totalResponses === 0
      ? 0
      : database.responses.reduce((sum, response) => sum + response.rating, 0) / totalResponses;

  return {
    stats: {
      surveys: database.surveys.length,
      responses: totalResponses,
      average: Number(average.toFixed(1))
    },
    surveys
  };
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 16 * 1024) throw new HttpError(413, "ข้อมูลมีขนาดใหญ่เกินไป");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf-8");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "รูปแบบข้อมูลไม่ถูกต้อง");
  }
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL) {
  const surveyRoute = url.pathname.match(/^\/api\/surveys\/([^/]+)(?:\/([^/]+))?$/);

  if (req.method === "GET" && url.pathname === "/api/health") {
    await checkDatabaseConnection();
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (!["GET", "HEAD"].includes(req.method || "") && !originIsAllowed(req)) {
    sendJson(res, 403, { message: "คำขอไม่ได้มาจากเว็บไซต์นี้" });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const ip = requestIp(req);
    const attempt = loginAttempts.get(ip);
    if (attempt && attempt.count >= 5 && attempt.resetAt > Date.now()) {
      sendJson(res, 429, { message: "ลองรหัสผ่านหลายครั้งเกินไป กรุณารอ 15 นาที" });
      return;
    }

    const body = await readBody(req);
    const password = String(body.password || "").slice(0, 256);
    if (!(await passwordsMatch(password))) {
      checkRateLimit(loginAttempts, ip, 5, 15 * 60 * 1000);
      sendJson(res, 401, { message: "รหัสผ่านไม่ถูกต้อง" });
      return;
    }

    loginAttempts.delete(ip);
    const token = randomBytes(32).toString("base64url");
    await createSession(hashSessionToken(token), Date.now() + sessionLifetimeMs);
    res.setHeader("Set-Cookie", sessionCookie(req, token, Math.floor(sessionLifetimeMs / 1000)));
    sendJson(res, 200, { authenticated: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/auth/session") {
    sendJson(res, 200, { authenticated: await sessionIsValid(req) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const token = getCookie(req, "satisfaction_session");
    if (/^[A-Za-z0-9_-]{43}$/.test(token)) await removeSession(hashSessionToken(token));
    res.setHeader("Set-Cookie", sessionCookie(req, "", 0));
    sendJson(res, 200, { authenticated: false });
    return;
  }

  if (req.method === "GET" && surveyRoute && !surveyRoute[2]) {
    const id = decodeURIComponent(surveyRoute[1]);
    const survey = await findSurvey(id);
    if (!survey) {
      sendJson(res, 404, { message: "ไม่พบแบบสำรวจ" });
      return;
    }
    sendJson(res, 200, summarizeSurvey(survey, await findSurveyResponses(id)));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/responses") {
    const ip = requestIp(req);
    if (!checkRateLimit(responseRates, ip, 120, 60 * 1000)) {
      sendJson(res, 429, { message: "ส่งคำตอบถี่เกินไป กรุณารอสักครู่" });
      return;
    }

    const body = await readBody(req);
    const surveyId = String(body.surveyId || "").trim();
    const rating = Number(body.rating);
    const comment = String(body.comment || "").trim();
    const survey = await findSurvey(surveyId);
    const visitorToken = getVisitorToken(req) || randomBytes(32).toString("base64url");
    const visitorHash = hashVisitorToken(visitorToken);

    if (!survey) {
      sendJson(res, 404, { message: "ไม่พบแบบสำรวจ" });
      return;
    }
    if (survey.status !== "open") {
      sendJson(res, 400, { message: "แบบสำรวจนี้ปิดรับคำตอบแล้ว" });
      return;
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      sendJson(res, 400, { message: "กรุณาเลือกคะแนน 1-5" });
      return;
    }
    if (comment.length > 2000) {
      sendJson(res, 400, { message: "ความคิดเห็นยาวเกิน 2,000 ตัวอักษร" });
      return;
    }

    const response: SurveyResponse = {
      id: randomUUID(),
      surveyId,
      rating,
      comment,
      createdAt: new Date().toISOString()
    };
    await insertResponse(response, {
      visitorHash,
      networkHash: hashNetworkAddress(requestIp(req)),
      userAgent: getUserAgent(req)
    });
    res.setHeader("Set-Cookie", visitorCookie(req, visitorToken));
    sendJson(res, 201, response);
    return;
  }

  if (!(await sessionIsValid(req))) {
    sendJson(res, 401, { message: "กรุณาเข้าสู่ระบบ" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/dashboard") {
    sendJson(res, 200, summarizeDatabase(await readDatabase()));
    return;
  }

  if (req.method === "GET" && surveyRoute?.[2] === "responses") {
    const id = decodeURIComponent(surveyRoute[1]);
    const survey = await findSurvey(id);
    if (!survey) {
      sendJson(res, 404, { message: "ไม่พบแบบสำรวจ" });
      return;
    }
    const responses = await findSurveyResponses(id);
    sendJson(res, 200, { survey: summarizeSurvey(survey, responses), responses });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/surveys") {
    const body = await readBody(req);
    const title = String(body.title || "").trim();
    const branch = String(body.branch || "").trim();
    if (!title || !branch || title.length > 120 || branch.length > 120) {
      sendJson(res, 400, { message: "กรุณากรอกชื่อแบบสำรวจและสาขา" });
      return;
    }

    const baseId = slugify(title);
    let id = baseId;
    let index = 2;
    while (await findSurvey(id)) {
      id = `${baseId}-${index++}`;
    }

    const survey: Survey = {
      id,
      title,
      branch,
      status: "open",
      createdAt: new Date().toISOString()
    };
    await insertSurvey(survey);
    sendJson(res, 201, summarizeSurvey(survey, []));
    return;
  }

  if (req.method === "PUT" && surveyRoute && !surveyRoute[2]) {
    const id = decodeURIComponent(surveyRoute[1]);
    const body = await readBody(req);
    const title = String(body.title || "").trim();
    const branch = String(body.branch || "").trim();
    const survey = await findSurvey(id);
    if (!survey) {
      sendJson(res, 404, { message: "ไม่พบแบบสำรวจ" });
      return;
    }
    if (!title || !branch || title.length > 120 || branch.length > 120) {
      sendJson(res, 400, { message: "กรุณากรอกชื่อแบบสำรวจและสาขา" });
      return;
    }

    await updateSurvey(id, title, branch);
    const updated = (await findSurvey(id))!;
    sendJson(res, 200, summarizeSurvey(updated, await findSurveyResponses(id)));
    return;
  }

  if (req.method === "PATCH" && surveyRoute && !surveyRoute[2]) {
    const id = decodeURIComponent(surveyRoute[1]);
    const survey = await findSurvey(id);
    if (!survey) {
      sendJson(res, 404, { message: "ไม่พบแบบสำรวจ" });
      return;
    }
    await setSurveyStatus(id, survey.status === "open" ? "closed" : "open");
    const updated = (await findSurvey(id))!;
    sendJson(res, 200, summarizeSurvey(updated, await findSurveyResponses(id)));
    return;
  }

  if (req.method === "DELETE" && surveyRoute?.[2] === "responses") {
    const id = decodeURIComponent(surveyRoute[1]);
    const survey = await findSurvey(id);
    if (!survey) {
      sendJson(res, 404, { message: "ไม่พบแบบสำรวจ" });
      return;
    }

    await removeSurveyResponses(id);
    sendJson(res, 200, summarizeSurvey(survey, []));
    return;
  }

  if (req.method === "DELETE" && surveyRoute && !surveyRoute[2]) {
    const id = decodeURIComponent(surveyRoute[1]);
    if (!(await findSurvey(id))) {
      sendJson(res, 404, { message: "ไม่พบแบบสำรวจ" });
      return;
    }

    await removeSurvey(id);
    sendJson(res, 200, summarizeDatabase(await readDatabase()));
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/qr/")) {
    const id = decodeURIComponent(url.pathname.split("/").pop() || "");
    const survey = await findSurvey(id);
    if (!survey) {
      sendJson(res, 404, { message: "ไม่พบแบบสำรวจ" });
      return;
    }
    const targetUrl = `${requestOrigin(req)}/r/${surveyShortCode(id)}`;
    res.setHeader("Cache-Control", "no-store");
    send(res, 200, createQrSvg(targetUrl), "image/svg+xml; charset=utf-8");
    return;
  }

  sendJson(res, 404, { message: "ไม่พบ API" });
}

async function serveStatic(res: ServerResponse, pathname: string) {
  const filePath = pathname === "/" ? join(publicDir, "index.html") : join(publicDir, pathname);
  const normalized = normalize(filePath);

  if (!(normalized === publicDir || normalized.startsWith(`${publicDir}/`)) || !existsSync(normalized)) {
    send(res, 404, "Not found");
    return;
  }

  const content = await readFile(normalized);
  send(res, 200, content, mimeTypes[extname(normalized)] || "application/octet-stream");
}

const applicationServer = createServer(async (req, res) => {
  try {
    applySecurityHeaders(req, res);
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    if (url.pathname.startsWith("/r/")) {
      const code = decodeURIComponent(url.pathname.slice(3));
      const survey = (await readDatabase()).surveys.find((item) => surveyShortCode(item.id) === code);
      if (!survey) {
        send(res, 404, "Not found");
        return;
      }
      res.writeHead(302, {
        Location: `/respond/${encodeURIComponent(survey.id)}`,
        "Cache-Control": "no-store"
      });
      res.end();
      return;
    }
    if (
      url.pathname === "/login" ||
      url.pathname.startsWith("/respond/") ||
      url.pathname.startsWith("/surveys/")
    ) {
      await serveStatic(res, "/index.html");
      return;
    }
    await serveStatic(res, url.pathname);
  } catch (error) {
    console.error(error);
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof HttpError ? error.message : "เกิดข้อผิดพลาดในระบบ";
    sendJson(res, status, { message });
  }
});

const socketPath = process.env.SOCKET_PATH;
if (process.env.NO_LISTEN !== "1") {
  initializeDatabase()
    .then(() => {
      const validPasswordHash = /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/i.test(adminPasswordHash);
      if (!validPasswordHash && adminPassword.length < 12) {
        throw new Error("Set a valid ADMIN_PASSWORD_HASH or an ADMIN_PASSWORD with at least 12 characters.");
      }
      if (deviceHashSecret.length < 32) throw new Error("DEVICE_HASH_SECRET must contain at least 32 characters.");
      applicationServer.listen(socketPath || { port, host }, () => {
        console.log(
          socketPath ? `QR Satisfaction App socket: ${socketPath}` : `QR Satisfaction App: http://${host}:${port}`
        );
      });
    })
    .catch((error) => {
      console.error("Server startup failed", error);
      process.exitCode = 1;
    });
}

function createQrSvg(text: string) {
  const qrCode = new QRCode(-1, QRErrorCorrectLevel.M);
  qrCode.addData(text);
  qrCode.make();

  const moduleCount = qrCode.getModuleCount();
  const scale = 8;
  const quiet = 4;
  const size = moduleCount + quiet * 2;
  let rects = "";

  for (let y = 0; y < moduleCount; y++) {
    for (let x = 0; x < moduleCount; x++) {
      if (qrCode.isDark(y, x)) {
        rects += `<rect x="${x + quiet}" y="${y + quiet}" width="1" height="1"/>`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size * scale}" height="${size * scale}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#111">${rects}</g></svg>`;
}

function createQrModules(text: string) {
  const version = 4;
  const size = 17 + version * 4;
  const dataCodewords = 80;
  const eccCodewords = 20;
  const modules = Array.from({ length: size }, () => Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => Array(size).fill(false));

  const setModule = (x: number, y: number, dark: boolean, reserve = true) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    modules[y][x] = dark;
    if (reserve) reserved[y][x] = true;
  };

  const finder = (x: number, y: number) => {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        const dark = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6 && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
        setModule(xx, yy, dark);
      }
    }
  };

  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);

  for (let i = 8; i < size - 8; i++) {
    setModule(i, 6, i % 2 === 0);
    setModule(6, i, i % 2 === 0);
  }

  const alignment = (cx: number, cy: number) => {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        setModule(cx + dx, cy + dy, distance !== 1);
      }
    }
  };
  alignment(26, 26);

  setModule(8, size - 8, true);
  reserveFormatAreas(reserved, size);

  const bytes = Array.from(new TextEncoder().encode(text));
  const bits: number[] = [0, 1, 0, 0];
  pushBits(bits, bytes.length, 8);
  bytes.forEach((byte) => pushBits(bits, byte, 8));
  const maxBits = dataCodewords * 8;
  for (let i = 0; i < 4 && bits.length < maxBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bitsToByte(bits.slice(i, i + 8)));
  for (let pad = 0; data.length < dataCodewords; pad++) data.push(pad % 2 === 0 ? 0xec : 0x11);

  const codewords = [...data, ...reedSolomon(data, eccCodewords)];
  placeData(modules, reserved, codewords, size);
  applyMask(modules, reserved, size);
  placeFormatBits(modules, size, 0);
  return modules;
}

function pushBits(bits: number[], value: number, count: number) {
  for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1);
}

function bitsToByte(bits: number[]) {
  return bits.reduce((value, bit) => (value << 1) | bit, 0);
}

function reserveFormatAreas(reserved: boolean[][], size: number) {
  for (let i = 0; i <= 5; i++) {
    reserved[8][i] = true;
    reserved[i][8] = true;
  }
  reserved[8][7] = true;
  reserved[8][8] = true;
  reserved[7][8] = true;

  for (let i = 0; i < 8; i++) reserved[8][size - 1 - i] = true;
  for (let i = 0; i < 7; i++) reserved[size - 1 - i][8] = true;
}

function placeData(modules: boolean[][], reserved: boolean[][], codewords: number[], size: number) {
  const bits = codewords.flatMap((byte) => Array.from({ length: 8 }, (_, i) => (byte >>> (7 - i)) & 1));
  let bitIndex = 0;
  let upward = true;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right--;
    for (let row = 0; row < size; row++) {
      const y = upward ? size - 1 - row : row;
      for (let column = 0; column < 2; column++) {
        const x = right - column;
        if (!reserved[y][x] && bitIndex < bits.length) {
          modules[y][x] = bits[bitIndex++] === 1;
        }
      }
    }
    upward = !upward;
  }
}

function applyMask(modules: boolean[][], reserved: boolean[][], size: number) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!reserved[y][x] && (x + y) % 2 === 0) {
        modules[y][x] = !modules[y][x];
      }
    }
  }
}

function placeFormatBits(modules: boolean[][], size: number, mask: number) {
  const format = getFormatBits(mask);
  const first = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
  ];
  const second = [
    [size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8], [size - 5, 8], [size - 6, 8], [size - 7, 8], [size - 8, 8],
    [8, size - 7], [8, size - 6], [8, size - 5], [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1]
  ];

  first.forEach(([x, y], index) => {
    modules[y][x] = ((format >>> index) & 1) === 1;
  });
  second.forEach(([x, y], index) => {
    modules[y][x] = ((format >>> index) & 1) === 1;
  });
}

function getFormatBits(mask: number) {
  let data = (1 << 3) | mask;
  let value = data << 10;
  const generator = 0x537;
  for (let i = 14; i >= 10; i--) {
    if (((value >>> i) & 1) !== 0) value ^= generator << (i - 10);
  }
  return ((data << 10) | value) ^ 0x5412;
}

function reedSolomon(data: number[], degree: number) {
  const generator = rsGenerator(degree);
  const result = Array(degree).fill(0);

  for (const byte of data) {
    const factor = byte ^ result.shift();
    result.push(0);
    for (let i = 0; i < degree; i++) {
      result[i] ^= gfMultiply(generator[i], factor);
    }
  }
  return result;
}

function rsGenerator(degree: number) {
  let result = [1];
  for (let i = 0; i < degree; i++) {
    const next = Array(result.length + 1).fill(0);
    result.forEach((coefficient, index) => {
      next[index] ^= gfMultiply(coefficient, 1);
      next[index + 1] ^= gfMultiply(coefficient, gfPow(2, i));
    });
    result = next;
  }
  return result.slice(1);
}

function gfPow(value: number, power: number) {
  let result = 1;
  for (let i = 0; i < power; i++) result = gfMultiply(result, value);
  return result;
}

function gfMultiply(a: number, b: number) {
  let result = 0;
  for (let i = 0; i < 8; i++) {
    if ((b & 1) !== 0) result ^= a;
    const high = a & 0x80;
    a = (a << 1) & 0xff;
    if (high) a ^= 0x1d;
    b >>>= 1;
  }
  return result;
}
