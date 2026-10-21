import type { Config, Context } from "@netlify/functions";
import crypto from "node:crypto";
import { asc, desc, eq, lte, max, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { enquiries, loginAttempts, projects, services, sessions, settings } from "../../db/schema.js";

const SESSION_MS = 8 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function json(status: number, data: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

let adminKey: { salt: Buffer; hash: Buffer } | null = null;
function passwordMatches(password: string) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword || adminPassword.length < 12) {
    throw new HttpError(503, "Admin sign-in is not configured yet. Set ADMIN_PASSWORD (12+ characters) in the site environment variables.");
  }
  if (!adminKey) {
    const salt = crypto.randomBytes(16);
    adminKey = { salt, hash: crypto.scryptSync(adminPassword, salt, 64) };
  }
  const candidate = crypto.scryptSync(password, adminKey.salt, 64);
  return crypto.timingSafeEqual(candidate, adminKey.hash);
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function getSession(context: Context) {
  const token = context.cookies.get("ayansh_session");
  if (!token) return null;
  const tokenHash = hashToken(token);
  const [session] = await db.select().from(sessions).where(eq(sessions.token_hash, tokenHash));
  if (!session || session.expires_at <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.token_hash, tokenHash));
    return null;
  }
  return { tokenHash, csrfToken: session.csrf_token };
}

async function readJson(req: Request): Promise<Record<string, any>> {
  const body = await req.text();
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new HttpError(413, "Request body is too large.");
  if (!body) return {};
  try {
    const value = JSON.parse(body);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new HttpError(400, "Request body must be a valid JSON object.");
  }
}

function text(value: unknown, label: string, maxLength: number, required = true) {
  if (typeof value !== "string") throw new HttpError(400, `${label} must be text.`);
  const clean = value.trim();
  if (required && !clean) throw new HttpError(400, `${label} is required.`);
  if (clean.length > maxLength) throw new HttpError(400, `${label} must be ${maxLength} characters or fewer.`);
  return clean;
}

