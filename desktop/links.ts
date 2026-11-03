// Which links may leave the app, and only into the system browser: Google's sign-in page
// (Drive sync, Calendar add-on) and Duckbook's public privacy pages.
const OPEN_OUTSIDE = ['https://accounts.google.com', 'https://duckbook.khoadev.id.vn']

export function opensOutside(url: string) {
  try {
    const u = new URL(url)
    return OPEN_OUTSIDE.includes(u.origin) && !u.username && !u.password
  } catch {
    return false
  }
}
