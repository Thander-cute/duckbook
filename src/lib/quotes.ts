// Original gentle notes for the daily page, one per date.
const NOTES = [
  'Small steps still move you forward.',
  'Rest is part of the work, not a reward for it.',
  'Do one thing, and do it fully.',
  'You don’t have to finish everything to have a good day.',
  'Start where you are. Use what you have.',
  'A slow morning is still a morning.',
  'Be as kind to yourself as you are to a friend.',
  'Clarity comes from doing, not from waiting.',
  'Five honest tasks beat fifteen hopeful ones.',
  'Drink some water. Then begin.',
  'Progress, not perfection.',
  'The present is the only page you can write on.',
  'Some days are for building, some for resting. Both count.',
  'Notice one small good thing today.',
]

export const noteFor = (dayKey: string) => {
  let h = 0
  for (const c of dayKey) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return NOTES[h % NOTES.length]
}
