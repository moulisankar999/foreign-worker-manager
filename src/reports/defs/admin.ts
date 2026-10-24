import { ROLE_LABEL } from '../../lib/workflow'
import { todayISO } from '../../lib/util'
import { mytStamp } from '../format'
import { FREQ_LABEL, STATE_LABEL, STEPS, lastStep, periodLabel, periodsFor, subState } from '../subsData'
import type { ReportDef, Row, Tone } from '../types'
import { audit, doc, errNote, hr, kpi, table, users } from './helpers'

const soon = (id: string, title: string, desc: string): ReportDef => ({ id, title, group: 'Admin & audit', desc, who: (p) => p.isCeo, filters: [], soon: true, build: () => doc([{ kind: 'note', text: 'Coming soon.' }]) })

export const ADMIN: ReportDef[] = [
  {
    id: 'audit', title: 'Audit trail', group: 'Admin & audit', desc: 'Who changed what and when, in the period (up to 5,000 entries)', landscape: true, who: audit, needs: 'audit',
    filters: ['range'], routine: 'monthly',
    build: (c) => {
      const rows: Row[] = (c.extra.audit || []).map((a) => ({ at: mytStamp(new Date(a.at)), by: a.user_name, role: a.user_role ? ROLE_LABEL[a.user_role] || a.user_role : '', act: a.action, ent: a.entity, sum: a.summary }))
      const people = new Set((c.extra.audit || []).map((a) => a.user_name)).size
      return doc([...errNote(c),
        { kind: 'kpis', items: [kpi('Entries', rows.length), kpi('People', people)] },
        table([{ key: 'at', label: 'When (MYT)', w: 13 }, { key: 'by', label: 'By', w: 13 }, { key: 'role', label: 'Role', w: 10 }, { key: 'act', label: 'Action', w: 10 }, { key: 'ent', label: 'Record', w: 10 }, { key: 'sum', label: 'Summary', w: 44, wrap: true }], rows, { empty: 'No audit entries in this period', note: rows.length >= 5000 ? 'Only the first 5,000 entries are shown — narrow the date range.' : undefined }),
      ], rows.length)
    },
  },
  {
    id: 'users', title: 'User access review', group: 'Admin & audit', desc: 'All app users with role, status, outlets and who approved them', landscape: true, who: users, needs: 'users',
    filters: [], routine: 'quarterly',
    build: (c) => {
      const on = (ids?: string[] | null, list: { id: string; name: string }[] = []) => (ids?.length ? ids.map((i) => list.find((x) => x.id === i)?.name || i).join(', ') : 'All')
      const rows: Row[] = (c.extra.users || []).map((u) => ({ _group: ROLE_LABEL[u.role] || u.role, name: u.full_name, email: u.email, st: u.status, outlets: on(u.outlet_ids, c.outlets), cos: on(u.company_ids, c.companies), appr: u.approved_by_name, at: u.approved_at || u.created_at, _tone: (u.status === 'active' ? undefined : 'gray') as Tone | undefined }))
        .sort((a, b) => String(a._group).localeCompare(String(b._group)) || String(a.name).localeCompare(String(b.name)))
      return doc([...errNote(c),
        { kind: 'kpis', items: [kpi('Users', rows.length), kpi('Active', rows.filter((r) => r.st === 'active').length, 'green'), kpi('Pending / disabled', rows.filter((r) => r.st !== 'active').length, 'amber')] },
        table([{ key: 'name', label: 'Name', w: 15 }, { key: 'email', label: 'Email', w: 18 }, { key: 'st', label: 'Status', w: 7 }, { key: 'outlets', label: 'Outlets', w: 20, wrap: true }, { key: 'cos', label: 'Companies', w: 13, wrap: true }, { key: 'appr', label: 'Approved by', w: 12 }, { key: 'at', label: 'Since', fmt: 'date', w: 8 }], rows, { groupBy: '_group', empty: 'No users' }),
        { kind: 'note', text: 'Review each user: remove leavers, check roles still match the job, and confirm outlet access. Sign below to record the review.' },
      ], rows.length)
    },
  },
  {
    id: 'subreg', title: 'Printed submissions register', group: 'Admin & audit', desc: 'Every routine printed report: due date, sign-off progress and filing', who: hr, needs: 'subs',
    filters: [],
    build: (c) => {
      const sub = c.extra.subs
      const today = todayISO()
      const rows: Row[] = []
      for (const s of (sub?.schedules || []).filter((x) => x.active)) for (const p of periodsFor(s, today).slice(0, 6)) {
        const r = sub!.submissions.find((x) => x.schedule_id === s.id && x.period === p)
        const st = subState(s, p, r, today)
        if (st.state === 'open' && !r) continue
        const last = lastStep(r)
        rows.push({ _group: `${s.title} — ${FREQ_LABEL[s.frequency]}`, period: periodLabel(p), due: st.due, state: STATE_LABEL[st.state], last: last ? last.label : '—', by: last && r?.steps[last.key]?.by_name, signs: `${STEPS.filter((x) => x.sign && r?.steps[x.key]).length}/4`, file: r?.file_ref, _tone: st.state === 'overdue' ? 'red' : st.state === 'due' ? 'amber' : st.state === 'filed' ? 'green' : undefined })
      }
      const n = (t: string) => rows.filter((r) => r.state === STATE_LABEL[t as 'filed']).length
      return doc([...errNote(c),
        { kind: 'kpis', items: [kpi('Schedules', (sub?.schedules || []).filter((x) => x.active).length), kpi('Overdue', n('overdue'), 'red'), kpi('Due', n('due'), 'amber'), kpi('Filed', n('filed'), 'green')] },
        table([{ key: 'period', label: 'Period', w: 14 }, { key: 'due', label: 'Due', fmt: 'date', w: 9 }, { key: 'state', label: 'Status', w: 10 }, { key: 'last', label: 'Last step', w: 12 }, { key: 'by', label: 'By', w: 14 }, { key: 'signs', label: 'Signatures', w: 7 }, { key: 'file', label: 'File ref.', w: 12 }], rows, { groupBy: '_group', empty: 'No routine printed reports set up yet' }),
      ], rows.length)
    },
  },
  soon('attendance', 'Attendance & overtime', 'Daily attendance, lateness and overtime hours (needs attendance tracking)'),
  soon('statutory', 'Statutory forms (KWSP / PERKESO / EA)', 'Ready-to-file Borang A, PERKESO monthly and EA forms'),
  soon('training', 'Training & certificates', 'Food handler, safety and other training records'),
]
