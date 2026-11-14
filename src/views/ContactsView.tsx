import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ConfirmRemove, EyeToggle, Label, Page, PageTitle, Private, Spread, Write } from '../components/ui'
import { DiscDots, DiscEditor } from '../components/Disc'
import { OccasionIcon } from '../components/Occasions'
import { useBlur } from '../lib/contactBlur'
import { MONTHS_SHORT, addDays, fmtShort, todayKey } from '../lib/date'
import { segments } from '../lib/disc'
import { href } from '../lib/router'
import { occasionsOn } from '../lib/occasions'
import { editContacts, getState, uid, useContacts, useSettings, type Contact, type Gender } from '../lib/store'

const GENDERS: { key: Gender; label: string }[] = [
  { key: 'female', label: 'Female' },
  { key: 'male', label: 'Male' },
  { key: 'other', label: 'Other' },
]

const AHEAD = 60
const SHOW_SOON = 8
const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ#']

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase()

/** People are filed under the last word of their name: a Vietnamese given name, a Western surname. */
const fileName = (c: Contact) => fold(c.name.trim().split(/\s+/).pop() ?? '')
const letterOf = (c: Contact) => {
  const l = fileName(c).charAt(0).toUpperCase()
  return l >= 'A' && l <= 'Z' ? l : '#'
}

const birthdayText = (c: Contact) => (c.day === null || c.month === null ? '' : `${MONTHS_SHORT[c.month - 1]} ${c.day}${c.year ? `, ${c.year}` : ''}`)

const isBlank = (c: Contact) => !c.name.trim() && !c.notes.trim() && c.day === null && !c.gender && !Object.keys(c.disc).length

function upcoming(people: Contact[]) {
  const today = todayKey()
  const out: { key: string; label: string; id: string }[] = []
  for (let i = 0; i < AHEAD; i++) {
    const key = addDays(today, i)
    for (const o of occasionsOn(key, { holidays: false, people, days: [] })) out.push({ key, label: o.label, id: o.id! })
  }
  return out
}

function edit(id: string, fn: (c: Contact) => void) {
  editContacts((f) => {
    const c = f.people.find((x) => x.id === id)
    if (c) fn(c)
  })
}

const blank = (id: string, name = ''): Contact => ({ id, name, gender: '', day: null, month: null, year: null, disc: {}, notes: '' })

