import pg from "pg";
import { readFile } from "node:fs/promises";

const { Pool } = pg;

export type SurveyStatus = "open" | "closed";

export type Survey = {
  id: string;
  title: string;
  branch: string;
  status: SurveyStatus;
  createdAt: string;
};

export type SurveyResponse = {
  id: string;
  surveyId: string;
  rating: number;
  comment: string;
  createdAt: string;
  deviceId?: string;
  networkId?: string;
};

export type ResponseSecurityMetadata = {
  visitorHash: string;
  networkHash: string;
  userAgent: string;
};

export type Database = {
  surveys: Survey[];
  responses: SurveyResponse[];
};

const connectionString = String(process.env.DATABASE_URL || "").trim();

if (!connectionString) {
  throw new Error("DATABASE_URL is required. Create a Neon database and add its pooled connection string.");
}

const pool = new Pool({
  connectionString,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL connection error", error);
});

export async function initializeDatabase() {
  const schema = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  await pool.query(schema);
  await purgeExpiredSessions();
}

export async function checkDatabaseConnection() {
  await pool.query("SELECT 1");
}

export async function readDatabase(): Promise<Database> {
  const [surveyResult, responseResult] = await Promise.all([
    pool.query(
      `SELECT id, title, branch, status, created_at AS "createdAt"
       FROM surveys
       ORDER BY created_at DESC`
    ),
    pool.query(
      `SELECT id, survey_id AS "surveyId", rating, comment, created_at AS "createdAt"
       FROM responses
       ORDER BY created_at ASC`
    )
  ]);

  return {
    surveys: surveyResult.rows as Survey[],
    responses: responseResult.rows as SurveyResponse[]
  };
}

export async function findSurvey(id: string) {
  const result = await pool.query(
    `SELECT id, title, branch, status, created_at AS "createdAt"
     FROM surveys
     WHERE id = $1`,
    [id]
  );
  return result.rows[0] as Survey | undefined;
}

export async function findSurveyResponses(surveyId: string) {
  const result = await pool.query(
    `SELECT id,
            survey_id AS "surveyId",
            rating,
            comment,
            created_at AS "createdAt",
            CASE WHEN visitor_hash = '' THEN '' ELSE substr(visitor_hash, 1, 12) END AS "deviceId",
            CASE WHEN network_hash = '' THEN '' ELSE substr(network_hash, 1, 12) END AS "networkId"
     FROM responses
     WHERE survey_id = $1
     ORDER BY created_at DESC`,
    [surveyId]
  );
  return result.rows as SurveyResponse[];
}

export async function insertSurvey(survey: Survey) {
  await pool.query(
    `INSERT INTO surveys (id, title, branch, status, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [survey.id, survey.title, survey.branch, survey.status, survey.createdAt]
  );
}

export async function updateSurvey(id: string, title: string, branch: string) {
  await pool.query("UPDATE surveys SET title = $1, branch = $2 WHERE id = $3", [title, branch, id]);
}

export async function setSurveyStatus(id: string, status: SurveyStatus) {
  await pool.query("UPDATE surveys SET status = $1 WHERE id = $2", [status, id]);
}

export async function removeSurvey(id: string) {
  await pool.query("DELETE FROM surveys WHERE id = $1", [id]);
}

export async function removeSurveyResponses(id: string) {
  await pool.query("DELETE FROM responses WHERE survey_id = $1", [id]);
}

export async function insertResponse(response: SurveyResponse, metadata: ResponseSecurityMetadata) {
  await pool.query(
    `INSERT INTO responses
     (id, survey_id, rating, comment, visitor_hash, network_hash, user_agent, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      response.id,
      response.surveyId,
      response.rating,
      response.comment,
      metadata.visitorHash,
      metadata.networkHash,
      metadata.userAgent,
      response.createdAt
    ]
  );
}

export async function createSession(tokenHash: string, expiresAt: number) {
  await pool.query(
    `INSERT INTO admin_sessions (token_hash, expires_at, created_at)
     VALUES ($1, $2, $3)`,
    [tokenHash, expiresAt, new Date().toISOString()]
  );
}

export async function sessionExists(tokenHash: string) {
  const result = await pool.query(
    `SELECT 1
     FROM admin_sessions
     WHERE token_hash = $1 AND expires_at > $2`,
    [tokenHash, Date.now()]
  );
  return result.rowCount === 1;
}

export async function removeSession(tokenHash: string) {
  await pool.query("DELETE FROM admin_sessions WHERE token_hash = $1", [tokenHash]);
}

export async function purgeExpiredSessions() {
  await pool.query("DELETE FROM admin_sessions WHERE expires_at <= $1", [Date.now()]);
}