function imageUrl(value: unknown) {
  const result = text(value ?? "", "Image URL", 2048, false);
  if (result && !/^https:\/\/[^\s]+$/i.test(result)) throw new HttpError(400, "Image URL must start with https://.");
  return result;
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validateOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return parsed.host === new URL(req.url).host && ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

async function publicSiteData() {
  const [settingRows, serviceRows, projectRows] = await Promise.all([
    db.select().from(settings),
    db.select().from(services).orderBy(asc(services.position), asc(services.id)),
    db.select().from(projects).orderBy(desc(projects.featured), desc(projects.id)),
  ]);
  return {
    settings: Object.fromEntries(settingRows.map(({ key, value }) => [key, value])),
    services: serviceRows,
    projects: projectRows,
    featuredProject: projectRows.find((project) => project.featured === 1) || null,
  };
}

async function saveService(data: Record<string, any>, id?: number) {
  const values = {
    title: text(data.title, "Title", 100),
    description: text(data.description, "Description", 1000),
    image_url: imageUrl(data.image_url),
  };
  if (id) {
    const updated = await db.update(services).set(values).where(eq(services.id, id)).returning({ id: services.id });
    return updated.length > 0;
  }
  const [{ highest }] = await db.select({ highest: max(services.position) }).from(services);
  await db.insert(services).values({ ...values, position: (highest ?? -1) + 1 });
  return true;
}

async function saveProject(data: Record<string, any>, id?: number) {
  const values = {
    title: text(data.title, "Title", 120),
    category: text(data.category, "Category", 100),
    location: text(data.location, "Location", 120),
    description: text(data.description, "Description", 1200),
    image_url: imageUrl(data.image_url),
  };
  if (id) {
    const updated = await db.update(projects).set(values).where(eq(projects.id, id)).returning({ id: projects.id });
    return updated.length > 0;
  }
  await db.insert(projects).values(values);
  return true;
}

async function login(req: Request, context: Context) {
  if (!validateOrigin(req)) return json(403, { error: "This request could not be verified." });
  const ip = context.ip || "unknown";
  const now = Date.now();
  const [attempts] = await db.select().from(loginAttempts).where(eq(loginAttempts.ip, ip));
  if (attempts && attempts.until > now && attempts.count >= 8) {
    return json(429, { error: "Too many sign-in attempts. Try again in 15 minutes." });
  }
  const data = await readJson(req);
  const password = typeof data.password === "string" ? data.password : "";
  if (password.length > 200) return json(400, { error: "Password must be 200 characters or fewer." });
  if (!passwordMatches(password)) {
    const count = attempts && attempts.until > now ? attempts.count + 1 : 1;
    await db
      .insert(loginAttempts)
      .values({ ip, count, until: now + LOGIN_WINDOW_MS })
      .onConflictDoUpdate({ target: loginAttempts.ip, set: { count, until: now + LOGIN_WINDOW_MS } });
    return json(401, { error: "The password was not recognized." });
  }
  await db.delete(loginAttempts).where(eq(loginAttempts.ip, ip));
  const token = crypto.randomBytes(32).toString("base64url");
  const csrfToken = crypto.randomBytes(32).toString("base64url");
  await db.delete(sessions).where(lte(sessions.expires_at, now));
  await db.insert(sessions).values({ token_hash: hashToken(token), csrf_token: csrfToken, expires_at: now + SESSION_MS });
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return json(200, { csrfToken }, {
    "Set-Cookie": `ayansh_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_MS / 1000)}${secure}`,
  });
}

async function admin(req: Request, context: Context, pathname: string, method: string) {
  const session = await getSession(context);
  if (!session) return json(401, { error: "Please sign in to continue." });
  const stateChanging = method !== "GET" && method !== "HEAD";
  if (stateChanging && (!validateOrigin(req) || !safeEqual(req.headers.get("x-csrf-token") || "", session.csrfToken))) {
    return json(403, { error: "This request could not be verified. Refresh the page and try again." });
  }

  if (method === "POST" && pathname === "/api/admin/logout") {
    await db.delete(sessions).where(eq(sessions.token_hash, session.tokenHash));
    return json(200, { message: "You have been signed out." }, {
      "Set-Cookie": "ayansh_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
    });
  }
  if (method === "GET" && pathname === "/api/admin/data") {
    const [site, enquiryRows] = await Promise.all([
      publicSiteData(),
      db.select().from(enquiries).orderBy(desc(enquiries.id)),
    ]);
    return json(200, { ...site, enquiries: enquiryRows, csrfToken: session.csrfToken });
  }

  const enquiryMatch = pathname.match(/^\/api\/admin\/enquiries\/(\d+)$/);
  if (enquiryMatch && method === "PATCH") {
    const data = await readJson(req);
    const status = text(data.status, "Status", 30);
    if (!["New", "In progress", "Contacted", "Closed"].includes(status)) return json(400, { error: "Choose a valid follow-up status." });
    const updated = await db.update(enquiries).set({ status }).where(eq(enquiries.id, Number(enquiryMatch[1]))).returning({ id: enquiries.id });
    return updated.length ? json(200, { message: "Enquiry updated." }) : json(404, { error: "Enquiry not found." });
  }
  if (enquiryMatch && method === "DELETE") {
    const deleted = await db.delete(enquiries).where(eq(enquiries.id, Number(enquiryMatch[1]))).returning({ id: enquiries.id });
    return deleted.length ? json(200, { message: "Enquiry deleted." }) : json(404, { error: "Enquiry not found." });
  }

  if (pathname === "/api/admin/services/reorder" && method === "POST") {
    const data = await readJson(req);
    const ids: unknown = data.ids;
    if (!Array.isArray(ids) || ids.length > 100 || !ids.every(Number.isSafeInteger)) return json(400, { error: "Provide a valid service order." });
    const known = (await db.select({ id: services.id }).from(services)).map((row) => row.id);
    if (ids.length !== known.length || new Set(ids).size !== known.length || ids.some((id) => !known.includes(id))) {
      return json(400, { error: "The service order must include every service exactly once." });
    }
    await db.transaction(async (tx) => {
      for (const [index, id] of ids.entries()) {
        await tx.update(services).set({ position: index }).where(eq(services.id, id));
      }
    });
    return json(200, { message: "Service order updated." });
  }
  if (pathname === "/api/admin/services" && method === "POST") {
    await saveService(await readJson(req));
    return json(201, { message: "Service added." });
  }
  const serviceMatch = pathname.match(/^\/api\/admin\/services\/(\d+)$/);
  if (serviceMatch && method === "PUT") {
    return (await saveService(await readJson(req), Number(serviceMatch[1])))
      ? json(200, { message: "Service updated." })
      : json(404, { error: "Service not found." });
  }
  if (serviceMatch && method === "DELETE") {
    const deleted = await db.delete(services).where(eq(services.id, Number(serviceMatch[1]))).returning({ id: services.id });
    return deleted.length ? json(200, { message: "Service deleted." }) : json(404, { error: "Service not found." });
  }

  if (pathname === "/api/admin/projects" && method === "POST") {
    await saveProject(await readJson(req));
    return json(201, { message: "Project added." });
  }
  const projectMatch = pathname.match(/^\/api\/admin\/projects\/(\d+)$/);
  if (projectMatch && method === "PUT") {
    return (await saveProject(await readJson(req), Number(projectMatch[1])))
      ? json(200, { message: "Project updated." })
      : json(404, { error: "Project not found." });
  }
  if (projectMatch && method === "DELETE") {
    const deleted = await db.delete(projects).where(eq(projects.id, Number(projectMatch[1]))).returning({ id: projects.id });
    return deleted.length ? json(200, { message: "Project deleted." }) : json(404, { error: "Project not found." });
  }
  const featuredMatch = pathname.match(/^\/api\/admin\/projects\/(\d+)\/featured$/);
  if (featuredMatch && method === "POST") {
    const id = Number(featuredMatch[1]);
    const [existing] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, id));
    if (!existing) return json(404, { error: "Project not found." });
    await db.update(projects).set({ featured: sql`CASE WHEN ${projects.id} = ${id} THEN 1 ELSE 0 END` });
    return json(200, { message: "Featured project updated." });
  }

  if (pathname === "/api/admin/settings" && method === "PATCH") {
    const data = await readJson(req);
    const next = {
      business_name: text(data.business_name, "Business name", 120),
      owner: text(data.owner, "Owner name", 120),
      location: text(data.location, "Location", 120),
      phone: text(data.phone, "Phone", 40),
      email: text(data.email ?? "", "Email", 254, false),
      about_text: text(data.about_text, "About text", 2000),
    };
    if (next.email && !validEmail(next.email)) return json(400, { error: "Enter a valid business email address." });
    await db
      .insert(settings)
      .values(Object.entries(next).map(([key, value]) => ({ key, value })))
      .onConflictDoUpdate({ target: settings.key, set: { value: sql`excluded.value` } });
    return json(200, { message: "Site settings saved." });
  }
  return json(404, { error: "Admin endpoint not found." });
}

