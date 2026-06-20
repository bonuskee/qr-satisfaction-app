import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const { Pool } = pg;
const connectionString = String(process.env.DATABASE_URL || "").trim();
const sqliteFile = join(import.meta.dirname, "..", "data", "satisfaction.db");

if (!connectionString) {
  throw new Error("Set DATABASE_URL to the Neon pooled connection string before running this command.");
}

if (!existsSync(sqliteFile)) {
  throw new Error(`SQLite database not found: ${sqliteFile}`);
}

const sqlite = new DatabaseSync(sqliteFile, { readOnly: true });
const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });

const surveys = sqlite
  .prepare("SELECT id, title, branch, status, created_at AS createdAt FROM surveys ORDER BY created_at ASC")
  .all();
const responses = sqlite
  .prepare(
    `SELECT id,
            survey_id AS surveyId,
            rating,
            comment,
            visitor_hash AS visitorHash,
            network_hash AS networkHash,
            user_agent AS userAgent,
            created_at AS createdAt
     FROM responses
     ORDER BY created_at ASC`
  )
  .all();

const client = await pool.connect();

try {
  const schema = await readFile(new URL("../schema.sql", import.meta.url), "utf8");
  await client.query(schema);
  await client.query("BEGIN");

  for (const survey of surveys) {
    await client.query(
      `INSERT INTO surveys (id, title, branch, status, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         branch = EXCLUDED.branch,
         status = EXCLUDED.status`,
      [survey.id, survey.title, survey.branch, survey.status, survey.createdAt]
    );
  }

  for (const response of responses) {
    await client.query(
      `INSERT INTO responses
       (id, survey_id, rating, comment, visitor_hash, network_hash, user_agent, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [
        response.id,
        response.surveyId,
        response.rating,
        response.comment,
        response.visitorHash || "",
        response.networkHash || "",
        response.userAgent || "",
        response.createdAt
      ]
    );
  }

  await client.query("COMMIT");
  console.log(`Migrated ${surveys.length} surveys and ${responses.length} responses to Neon.`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  sqlite.close();
  await pool.end();
}