export function ContactsView() {
  const people = useContacts()
  const { modules } = useSettings()
  const [picked, setPicked] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const list = useRef<HTMLDivElement>(null)
  const person = people.find((p) => p.id === picked) ?? null
  const q = fold(query.trim())

  // Someone opened and left with nothing written isn't a person.
  useEffect(() => {
    if (getState().contacts.people.some((p) => isBlank(p) && p.id !== picked)) editContacts((f) => void (f.people = f.people.filter((p) => !isBlank(p) || p.id === picked)))
  }, [picked])

  const count = people.filter((p) => !isBlank(p)).length
  const shown = people
    .filter((p) => (!q || fold(p.name).includes(q) || fold(p.notes).includes(q)) && !isBlank(p))
    .sort((a, b) => fileName(a).localeCompare(fileName(b)) || fold(a.name).localeCompare(fold(b.name)))
  const groups = LETTERS.map((letter) => ({ letter, people: shown.filter((p) => letterOf(p) === letter) })).filter((g) => g.people.length)
  const soon = upcoming(people)

  const add = () => {
    const id = uid()
    const name = query.trim()
    if (name) editContacts((f) => void f.people.push(blank(id, name)))
    setQuery('')
    setPicked(id)
  }

  const jump = (letter: string) => {
    const box = list.current
    const group = box?.querySelector<HTMLElement>(`[data-letter="${letter}"]`)
    if (box && group) box.scrollTop = group.offsetTop
  }

  const leaveOnEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && picked) {
      e.stopPropagation()
      setPicked(null)
    }
  }

  return (
    <Spread className="contacts-spread">
      <Page side="left" className="contacts-left">
        <nav className="contacts-index" aria-label="Jump to a letter">
          {LETTERS.map((l) => {
            const has = groups.some((g) => g.letter === l)
            return (
              <button key={l} disabled={!has} className={has ? 'has' : ''} onClick={() => jump(l)}>
                {l}
              </button>
            )
          })}
        </nav>

        <PageTitle caps="CONTACTS" italic={count === 1 ? '1 person' : count ? `${count} people` : 'people'} />

        <div className="contacts-find">
          <input
            className="contacts-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !shown.length && query.trim() && add()}
            placeholder="Find someone…"
            aria-label="Find someone"
            spellCheck={false}
          />
          <button className="text-btn" onClick={add}>
            + Add {query.trim() && !shown.length ? `“${query.trim()}”` : 'a person'}
          </button>
        </div>

        <div className="contacts-list" ref={list} aria-label="People">
          {groups.map((g) => (
            <section key={g.letter} data-letter={g.letter}>
              <h3 className="contacts-letter">{g.letter}</h3>
              {g.people.map((p) => (
                <button key={p.id} className={`contact-row ${p.id === picked ? 'is-on' : ''}`} onClick={() => setPicked(p.id === picked ? null : p.id)}>
                  <span className="contact-name ink">{p.name || <em className="muted">No name</em>}</span>
                  {modules.disc && <DiscDots mix={p.disc} />}
                  <span className="contact-bday muted small">{birthdayText(p)}</span>
                </button>
              ))}
            </section>
          ))}
          {!shown.length && <p className="muted contacts-empty">{people.length && q ? 'No one by that name.' : 'No one here yet.'}</p>}
        </div>
      </Page>

      <Page side="right" className="contacts-right">
        <div className="contacts-side" onKeyDown={leaveOnEscape}>
          {picked ? (
            <ContactCard key={picked} c={person ?? blank(picked)} isNew={!person} showDisc={modules.disc} onGone={() => setPicked(null)} />
          ) : (
            <section className="contacts-soon">
              <Label>Birthdays coming up</Label>
              {soon.length ? (
                <ul>
                  {soon.slice(0, SHOW_SOON).map((b) => (
                    <li key={`${b.key}-${b.id}`}>
                      <a className="soon-date" href={href('day', b.key)}>
                        {b.key === todayKey() ? 'Today' : fmtShort(b.key)}
                      </a>
                      <button className="soon-name" onClick={() => setPicked(b.id)}>
                        <OccasionIcon kind="birthday" />
                        {b.label}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted contacts-empty">None in the next two months.</p>
              )}
              {soon.length > SHOW_SOON && <p className="muted small">and {soon.length - SHOW_SOON} more in the next two months</p>}
            </section>
          )}
        </div>
      </Page>
    </Spread>
  )
}

/** A number box that only saves a whole number in range, or nothing; a half-typed value stays here. */
function NumBox({ value, onChange, min, max, label, hint, width }: { value: number | null; onChange: (v: number | null) => boolean; min: number; max: number; label: string; hint: string; width: string }) {
  const [draft, setDraft] = useState(value === null ? '' : String(value))
  const [bad, setBad] = useState(false)
  useEffect(() => setDraft(value === null ? '' : String(value)), [value])
  const commit = () => {
    const t = draft.trim()
    const n = Number(t)
    const ok = t === '' ? onChange(null) : Number.isInteger(n) && n >= min && n <= max && onChange(n)
    setBad(!ok)
  }
  return (
    <input
      className={`num-box ink ${bad ? 'is-bad' : ''}`}
      style={{ width }}
      inputMode="numeric"
      value={draft}
      placeholder={hint}
      aria-label={label}
      aria-invalid={bad}
      onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

/** 29 Feb is allowed: it shows on the 28th in other years. */
const fits = (day: number | null, month: number | null) => day === null || month === null || day <= new Date(2000, month, 0).getDate()

function ContactCard({ c, isNew, showDisc, onGone }: { c: Contact; isNew: boolean; showDisc: boolean; onGone: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const [notesShown, setNotesShown] = useState(false)
  const [discShown, setDiscShown] = useState(false)
  const blurNotes = useBlur('notes')
  const blurDisc = useBlur('disc')
  const notesContent = c.notes.trim() !== ''
  const discContent = segments(c.disc).length > 0
  const notesHidden = blurNotes && !notesShown && notesContent
  const discHidden = blurDisc && !discShown && discContent
  // Day and month are typed one at a time; hold the first until the pair makes a day.
  const [pending, setPending] = useState<{ day: number | null; month: number | null }>({ day: c.day, month: c.month })
  useEffect(() => setPending({ day: c.day, month: c.month }), [c.day, c.month])
  const setDM = (next: { day: number | null; month: number | null }) => {
    setPending(next)
    if (!fits(next.day, next.month)) return false
    if ((next.day === null) !== (next.month === null)) return true
    edit(c.id, (x) => {
      x.day = next.day
      x.month = next.month
      if (next.day === null) x.year = null
    })
    return true
  }
  const half = (pending.day === null) !== (pending.month === null)
  const setName = (v: string) => {
    if (isNew) {
      if (v.trim()) editContacts((f) => void f.people.push(blank(c.id, v)))
    } else edit(c.id, (x) => void (x.name = v))
  }

  return (
    <div className="contact-card">
      <div className="contact-card-head">
        <Write className="contact-name-input" value={c.name} onChange={setName} singleLine ariaLabel="Name" placeholder="Name" autoFocus={isNew} />
        {!isNew &&
          (confirm ? (
            <ConfirmRemove
              what={c.name || 'this person'}
              onRemove={() => {
                editContacts((f) => void (f.people = f.people.filter((x) => x.id !== c.id)))
                onGone()
              }}
              onKeep={() => setConfirm(false)}
            />
          ) : (
            <button className="span-x" aria-label="Remove this person" title="Remove this person" onClick={() => setConfirm(true)}>
              ✕
            </button>
          ))}
      </div>

      {!isNew && (
        <>
          <div className="contact-field">
            <span className="line-label">Gender</span>
            <div className="seg">
              {GENDERS.map((g) => (
                <button key={g.key} className={c.gender === g.key ? 'is-on' : ''} aria-pressed={c.gender === g.key} onClick={() => edit(c.id, (x) => void (x.gender = x.gender === g.key ? '' : g.key))}>
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          <div className="contact-field">
            <span className="line-label">Birthday</span>
            <div className="contact-bday-edit">
              <NumBox label="Day" hint="dd" value={pending.day} min={1} max={31} width="3.2em" onChange={(v) => setDM({ ...pending, day: v })} />
              <span className="muted">/</span>
              <NumBox label="Month" hint="mm" value={pending.month} min={1} max={12} width="3.2em" onChange={(v) => setDM({ ...pending, month: v })} />
              <span className="muted">/</span>
              <NumBox
                label="Year (optional)"
                hint="yyyy"
                value={c.year}
                min={1800}
                max={Number(todayKey().slice(0, 4))}
                width="4.6em"
                onChange={(v) => {
                  if (v !== null && c.day === null) return false
                  edit(c.id, (x) => void (x.year = v))
                  return true
                }}
              />
            </div>
          </div>
          {half && <p className="muted small contact-hint">Add the {pending.day === null ? 'day' : 'month'} too.</p>}

          {showDisc && (
            <DiscEditor
              mix={c.disc}
              hidden={discHidden}
              onReveal={() => setDiscShown(true)}
              showEye={blurDisc && discContent}
              shown={discShown}
              onToggleEye={() => setDiscShown(!discShown)}
              onChange={(next) => {
                setDiscShown(true)
                edit(c.id, (x) => void (x.disc = next))
              }}
            />
          )}

          <div className="label contact-notes-label">
            <span>Notes</span>
            {blurNotes && notesContent && <EyeToggle shown={notesShown} what="notes" onClick={() => setNotesShown(!notesShown)} />}
          </div>
          <Private hidden={notesHidden} onReveal={() => setNotesShown(true)}>
            <Write
              className="dotgrid notes contact-notes"
              value={c.notes}
              onChange={(v) => {
                setNotesShown(true)
                edit(c.id, (x) => void (x.notes = v))
              }}
              rows={8}
              ariaLabel="Notes"
            />
          </Private>
        </>
      )}
    </div>
  )
}
