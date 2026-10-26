/* v1.4.2 company records (migration 045): details, SSM copies and directors.
 * The server decides who sees what: CEO / GM / HR Admin full; HR Manager details + SSM copies, directors' IC / passport
 * masked to the last 4 and never the ID copies; Outlet Manager / Viewer only the company name and sector (the config list).
 * Delete (company, documents, directors) is CEO / GM only. These helpers only call it. */
import { supabase } from './supabase'
import { refreshConfig } from './config'

export const COMPANY_BUCKET = 'company-docs'
export const SECTOR_OPTIONS = ['Services', 'Services/Restaurant', 'Manufacturing', 'Construction', 'Plantation', 'Agriculture', 'Mining & quarrying', 'Domestic service']
export const SSM_DOC_TYPES: { value: string; label: string }[] = [
  { value: 'form9', label: 'Form 9 (Certificate of incorporation)' }, { value: 'form24', label: 'Form 24 (Allotment of shares)' },
  { value: 'form49', label: 'Form 49 (Directors & officers)' }, { value: 'einfo', label: 'SSM e-Info' }, { value: 'profile', label: 'Company profile' }, { value: 'other', label: 'Other SSM document' },
]
export const DESIGNATIONS: { value: string; label: string }[] = [{ value: 'director', label: 'Director' }, { value: 'shareholder', label: 'Shareholder' }, { value: 'director_shareholder', label: 'Director & shareholder' }]
export const docTypeLabel = (t: string) => SSM_DOC_TYPES.find((x) => x.value === t)?.label || t
export const designationLabel = (t: string) => DESIGNATIONS.find((x) => x.value === t)?.label || t

export interface CompanyDetails { company_id: string; ssm_new?: string | null; ssm_old?: string | null; incorporated_on?: string | null; reg_address?: string | null; biz_address?: string | null
  sector?: string | null; phone?: string | null; email?: string | null; notes?: string | null; created_by_name?: string | null; updated_at?: string; updated_by_name?: string | null }
export interface CompanyDoc { id: string; company_id: string; doc_type: string; title?: string | null; path: string; name?: string | null; mime?: string | null; size?: number | null; uploaded_at: string; uploaded_by_name?: string | null; expiry_date?: string | null }
export interface Director { id: string; company_id: string; full_name: string; id_type: 'ic' | 'passport'; id_no?: string | null; nationality?: string | null; designation: string
  email?: string | null; mobile?: string | null; id_file?: string | null; has_id_file?: boolean; full_view?: boolean; updated_at?: string; updated_by_name?: string | null }
export interface NewDirector { full_name: string; id_type: 'ic' | 'passport'; id_no: string; nationality: string; designation: string; email: string; mobile: string; id_file?: string; file_name?: string }
export interface NewDoc { doc_type: string; title?: string; path: string; name: string; mime: string; size: number; expiry_date?: string }

// ---------- client-side checks (same rules as the server's co_validate) for friendly messages before saving
export function icIssue(v: string): string | null {
  const d = v.replace(/[\s-]/g, '')
  if (!/^\d{12}$/.test(d)) return 'IC number must be 12 digits (YYMMDD-PB-###G).'
  const m = +d.slice(2, 4), day = +d.slice(4, 6)
  if (m < 1 || m > 12 || day < 1 || day > 31) return 'IC number must start with a valid date of birth (YYMMDD).'
  return null
}
export const fmtIc = (v: string) => { const d = v.replace(/\D/g, '').slice(0, 12); return [d.slice(0, 6), d.slice(6, 8), d.slice(8)].filter(Boolean).join('-') }
export const emailIssue = (v?: string | null) => (v && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v.trim()) ? 'Email address is not valid.' : null)
export function myPhone(v?: string | null): string | null {
  if (!v?.trim()) return null
  let p = v.replace(/[\s()-]/g, '')
  if (/^0\d/.test(p)) p = '+6' + p; else if (/^60\d/.test(p)) p = '+' + p
  return p
}
export const phoneIssue = (v?: string | null, what = 'Mobile') => { const p = myPhone(v); return p && !/^\+60\d{8,10}$/.test(p) ? `${what} must be a Malaysian number like +60123456789.` : null }
export const ssmIssue = (n?: string | null, o?: string | null) =>
  n && !/^\d{12}$/.test(n.replace(/\s/g, '')) ? 'SSM number (new format) must be 12 digits, e.g. 201901012345.'
    : o && !/^\d{1,7}-?[A-Z]$/i.test(o.replace(/\s/g, '')) ? 'SSM number (old format) looks like 1234567-X.' : null
export function directorIssue(d: NewDirector): string | null {
  if (!d.full_name.trim()) return 'Enter each director\'s full name.'
  if (d.id_no.trim()) {
    if (d.id_type === 'ic') { const i = icIssue(d.id_no); if (i) return `${d.full_name}: ${i}` }
    else { if (!/^[A-Z0-9]{5,15}$/i.test(d.id_no.replace(/\s/g, ''))) return `${d.full_name}: passport number must be 5–15 letters or digits.`; if (!d.nationality.trim()) return `${d.full_name}: give the nationality for a passport.` }
  }
  return emailIssue(d.email) || phoneIssue(d.mobile)
}

