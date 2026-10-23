/* v1.2.2 public complaint page: #/grievance/<token>. No login. Anonymous allowed.
 * Only calls the anon RPCs grievance_link_info / submit_grievance / grievance_status. */
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type L = 'en' | 'ms' | 'ne' | 'bn' | 'id' | 'my' | 'hi'
const LANGS: { code: L; name: string }[] = [
  { code: 'en', name: 'English' }, { code: 'ms', name: 'Bahasa Malaysia' }, { code: 'ne', name: 'नेपाली' }, { code: 'bn', name: 'বাংলা' },
  { code: 'id', name: 'Bahasa Indonesia' }, { code: 'my', name: 'မြန်မာ' }, { code: 'hi', name: 'हिन्दी' },
]
const CATS = ['pay', 'hours', 'passport', 'housing', 'safety', 'harassment', 'fees', 'discrimination', 'other'] as const
interface T {
  title: string; intro: string; cat: string; cats: string[]; outlet: string; none: string; msg: string; msgHint: string; anon: string; anonHint: string
  name: string; contact: string; workerNo: string; submit: string; sending: string; thanks: string; code: string; keep: string; track: string; check: string
  st: [string, string, string, string]; reply: string; notFound: string; off: string; short: string; err: string; emergency: string; another: string
}
const TX: Record<L, T> = {
  en: { title: 'Report a problem', intro: 'Tell us about a problem at work or at the hostel. It goes to HR, not to your outlet manager. You can stay anonymous. You will not be punished for complaining.', cat: 'What is it about?', cats: ['Pay / wages', 'Working hours / rest days', 'My passport is kept', 'Housing / hostel', 'Safety / health', 'Harassment / abuse', 'Recruitment fees / debt', 'Unfair treatment', 'Other'], outlet: 'Where do you work? (optional)', none: '— Do not say —', msg: 'What happened?', msgHint: 'Write in any language. At least 10 letters.', anon: 'Send anonymously (no name)', anonHint: 'Your name and phone will not be sent.', name: 'Your name', contact: 'Phone / WhatsApp', workerNo: 'Worker ID (if you know it)', submit: 'Send', sending: 'Sending…', thanks: 'Thank you. Your complaint was sent.', code: 'Your tracking code', keep: 'Write it down or take a photo. Use it below to see the answer. Nobody else can see this code again.', track: 'Check my complaint', check: 'Check', st: ['Received', 'Being checked', 'Action taken', 'Closed'], reply: 'Answer from HR', notFound: 'Code not found. Check the letters.', off: 'This link is not working. Ask HR for the new QR code.', short: 'Please write a little more (at least 10 letters).', err: 'Could not send. Try again later.', emergency: 'In danger now? Call the police: 999.', another: 'Send another' },
  ms: { title: 'Laporkan masalah', intro: 'Beritahu kami tentang masalah di tempat kerja atau di asrama. Ia dihantar kepada HR, bukan kepada pengurus cawangan anda. Anda boleh kekal tanpa nama. Anda tidak akan dihukum kerana membuat aduan.', cat: 'Tentang apa?', cats: ['Gaji', 'Waktu kerja / hari rehat', 'Pasport saya disimpan', 'Perumahan / asrama', 'Keselamatan / kesihatan', 'Gangguan / penderaan', 'Yuran pengambilan / hutang', 'Layanan tidak adil', 'Lain-lain'], outlet: 'Di mana anda bekerja? (pilihan)', none: '— Tidak mahu nyatakan —', msg: 'Apa yang berlaku?', msgHint: 'Tulis dalam apa-apa bahasa. Sekurang-kurangnya 10 huruf.', anon: 'Hantar tanpa nama', anonHint: 'Nama dan telefon anda tidak akan dihantar.', name: 'Nama anda', contact: 'Telefon / WhatsApp', workerNo: 'ID pekerja (jika tahu)', submit: 'Hantar', sending: 'Menghantar…', thanks: 'Terima kasih. Aduan anda telah dihantar.', code: 'Kod jejak anda', keep: 'Tulis atau ambil gambar. Guna di bawah untuk melihat jawapan. Kod ini tidak akan ditunjukkan lagi.', track: 'Semak aduan saya', check: 'Semak', st: ['Diterima', 'Sedang disemak', 'Tindakan diambil', 'Ditutup'], reply: 'Jawapan HR', notFound: 'Kod tidak dijumpai. Semak huruf.', off: 'Pautan ini tidak berfungsi. Minta kod QR baharu daripada HR.', short: 'Sila tulis lebih sedikit (sekurang-kurangnya 10 huruf).', err: 'Gagal dihantar. Cuba lagi nanti.', emergency: 'Dalam bahaya sekarang? Hubungi polis: 999.', another: 'Hantar aduan lain' },
  ne: { title: 'समस्या रिपोर्ट गर्नुहोस्', intro: 'काममा वा होस्टलमा भएको समस्या हामीलाई भन्नुहोस्। यो HR मा जान्छ, तपाईंको आउटलेट म्यानेजरलाई होइन। तपाईं नाम नदिई पठाउन सक्नुहुन्छ। उजुरी गरेकोमा तपाईंलाई सजाय हुने छैन।', cat: 'कुन विषयमा?', cats: ['तलब', 'काम गर्ने समय / बिदा', 'मेरो राहदानी राखिएको छ', 'बसोबास / होस्टल', 'सुरक्षा / स्वास्थ्य', 'दुर्व्यवहार', 'भर्ती शुल्क / ऋण', 'अन्यायपूर्ण व्यवहार', 'अन्य'], outlet: 'तपाईं कहाँ काम गर्नुहुन्छ? (ऐच्छिक)', none: '— भन्न चाहन्न —', msg: 'के भयो?', msgHint: 'जुनसुकै भाषामा लेख्नुहोस्। कम्तीमा १० अक्षर।', anon: 'नाम बिना पठाउनुहोस्', anonHint: 'तपाईंको नाम र फोन पठाइने छैन।', name: 'तपाईंको नाम', contact: 'फोन / WhatsApp', workerNo: 'कामदार ID (थाहा भए)', submit: 'पठाउनुहोस्', sending: 'पठाउँदै…', thanks: 'धन्यवाद। तपाईंको उजुरी पठाइयो।', code: 'तपाईंको ट्र्याकिङ कोड', keep: 'लेखेर वा फोटो खिचेर राख्नुहोस्। जवाफ हेर्न तल प्रयोग गर्नुहोस्। यो कोड फेरि देखाइने छैन।', track: 'मेरो उजुरी हेर्नुहोस्', check: 'हेर्नुहोस्', st: ['प्राप्त भयो', 'जाँच हुँदैछ', 'कारबाही गरियो', 'बन्द'], reply: 'HR को जवाफ', notFound: 'कोड भेटिएन। अक्षरहरू जाँच्नुहोस्।', off: 'यो लिंक चल्दैन। HR सँग नयाँ QR कोड माग्नुहोस्।', short: 'अलि बढी लेख्नुहोस् (कम्तीमा १० अक्षर)।', err: 'पठाउन सकिएन। पछि फेरि प्रयास गर्नुहोस्।', emergency: 'अहिले खतरामा हुनुहुन्छ? प्रहरीलाई फोन गर्नुहोस्: 999।', another: 'अर्को पठाउनुहोस्' },
  bn: { title: 'সমস্যা জানান', intro: 'কাজে বা হোস্টেলে কোনো সমস্যা হলে আমাদের জানান। এটি HR-এর কাছে যায়, আপনার আউটলেট ম্যানেজারের কাছে নয়। আপনি নাম ছাড়াই পাঠাতে পারেন। অভিযোগ করার জন্য আপনাকে শাস্তি দেওয়া হবে না।', cat: 'কী বিষয়ে?', cats: ['বেতন', 'কাজের সময় / ছুটির দিন', 'আমার পাসপোর্ট রাখা হয়েছে', 'থাকার জায়গা / হোস্টেল', 'নিরাপত্তা / স্বাস্থ্য', 'হয়রানি / নির্যাতন', 'নিয়োগ ফি / ঋণ', 'অন্যায় আচরণ', 'অন্যান্য'], outlet: 'আপনি কোথায় কাজ করেন? (ঐচ্ছিক)', none: '— বলতে চাই না —', msg: 'কী হয়েছে?', msgHint: 'যেকোনো ভাষায় লিখুন। অন্তত ১০টি অক্ষর।', anon: 'নাম ছাড়া পাঠান', anonHint: 'আপনার নাম ও ফোন পাঠানো হবে না।', name: 'আপনার নাম', contact: 'ফোন / WhatsApp', workerNo: 'কর্মী আইডি (জানা থাকলে)', submit: 'পাঠান', sending: 'পাঠানো হচ্ছে…', thanks: 'ধন্যবাদ। আপনার অভিযোগ পাঠানো হয়েছে।', code: 'আপনার ট্র্যাকিং কোড', keep: 'লিখে রাখুন বা ছবি তুলুন। উত্তর দেখতে নিচে ব্যবহার করুন। এই কোড আর দেখানো হবে না।', track: 'আমার অভিযোগ দেখুন', check: 'দেখুন', st: ['পাওয়া গেছে', 'দেখা হচ্ছে', 'ব্যবস্থা নেওয়া হয়েছে', 'বন্ধ'], reply: 'HR-এর উত্তর', notFound: 'কোড পাওয়া যায়নি। অক্ষরগুলো দেখুন।', off: 'এই লিংক কাজ করছে না। HR-এর কাছে নতুন QR কোড চান।', short: 'আরও একটু লিখুন (অন্তত ১০টি অক্ষর)।', err: 'পাঠানো যায়নি। পরে আবার চেষ্টা করুন।', emergency: 'এখন বিপদে? পুলিশকে ফোন করুন: 999।', another: 'আরেকটি পাঠান' },
  id: { title: 'Laporkan masalah', intro: 'Ceritakan masalah di tempat kerja atau di asrama. Laporan dikirim ke HR, bukan ke manajer outlet Anda. Anda boleh tanpa nama. Anda tidak akan dihukum karena melapor.', cat: 'Tentang apa?', cats: ['Gaji', 'Jam kerja / hari libur', 'Paspor saya ditahan', 'Perumahan / asrama', 'Keselamatan / kesehatan', 'Pelecehan / kekerasan', 'Biaya rekrutmen / utang', 'Perlakuan tidak adil', 'Lainnya'], outlet: 'Di mana Anda bekerja? (opsional)', none: '— Tidak ingin menyebut —', msg: 'Apa yang terjadi?', msgHint: 'Tulis dalam bahasa apa pun. Minimal 10 huruf.', anon: 'Kirim tanpa nama', anonHint: 'Nama dan telepon Anda tidak akan dikirim.', name: 'Nama Anda', contact: 'Telepon / WhatsApp', workerNo: 'ID pekerja (jika tahu)', submit: 'Kirim', sending: 'Mengirim…', thanks: 'Terima kasih. Laporan Anda sudah dikirim.', code: 'Kode pelacakan Anda', keep: 'Catat atau foto. Gunakan di bawah untuk melihat jawaban. Kode ini tidak akan ditampilkan lagi.', track: 'Cek laporan saya', check: 'Cek', st: ['Diterima', 'Sedang diperiksa', 'Tindakan diambil', 'Ditutup'], reply: 'Jawaban HR', notFound: 'Kode tidak ditemukan. Periksa hurufnya.', off: 'Tautan ini tidak berfungsi. Minta kode QR baru ke HR.', short: 'Tulis sedikit lebih banyak (minimal 10 huruf).', err: 'Gagal mengirim. Coba lagi nanti.', emergency: 'Dalam bahaya sekarang? Hubungi polisi: 999.', another: 'Kirim lagi' },
  my: { title: 'ပြဿနာ တိုင်ကြားရန်', intro: 'အလုပ်တွင် သို့မဟုတ် အဆောင်တွင် ပြဿနာရှိပါက ပြောပြပါ။ ၎င်းသည် HR ထံ ရောက်သည်၊ သင့်ဆိုင်မန်နေဂျာထံ မဟုတ်ပါ။ အမည်မဖော်ဘဲ ပို့နိုင်သည်။ တိုင်ကြားသည့်အတွက် အပြစ်ပေးခံရမည် မဟုတ်ပါ။', cat: 'ဘာအကြောင်းလဲ?', cats: ['လစာ', 'အလုပ်ချိန် / နားရက်', 'ကျွန်ုပ်၏ ပတ်စပို့ကို သိမ်းထားသည်', 'နေထိုင်ရေး / အဆောင်', 'ဘေးကင်းရေး / ကျန်းမာရေး', 'နှောင့်ယှက်ခြင်း / အကြမ်းဖက်ခြင်း', 'အလုပ်ခေါ်ခ / အကြွေး', 'မတရားဆက်ဆံခြင်း', 'အခြား'], outlet: 'ဘယ်မှာ အလုပ်လုပ်သလဲ? (မဖြစ်မနေ မဟုတ်)', none: '— မပြောလိုပါ —', msg: 'ဘာဖြစ်ခဲ့သလဲ?', msgHint: 'မည်သည့်ဘာသာဖြင့်မဆို ရေးပါ။ အနည်းဆုံး စာလုံး ၁၀ လုံး။', anon: 'အမည်မပါဘဲ ပို့ရန်', anonHint: 'သင့်အမည်နှင့် ဖုန်းကို မပို့ပါ။', name: 'သင့်အမည်', contact: 'ဖုန်း / WhatsApp', workerNo: 'အလုပ်သမား ID (သိလျှင်)', submit: 'ပို့ရန်', sending: 'ပို့နေသည်…', thanks: 'ကျေးဇူးတင်ပါသည်။ သင့်တိုင်ကြားချက် ပို့ပြီးပါပြီ။', code: 'သင့် ခြေရာခံကုဒ်', keep: 'ရေးမှတ်ထားပါ သို့မဟုတ် ဓာတ်ပုံရိုက်ပါ။ အဖြေကြည့်ရန် အောက်တွင် သုံးပါ။ ဤကုဒ်ကို ထပ်မပြပါ။', track: 'ကျွန်ုပ်၏ တိုင်ကြားချက် စစ်ရန်', check: 'စစ်ရန်', st: ['လက်ခံရရှိ', 'စစ်ဆေးနေသည်', 'အရေးယူပြီး', 'ပိတ်ပြီး'], reply: 'HR ၏ အဖြေ', notFound: 'ကုဒ် မတွေ့ပါ။ စာလုံးများ စစ်ပါ။', off: 'ဤလင့်ခ် အလုပ်မလုပ်ပါ။ HR ထံ QR ကုဒ်အသစ် တောင်းပါ။', short: 'နည်းနည်း ပိုရေးပါ (အနည်းဆုံး စာလုံး ၁၀ လုံး)။', err: 'မပို့နိုင်ပါ။ နောက်မှ ထပ်ကြိုးစားပါ။', emergency: 'ယခု အန္တရာယ်ရှိပါသလား? ရဲကို ခေါ်ပါ: 999။', another: 'နောက်တစ်ခု ပို့ရန်' },
  hi: { title: 'समस्या बताएं', intro: 'काम पर या हॉस्टल में कोई समस्या हो तो हमें बताएं। यह HR को जाती है, आपके आउटलेट मैनेजर को नहीं। आप बिना नाम के भेज सकते हैं। शिकायत करने पर आपको सज़ा नहीं दी जाएगी।', cat: 'किस बारे में?', cats: ['वेतन', 'काम के घंटे / छुट्टी', 'मेरा पासपोर्ट रखा गया है', 'रहने की जगह / हॉस्टल', 'सुरक्षा / स्वास्थ्य', 'उत्पीड़न / दुर्व्यवहार', 'भर्ती शुल्क / कर्ज़', 'अनुचित व्यवहार', 'अन्य'], outlet: 'आप कहाँ काम करते हैं? (वैकल्पिक)', none: '— नहीं बताना —', msg: 'क्या हुआ?', msgHint: 'किसी भी भाषा में लिखें। कम से कम 10 अक्षर।', anon: 'बिना नाम के भेजें', anonHint: 'आपका नाम और फ़ोन नहीं भेजा जाएगा।', name: 'आपका नाम', contact: 'फ़ोन / WhatsApp', workerNo: 'कर्मचारी ID (अगर पता हो)', submit: 'भेजें', sending: 'भेजा जा रहा है…', thanks: 'धन्यवाद। आपकी शिकायत भेज दी गई है।', code: 'आपका ट्रैकिंग कोड', keep: 'लिख लें या फ़ोटो लें। जवाब देखने के लिए नीचे इस्तेमाल करें। यह कोड दोबारा नहीं दिखेगा।', track: 'मेरी शिकायत देखें', check: 'देखें', st: ['मिल गई', 'जाँच हो रही है', 'कार्रवाई की गई', 'बंद'], reply: 'HR का जवाब', notFound: 'कोड नहीं मिला। अक्षर जाँचें।', off: 'यह लिंक काम नहीं कर रहा। HR से नया QR कोड माँगें।', short: 'थोड़ा और लिखें (कम से कम 10 अक्षर)।', err: 'भेजा नहीं जा सका। बाद में फिर कोशिश करें।', emergency: 'अभी ख़तरे में हैं? पुलिस को कॉल करें: 999।', another: 'एक और भेजें' },
}
const STATUS_IDX: Record<string, number> = { new: 0, in_review: 1, action_taken: 2, closed: 3 }
const pick = (): L => { const n = (navigator.language || 'en').slice(0, 2).toLowerCase(); return (LANGS.some((l) => l.code === n) ? n : 'en') as L }