async function route(req: Request, context: Context) {
  const pathname = new URL(req.url).pathname;
  const method = req.method;

  if (method === "GET" && pathname === "/api/site") return json(200, await publicSiteData());
  if (method === "POST" && pathname === "/api/enquiries") {
    if (!validateOrigin(req)) return json(403, { error: "This request could not be verified." });
    const data = await readJson(req);
    const name = text(data.name, "Name", 100);
    const email = text(data.email, "Email", 254).toLowerCase();
    const phone = text(data.phone ?? "", "Phone", 40, false);
    const projectType = text(data.project_type, "Project type", 100);
    const description = text(data.description, "Project description", 3000);
    if (!validEmail(email)) return json(400, { error: "Enter a valid email address." });
    await db.insert(enquiries).values({ name, email, phone, project_type: projectType, description, created_at: new Date().toISOString() });
    return json(201, { message: "Thank you. Your enquiry has been sent successfully." });
  }
  if (method === "POST" && pathname === "/api/admin/login") return login(req, context);
  if (pathname.startsWith("/api/admin/")) return admin(req, context, pathname, method);
  return json(404, { error: "Not found." });
}

export default async (req: Request, context: Context) => {
  try {
    return await route(req, context);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status >= 500) console.error("Request failed:", error);
    return json(status, { error: status >= 500 && !(error instanceof HttpError) ? "The server could not complete this request." : (error as Error).message });
  }
};

export const config: Config = {
  path: "/api/*",
};
