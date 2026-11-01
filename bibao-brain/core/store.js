/**
 * 持久层：SQLite（node:sqlite，无需原生依赖）。
 *
 * 只负责“存得住、找得到、删得回”——不参与任何认知判断。
 * 情景记忆仍是 brain.memory 里的数组（热层），这里是它的durable账本：
 *   episodes：全部情景（含已被修剪层归档的，archived_at 非空）
 *   facts：夜间归纳出的语义事实，带出处与置信度
 * 数据库打不开时返回 null，调用方退回到原来的 JSON 存档。
 */

import { DatabaseSync } from 'node:sqlite'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  entity_id TEXT,
  title TEXT,
  valence REAL,
  arousal REAL,
  salience REAL,
  s_days REAL,
  r_updated_at INTEGER,
  archived_at INTEGER,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_episodes_at ON episodes(at);
CREATE INDEX IF NOT EXISTS idx_episodes_entity ON episodes(entity_id);
CREATE INDEX IF NOT EXISTS idx_episodes_archived ON episodes(archived_at);

CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  subject TEXT,
  confidence REAL,
  source_ids TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  expires_at INTEGER,
  archived_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject);
CREATE INDEX IF NOT EXISTS idx_facts_archived ON facts(archived_at);

CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
`

export function openBrainStore(file) {
  let db = null
  try {
    db = new DatabaseSync(file)
    db.exec(SCHEMA)
  } catch (error) {
    console.warn('[bibao] sqlite unavailable, falling back to json:', error?.message ?? error)
    return null
  }

  const upsert = db.prepare(`
    INSERT INTO episodes (id, at, entity_id, title, valence, arousal, salience, s_days, r_updated_at, archived_at, json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      s_days = excluded.s_days,
      r_updated_at = excluded.r_updated_at,
      valence = excluded.valence,
      json = excluded.json
  `)
  const archive = db.prepare('UPDATE episodes SET archived_at = ? WHERE id = ? AND archived_at IS NULL')
  const insertFact = db.prepare(`
    INSERT INTO facts (id, text, subject, confidence, source_ids, created_at, updated_at, expires_at, archived_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET
      text = excluded.text,
      confidence = MAX(confidence, excluded.confidence),
      updated_at = excluded.updated_at,
      expires_at = COALESCE(excluded.expires_at, expires_at)
  `)

  return {
    file,
    upsertEpisode(node) {
      try {
        upsert.run(
          node.id,
          node.at ?? 0,
          node.entityId ?? null,
          node.title ?? '',
          node.valence ?? 0,
          node.arousal ?? 0,
          node.salience ?? 0,
          node.sDays ?? 1,
          node.rUpdatedAt ?? node.at ?? 0,
          node.archivedAt ?? null,
          JSON.stringify(node),
        )
      } catch (error) {
        console.warn('[bibao] store.upsertEpisode failed:', error?.message ?? error)
      }
    },
    archiveEpisode(id, at) {
      try {
        archive.run(at, id)
      } catch {
        /* 归档失败不影响主流程 */
      }
    },
    seedEpisodes(nodes = []) {
      if (nodes.length === 0) return 0
      db.exec('BEGIN')
      try {
        for (const node of nodes) {
          upsert.run(
            node.id,
            node.at ?? 0,
            node.entityId ?? null,
            node.title ?? '',
            node.valence ?? 0,
            node.arousal ?? 0,
            node.salience ?? 0,
            node.sDays ?? 1,
            node.rUpdatedAt ?? node.at ?? 0,
            null,
            JSON.stringify(node),
          )
        }
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        console.warn('[bibao] seed failed:', error?.message ?? error)
        return 0
      }
      return nodes.length
    },
    count() {
      const row = db.prepare('SELECT COUNT(*) AS c FROM episodes WHERE archived_at IS NULL').get()
      return Number(row?.c) ?? 0
    },
    archivedCount() {
      const row = db.prepare('SELECT COUNT(*) AS c FROM episodes WHERE archived_at IS NOT NULL').get()
      return Number(row?.c) ?? 0
    },
    insertFact(fact) {
      try {
        insertFact.run(
          fact.id,
          fact.text,
          fact.subject ?? null,
          fact.confidence ?? 0.5,
          JSON.stringify(fact.sourceIds ?? []),
          fact.createdAt ?? Date.now(),
          fact.updatedAt ?? Date.now(),
          fact.expiresAt ?? null,
        )
      } catch (error) {
        console.warn('[bibao] insertFact failed:', error?.message ?? error)
      }
    },
    listFacts(now = Date.now(), limit = 8) {
      const rows = db
        .prepare(
          `SELECT id, text, subject, confidence, source_ids, created_at, expires_at
             FROM facts
            WHERE archived_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
            ORDER BY confidence DESC, created_at DESC
            LIMIT ?`,
        )
        .all(now, limit)
      return rows.map((row) => ({
        id: row.id,
        text: row.text,
        subject: row.subject,
        confidence: row.confidence,
        sourceIds: (() => {
          try {
            return JSON.parse(row.source_ids ?? '[]')
          } catch {
            return []
          }
        })(),
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      }))
    },
    expireFacts(now = Date.now()) {
      try {
        const info = db
          .prepare('UPDATE facts SET archived_at = ? WHERE archived_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?')
          .run(now, now)
        return Number(info.changes ?? 0)
      } catch {
        return 0
      }
    },
    archivedEpisodes(limit = 20) {
      const rows = db
        .prepare('SELECT id, title, archived_at FROM episodes WHERE archived_at IS NOT NULL ORDER BY archived_at DESC LIMIT ?')
        .all(limit)
      return rows.map((row) => ({ id: row.id, title: row.title, archivedAt: row.archived_at }))
    },
    close() {
      try {
        db.close()
      } catch {
        /* already closed */
      }
    },
  }
}
