import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';

export interface FileEntry {
  id: number;
  path: string;
  content: Buffer;
  size: number;
  updatedAt: string;
  isDeleted: boolean;
}

export interface AuditLogEntry {
  id: number;
  timestamp: string;
  operation: 'read' | 'write' | 'delete' | 'rename';
  path: string;
  diffSummary: string;
  callerPid: number;
}

export class AuraFSService {
  private dbPath: string;
  private db: sqlite3.Database | null = null;
  private sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    // Store SQLite db file in a temporary session path
    this.dbPath = `/tmp/aurafs_${sessionId}.db`;
  }

  /**
   * Initialize SQLite virtual filesystem schemas.
   */
  public init(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) return reject(err);

        this.db?.serialize(() => {
          // 1. Files table with content BLOB and whiteout deletion state
          this.db?.run(`
            CREATE TABLE IF NOT EXISTS files (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              path TEXT UNIQUE,
              content_blob BLOB,
              size INTEGER,
              updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              is_deleted INTEGER DEFAULT 0
            )
          `);

          // 2. Audit log to track all discrete read/write/delete activities
          this.db?.run(`
            CREATE TABLE IF NOT EXISTS file_audit_log (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
              operation TEXT,
              path TEXT,
              diff_summary TEXT,
              caller_pid INTEGER
            )
          `, (err2) => {
            if (err2) return reject(err2);
            resolve();
          });
        });
      });
    });
  }

  /**
   * Write file content to virtual filesystem.
   */
  public writeFile(filePath: string, content: Buffer, callerPid: number = 0): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('AuraFS Database not initialized.'));

      const size = content.length;
      this.db.run(
        `INSERT INTO files (path, content_blob, size, updated_at, is_deleted)
         VALUES ($path, $content, $size, CURRENT_TIMESTAMP, 0)
         ON CONFLICT(path) DO UPDATE SET
           content_blob = $content,
           size = $size,
           updated_at = CURRENT_TIMESTAMP,
           is_deleted = 0`,
        {
          $path: filePath,
          $content: content,
          $size: size,
        },
        (err) => {
          if (err) return reject(err);

          // Write audit log
          this.db?.run(
            `INSERT INTO file_audit_log (operation, path, diff_summary, caller_pid)
             VALUES ('write', $path, $diff, $pid)`,
            {
              $path: filePath,
              $diff: `Written ${size} bytes`,
              $pid: callerPid,
            },
            (err2) => {
              if (err2) return reject(err2);
              resolve();
            }
          );
        }
      );
    });
  }

  /**
   * Read file content from virtual filesystem.
   */
  public readFile(filePath: string, callerPid: number = 0): Promise<Buffer | null> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('AuraFS Database not initialized.'));

      this.db.get(
        `SELECT content_blob, is_deleted FROM files WHERE path = $path`,
        { $path: filePath },
        (err, row: any) => {
          if (err) return reject(err);
          if (!row || row.is_deleted === 1) {
            resolve(null);
            return;
          }

          // Write audit log for the read operation
          this.db?.run(
            `INSERT INTO file_audit_log (operation, path, diff_summary, caller_pid)
             VALUES ('read', $path, 'Read file bytes', $pid)`,
            {
              $path: filePath,
              $pid: callerPid,
            },
            (err2) => {
              if (err2) return reject(err2);
              resolve(row.content_blob);
            }
          );
        }
      );
    });
  }

  /**
   * Mark a file as deleted (Whiteout pattern).
   */
  public deleteFile(filePath: string, callerPid: number = 0): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('AuraFS Database not initialized.'));

      this.db.run(
        `UPDATE files SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE path = $path`,
        { $path: filePath },
        (err) => {
          if (err) return reject(err);

          // Write audit log
          this.db?.run(
            `INSERT INTO file_audit_log (operation, path, diff_summary, caller_pid)
             VALUES ('delete', $path, 'Whiteout deletion', $pid)`,
            {
              $path: filePath,
              $pid: callerPid,
            },
            (err2) => {
              if (err2) return reject(err2);
              resolve();
            }
          );
        }
      );
    });
  }

  /**
   * Instantly duplicate the database state to another session (tree-of-thought parallel fork).
   */
  public async forkFilesystem(targetSessionId: string): Promise<AuraFSService> {
    const targetPath = `/tmp/aurafs_${targetSessionId}.db`;
    
    // Ensure current DB writes are flushed by closing or backing up.
    // For local SQLite, copying the file is extremely fast (< 5ms) and perfectly safe.
    await this.close();

    fs.copyFileSync(this.dbPath, targetPath);
    
    // Reopen our own database connection
    await this.init();

    // Create and initialize target service
    const targetService = new AuraFSService(targetSessionId);
    await targetService.init();
    return targetService;
  }

  /**
   * Retrieve all audit logs for tracking file modifications.
   */
  public getAuditLogs(): Promise<AuditLogEntry[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('AuraFS Database not initialized.'));

      this.db.all(
        `SELECT id, timestamp, operation, path, diff_summary as diffSummary, caller_pid as callerPid 
         FROM file_audit_log ORDER BY id ASC`,
        (err, rows: any[]) => {
          if (err) return reject(err);
          resolve(rows);
        }
      );
    });
  }

  /**
   * Close the active database connection.
   */
  public close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.db) {
        this.db.close(() => {
          this.db = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Cleanup the database file on host disk.
   */
  public async destroy(): Promise<void> {
    await this.close();
    if (fs.existsSync(this.dbPath)) {
      fs.unlinkSync(this.dbPath);
    }
  }
}
