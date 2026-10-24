import type { Perms } from '../lib/auth'
import type { AppConfig } from '../lib/config'
import type { Outlet, Remark, Settings, Worker } from '../lib/types'
import type { RequestRow } from '../lib/workflow'
import type { Company } from '../lib/companies'

export type Fmt = 'text' | 'date' | 'dt' | 'rm' | 'num' | 'pct' | 'int'
export type Tone = 'red' | 'amber' | 'green' | 'gray' | 'blue'
export interface Col { key: string; label: string; fmt?: Fmt; w?: number; wrap?: boolean }
export type Cell = string | number | boolean | null | undefined
export type Row = Record<string, Cell> & { _tone?: Tone; _toneKey?: string; _group?: string; _wid?: string }

export type Block =
  | { kind: 'kpis'; items: { label: string; value: string | number; tone?: Tone; sub?: string }[] }
  | { kind: 'table'; title?: string; cols: Col[]; rows: Row[]; totals?: Row; empty?: string; note?: string; groupBy?: string; groupLabel?: (g: string, n: number) => string }
  | { kind: 'fields'; title?: string; items: [string, Cell][]; cols?: 2 | 3 | 4 }
  | { kind: 'note'; text: string; tone?: Tone }
  | { kind: 'heading'; text: string; sub?: string }
  | { kind: 'person'; name: string; photo?: string; lines: string[]; badge?: string; tone?: Tone }
  | { kind: 'pagebreak' }
  | { kind: 'signatures' }

export interface ReportDoc { blocks: Block[]; rows?: number }

export type FilterKey = 'company' | 'outlet' | 'btype' | 'nat' | 'gender' | 'status' | 'range' | 'within' | 'docType' | 'month' | 'worker'
export interface Filters {
  company?: string; outlet?: string; btype?: string; nat?: string; gender?: string
  status?: string // '' = report default, 'current' | 'exited' | 'all' | a single WorkerStatus
  from?: string; to?: string; within?: string; docType?: string; month?: string; worker?: string
}
export interface Extra {
  audit?: { id: number; at: string; user_name: string | null; user_role: string | null; action: string; entity: string | null; summary: string | null }[]
  users?: { id: string; email: string | null; full_name: string | null; role: string; status: string; outlet_ids?: string[] | null; company_ids?: string[] | null; approved_by_name?: string | null; approved_at?: string | null; created_at: string }[]
  subs?: { schedules: import('./subsData').Schedule[]; submissions: import('./subsData').Submission[] }
  error?: string
}
export interface Ctx {
  workers: Worker[] // filtered by the worker filters (company, outlet, status, ...)
  all: Worker[] // every worker this user may see (server-scoped)
  outlets: Outlet[]
  companies: Company[]
  s: Settings
  cfg: AppConfig
  reqs: RequestRow[]
  remarks: Remark[]
  f: Filters
  p: Perms
  mask: boolean // mask ID / account numbers
  extra: Extra
  inRange: (d?: string | null) => boolean
}
export type Need = 'audit' | 'users' | 'subs'
export interface ReportDef {
  id: string
  title: string
  group: string
  desc: string
  landscape?: boolean
  /** who may run it (the data itself is already limited by the server for the role) */
  who: (p: Perms) => boolean
  filters: FilterKey[]
  /** default worker status filter */
  status?: 'current' | 'all' | 'exited'
  needs?: Need
  /** typical routine for required printed submissions */
  routine?: 'monthly' | 'quarterly' | 'half_yearly' | 'yearly'
  build: (c: Ctx) => ReportDoc
  soon?: boolean
}
