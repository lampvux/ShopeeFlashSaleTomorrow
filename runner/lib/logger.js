import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

const VN_OFFSET_MS = 7 * 3600 * 1000;
const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' theo giờ Việt Nam. */
export function vnToday(now = Date.now()) {
  const d = new Date(now + VN_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export function vnTime(now = Date.now()) {
  const d = new Date(now + VN_OFFSET_MS);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export function logDirFor(day = vnToday()) {
  const dir = path.join(ROOT, 'logs', day);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Ghi log ra console + logs/<ngày>/<shop>.log (+ <shop>.jsonl cho dữ liệu chi tiết). */
export function createLogger(dir, name, { quiet = false } = {}) {
  const file = path.join(dir, `${name}.log`);
  const jsonl = path.join(dir, `${name}.jsonl`);
  const write = (level, msg) => {
    const line = `[${vnTime()}] ${level.padEnd(5)} ${msg}`;
    fs.appendFileSync(file, line + '\n');
    if (!quiet) (level === 'ERROR' ? console.error : console.log)(`[${name}] ${line}`);
  };
  return {
    file,
    dir,
    info: (m) => write('INFO', m),
    warn: (m) => write('WARN', m),
    error: (m) => write('ERROR', m),
    json: (tag, data) => fs.appendFileSync(jsonl, JSON.stringify({ t: new Date().toISOString(), tag, data }) + '\n'),
    shotPath: (tag) => path.join(dir, `${tag}-${vnTime().replace(/:/g, '')}.png`),
  };
}

/** Xoá thư mục log cũ hơn N ngày. */
export function cleanupOldLogs(days = 30) {
  const base = path.join(ROOT, 'logs');
  if (!fs.existsSync(base) || !days) return;
  const cutoff = vnToday(Date.now() - days * 86400 * 1000);
  for (const d of fs.readdirSync(base)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d < cutoff) fs.rmSync(path.join(base, d), { recursive: true, force: true });
  }
}

/** Khoá chống chạy chồng (Task Scheduler + chạy tay cùng lúc). */
export function acquireLock(maxAgeMs = 2 * 3600 * 1000) {
  const lock = path.join(ROOT, 'logs', '.run.lock');
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  if (fs.existsSync(lock)) {
    const age = Date.now() - fs.statSync(lock).mtimeMs;
    if (age < maxAgeMs) {
      throw new Error(`Đang có 1 lần chạy khác (lock ${Math.round(age / 1000)}s trước). Xoá ${lock} nếu chắc chắn không còn chạy.`);
    }
  }
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  return () => fs.rmSync(lock, { force: true });
}
