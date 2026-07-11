import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

export type LogLevel = "info" | "error" | "warn" | "success";
export interface LogEntry {
  t: number;
  level: LogLevel;
  msg: string;
}

type Listener = (entries: LogEntry[]) => void;

const MAX = 1000;
const entries: LogEntry[] = [];
const listeners = new Set<Listener>();

export function pushLog(level: LogLevel, msg: string) {
  entries.push({ t: Date.now(), level, msg });
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
  listeners.forEach((l) => l(entries));
}

export function log(level: LogLevel, msg: string) {
  pushLog(level, msg);
}
export function info(msg: string) {
  pushLog("info", msg);
}
export function error(msg: string) {
  pushLog("error", msg);
}
export function warn(msg: string) {
  pushLog("warn", msg);
}
export function success(msg: string) {
  pushLog("success", msg);
}

export function getLogs(): LogEntry[] {
  return entries;
}

export function subscribeLogs(l: Listener): () => void {
  listeners.add(l);
  l(entries);
  return () => listeners.delete(l);
}

export function useLogs(): LogEntry[] {
  const [logs, setLogs] = useState<LogEntry[]>(getLogs());
  useEffect(() => subscribeLogs(setLogs), []);
  return logs;
}

let started = false;
/** Subscribe to backend `log` events exactly once. */
export function initLogBridge() {
  if (started) return;
  started = true;
  listen<{ level: string; msg: string }>("log", (e) => {
    const level = (e.payload.level as LogLevel) ?? "info";
    pushLog(level, e.payload.msg);
  }).catch(() => {});
}
