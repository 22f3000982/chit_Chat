// Supabase project details. The publishable (anon) key is safe to be public —
// the database rules (supabase/setup.sql) decide who can read what.
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://ooncpqvqiobxxmbxpdxc.supabase.co'
export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_bwlJD5QZ0ERIblDol_Rs7A_nKRh8d8K'

// The two people who can log in. Each one needs a user in
// Supabase → Authentication → Users with this email (created by supabase/create_users.sql).
// Nobody types the email — login is just name + password.
export const USERS = [
  { name: 'Sneha', email: 'sneha@chitchat.app' },
  { name: 'Axon', email: 'axon@chitchat.app' },
]

export const MAX_VIDEO_MB = 50
