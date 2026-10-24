import { useSyncExternalStore } from "react";

// How a done habit is marked. A display choice for this browser, like the paper colour.
export type HabitMarkStyle = "dot" | "hatch" | "tick";
const KEY = "duckbook:habit-mark";
const listeners = new Set<() => void>();
let current: HabitMarkStyle | null = null;

export function getHabitMark(): HabitMarkStyle {
  try {
    const v = localStorage.getItem(KEY);
    return v === "hatch" || v === "tick" ? v : "dot";
  } catch {
    return "dot";
  }
}

export function setHabitMark(v: HabitMarkStyle) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    // Storage off: the choice lasts until reload.
    current = v;
  }
  listeners.forEach((l) => l());
}

const read = () => current ?? getHabitMark();
const subscribe = (l: () => void) => (
  listeners.add(l),
  () => void listeners.delete(l)
);

export function useHabitMark() {
  return useSyncExternalStore(subscribe, read);
}