// ---------- files
async function put(path: string, file: File) {
  if (file.size > 15 * 1024 * 1024) throw new Error('File is larger than 15 MB.')
  if (!/^(application\/pdf|image\/)/.test(file.type || '')) throw new Error('Attach a PDF or an image.')
  const up = await supabase.storage.from(COMPANY_BUCKET).upload(path, file, { contentType: file.type, upsert: false })
  if (up.error) throw new Error(up.error.message)
  return path
}
const safe = (n: string) => n.replace(/[^\w.-]+/g, '_').slice(-80)
/** while creating: files go to my own staging folder; the server links them to the new company */
export async function uploadStaging(kind: 'ssm' | 'directors', file: File) {
  const uid = (await supabase.auth.getUser()).data.user?.id
  if (!uid) throw new Error('Sign in again.')
  return put(`staging/${uid}/${kind}/${crypto.randomUUID()}-${safe(file.name)}`, file)
}
export const uploadCompanyFile = (company: string, kind: 'ssm' | 'directors', file: File) => put(`${company}/${kind}/${crypto.randomUUID()}-${safe(file.name)}`, file)
export async function companyFileUrl(path: string, download?: string) {
  const { data, error } = await supabase.storage.from(COMPANY_BUCKET).createSignedUrl(path, 300, download ? { download } : undefined)
  if (error) throw new Error(error.message.includes('not found') ? 'You do not have access to this file.' : error.message)
  return data.signedUrl
}

// ---------- data
const must = <T>(r: { data: T | null; error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); return r.data as T }
export async function loadCompany(id: string) {
  const [det, docs, dirs] = await Promise.all([
    supabase.from('company_details').select('*').eq('company_id', id).maybeSingle(),
    supabase.from('company_docs').select('*').eq('company_id', id).order('uploaded_at', { ascending: false }),
    supabase.from('company_directors_v').select('*').eq('company_id', id).order('full_name'),
  ])
  return { details: must(det) as CompanyDetails | null, docs: (must(docs) || []) as CompanyDoc[], directors: (must(dirs) || []) as Director[] }
}
export async function createCompany(p: { name: string; sector?: string; details: Partial<CompanyDetails>; directors: NewDirector[]; docs: NewDoc[] }) {
  const r = await supabase.rpc('company_create', { p: { ...p, directors: p.directors.map(({ file_name: _f, ...d }) => d) } })
  const out = must(r) as { id: string; name: string }
  await refreshConfig().catch(() => {})
  return out
}
export async function updateBasic(id: string, p: { name?: string; sector?: string }) { must(await supabase.rpc('company_update_basic', { p_id: id, p })); await refreshConfig().catch(() => {}) }
export async function saveDetails(id: string, d: Partial<CompanyDetails>) {
  const row = { ...d, company_id: id }; delete (row as Record<string, unknown>).updated_at; delete (row as Record<string, unknown>).created_by_name; delete (row as Record<string, unknown>).updated_by_name
  must(await supabase.from('company_details').upsert(row).select().single())
}
export async function addDoc(company: string, d: NewDoc) { must(await supabase.from('company_docs').insert({ ...d, company_id: company, expiry_date: d.expiry_date || null }).select().single()) }
export async function deleteDoc(doc: CompanyDoc) {
  const r = await supabase.from('company_docs').delete().eq('id', doc.id).select()
  if (must(r)?.length !== 1) throw new Error('Only the CEO or General Manager can delete documents.')
  await supabase.storage.from(COMPANY_BUCKET).remove([doc.path])
}
export async function saveDirector(company: string, d: Partial<NewDirector> & { id?: string }) {
  const { file_name: _f, ...row } = d as NewDirector & { id?: string }
  const clean = { ...row, company_id: company, id_file: row.id_file || null, nationality: row.nationality || null, email: row.email || null, mobile: row.mobile || null, id_no: row.id_no || null }
  if (d.id) must(await supabase.from('company_directors').update(clean).eq('id', d.id).select().single())
  else { delete (clean as Record<string, unknown>).id; must(await supabase.from('company_directors').insert(clean).select().single()) }
}
export async function deleteDirector(d: Director) {
  const r = await supabase.from('company_directors').delete().eq('id', d.id).select('id_file')
  const rows = must(r) as { id_file: string | null }[]
  if (rows?.length !== 1) throw new Error('Only the CEO or General Manager can delete directors.')
  if (rows[0].id_file) await supabase.storage.from(COMPANY_BUCKET).remove([rows[0].id_file])
}
export async function deleteCompany(id: string) {
  const out = must(await supabase.rpc('company_delete', { p_id: id })) as { paths: string[] }
  if (out.paths?.length) await supabase.storage.from(COMPANY_BUCKET).remove(out.paths)
  await refreshConfig().catch(() => {})
}
