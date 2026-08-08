// TODO(persistence): localStorage is a stopgap for the demo. Move to a server-backed per-profile list once the backend/DB stack is chosen (see CLAUDE.md - stack is not finalized).

import * as React from "react";

const STORAGE_KEY = "pezzy:my-list:v2";
const LEGACY_STORAGE_KEY = "pezzy:my-list";
const EMPTY_IDS: string[] = [];

let ids = EMPTY_IDS;
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function readStorage(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeStorage(next: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage failures (quota, privacy mode, etc.)
  }
}

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  ids = readStorage();
}

function setIds(next: string[]) {
  ids = next;
  writeStorage(next);
  emit();
}

function subscribe(listener: () => void) {
  hydrate();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return ids;
}

function getServerSnapshot() {
  return EMPTY_IDS;
}

function add(id: string) {
  hydrate();
  if (ids.includes(id)) return;
  setIds([...ids, id]);
}

function remove(id: string) {
  hydrate();
  if (!ids.includes(id)) return;
  setIds(ids.filter((existing) => existing !== id));
}

function toggle(id: string) {
  hydrate();
  if (ids.includes(id)) remove(id);
  else add(id);
}

export function useMyList() {
  const currentIds = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return {
    ids: currentIds,
    has: (id: string) => currentIds.includes(id),
    toggle,
    add,
    remove,
  };
}
