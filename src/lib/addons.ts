// Each add-on's own version. Add-ons ship inside the app and update with it; this says what changed in each.
// When an add-on changes in a release, add a line at the top of its history.
export interface AddOnRelease {
  version: string
  note: string
}
export type AddOnId = 'focusMap' | 'contacts' | 'disc' | 'holidays'

const define = (...history: AddOnRelease[]) => ({ version: history[0].version, history })

export const ADD_ONS: Record<AddOnId, ReturnType<typeof define>> = {
  focusMap: define({ version: '1.0.0', note: 'Sticky notes on an impact × difficulty map, planned into a week.' }),
  contacts: define(
    { version: '1.1.0', note: 'Notes start blurred until you open them, with a setting for each section.' },
    { version: '1.0.0', note: 'An address book with an A–Z index; birthdays on Month and Day.' },
  ),
  disc: define(
    { version: '1.1.0', note: 'Starts blurred until you open it.' },
    { version: '1.0.0', note: 'A main and a second colour for each person, with shares you can drag.' },
  ),
  holidays: define({ version: '1.0.0', note: 'Vietnamese holidays offline, and your own yearly days on Month.' }),
}
