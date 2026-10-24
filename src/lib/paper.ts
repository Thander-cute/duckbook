// Page colour is a display choice for this browser, kept outside the notebook data so the
// lock screen can use it before anything is unlocked.
export type Paper = 'white' | 'cream'
const KEY = 'duckbook:paper'

export function getPaper(): Paper {
  try {
    return localStorage.getItem(KEY) === 'cream' ? 'cream' : 'white'
  } catch {
    return 'white'
  }
}

export function applyPaper(p: Paper = getPaper()) {
  document.documentElement.dataset.paper = p
}

export function setPaper(p: Paper) {
  try {
    localStorage.setItem(KEY, p)
  } catch {
    // Private mode or storage off: still switch for this visit.
  }
  applyPaper(p)
}
