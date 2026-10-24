/* Public Supabase connection values shared by FW Manager and FW Worker (no secrets here). */
// Public values only (safe in the browser). Secrets live in .secrets.env on the build machine, never here.
// A test build can point at the separate TEST project with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (see tests/README).
const LIVE_URL = 'https://gnepquxtwkyffjmoydnv.supabase.co'
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL || LIVE_URL
const LIVE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImduZXBxdXh0d2t5ZmZqbW95ZG52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2NTU3OTgsImV4cCI6MjEwODIzMTc5OH0.2TBdAtn3VPjOUTAALblkI6QqHMSz-ZbRyh-CPidX2jU'
export const SUPABASE_ANON_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY || LIVE_ANON
export const IS_TEST_BUILD = SUPABASE_URL !== LIVE_URL