export default function GrievancePublic({ token }: { token: string }) {
  const [lang, setLang] = useState<L>(pick)
  const t = TX[lang]
  const [info, setInfo] = useState<{ ok: boolean; company?: string; outlets?: { id: string; name: string }[] } | null>(null)
  const [f, setF] = useState({ category: 'pay', outletId: '', message: '', anonymous: true, name: '', contact: '', workerNo: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<{ ref: string; code: string } | null>(null)
  const [code, setCode] = useState('')
  const [st, setSt] = useState<{ ok: boolean; ref?: string; status?: string; reply?: string; updated?: string } | null>(null)
  useEffect(() => { void supabase.rpc('grievance_link_info', { p_token: token }).then(({ data, error }) => setInfo(error ? { ok: false } : (data as { ok: boolean }))) }, [token])
  useEffect(() => { document.documentElement.lang = lang }, [lang])
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    if (f.message.trim().length < 10) return setErr(t.short)
    setBusy(true)
    const { data, error } = await supabase.rpc('submit_grievance', { p_token: token, p: { ...f, outletId: f.outletId || null, language: lang, ...(f.anonymous ? { name: null, contact: null, workerNo: null } : {}) } })
    setBusy(false)
    if (error || !data?.code) return setErr(t.err)
    setDone(data as { ref: string; code: string }); setCode('')
  }
  const check = async (e: React.FormEvent) => {
    e.preventDefault()
    const { data } = await supabase.rpc('grievance_status', { p_code: code.trim() })
    setSt((data as { ok: boolean }) || { ok: false })
  }
  return (
    <div className="auth-wrap" style={{ alignItems: 'flex-start' }}>
      <div style={{ width: '100%', maxWidth: 560, display: 'grid', gap: 14 }}>
        <section className="card" style={{ display: 'grid', gap: 10 }}>
          <div className="row gap-s" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>{t.title}</h2>
            <select value={lang} onChange={(e) => setLang(e.target.value as L)} aria-label="Language">{LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}</select>
          </div>
          {info?.company && <p className="muted" style={{ margin: 0 }}>{info.company}</p>}
          {info === null ? <p className="muted">…</p> : !info.ok ? <div className="banner red">{t.off}</div> : done ? (
            <div className="banner green">
              <strong>{t.thanks}</strong>
              <span>{t.code}:</span>
              <code style={{ fontSize: '1.6rem', letterSpacing: '.15em', fontWeight: 700 }} data-testid="g-code">{done.code}</code>
              <small>{t.keep} ({done.ref})</small>
              <button className="btn" onClick={() => { setDone(null); setF({ ...f, message: '' }) }}>{t.another}</button>
            </div>
          ) : (
            <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
              <p className="small" style={{ margin: 0 }}>{t.intro}</p>
              <label className="field"><span>{t.cat}</span><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map((c, i) => <option key={c} value={c}>{t.cats[i]}</option>)}</select></label>
              {!!info.outlets?.length && <label className="field"><span>{t.outlet}</span><select value={f.outletId} onChange={(e) => setF({ ...f, outletId: e.target.value })}><option value="">{t.none}</option>{info.outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
              <label className="field"><span>{t.msg}</span><textarea rows={5} maxLength={4000} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /><small className="muted">{t.msgHint}</small></label>
              <label className="check"><input type="checkbox" checked={f.anonymous} onChange={(e) => setF({ ...f, anonymous: e.target.checked })} /> {t.anon}</label>
              {f.anonymous ? <small className="muted">{t.anonHint}</small> : <>
                <label className="field"><span>{t.name}</span><input value={f.name} maxLength={120} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
                <label className="field"><span>{t.contact}</span><input value={f.contact} maxLength={60} inputMode="tel" onChange={(e) => setF({ ...f, contact: e.target.value })} /></label>
                <label className="field"><span>{t.workerNo}</span><input value={f.workerNo} maxLength={40} onChange={(e) => setF({ ...f, workerNo: e.target.value })} /></label>
              </>}
              {err && <p className="err">{err}</p>}
              <button className="btn btn-primary" disabled={busy} type="submit">{busy ? t.sending : t.submit}</button>
              <small className="muted">{t.emergency}</small>
            </form>
          )}
        </section>
        <section className="card" style={{ display: 'grid', gap: 10 }}>
          <h3 style={{ margin: 0 }}>{t.track}</h3>
          <form onSubmit={check} className="row gap-s"><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCD2345" aria-label={t.code} style={{ flex: 1, textTransform: 'uppercase' }} /><button className="btn" type="submit">{t.check}</button></form>
          {st && (!st.ok ? <p className="err">{t.notFound}</p> : <div className="banner"><strong>{st.ref} · {t.st[STATUS_IDX[st.status || 'new'] ?? 0]}</strong>{st.reply && <span><b>{t.reply}:</b> {st.reply}</span>}</div>)}
        </section>
      </div>
    </div>
  )
}
