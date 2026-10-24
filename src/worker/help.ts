/* FW Worker Help: FAQ and simple how-to guides, in the worker's language. Tamil first.
 * Used by the in-app Help sheet and the printed worker guide (scripts/manuals/build.mjs).
 * Machine-drafted translations (ta, hi, ms, ne, bn) — a native speaker must check them before wide release.
 * Languages without help text (te, ml, kn, my) show English. Keep answers short: every screen must fit without scrolling. */
import type { Lang } from './i18n'

export interface WorkerHelp {
  ui: { help: string; faq: string; howTo: string; pdf: string; pdfNeedsSignIn: string; pdfMissing: string; list: string }
  faq: [string, string][]
  guides: { title: string; steps: string[] }[]
}

const en: WorkerHelp = {
  ui: { help: 'Help', faq: 'Questions', howTo: 'How to', pdf: 'Guide with pictures (PDF)', pdfNeedsSignIn: 'Sign in to download the guide.', pdfMissing: 'The guide is not ready yet. Ask HR.', list: 'All' },
  faq: [
    ['What is FW Worker?', 'Your own app from the company. See your papers, ask for leave or money, and follow your requests. Only you can see your details.'],
    ['How do I sign in?', 'Type your passport number and the 6-digit PIN that HR gave you. Then tap Sign in.'],
    ['I forgot my PIN.', 'Ask HR or your outlet manager. HR will give you a new PIN. Never tell your PIN to anyone.'],
    ['It says "locked".', 'You typed a wrong PIN too many times. Wait a few minutes, or ask HR to unlock it.'],
    ['How do I ask for leave?', 'Tap ＋ New → Leave. Choose the type and the dates, write a short reason, check and Send.'],
    ['Who sees my request?', 'First your outlet manager, then HR. A complaint about your manager goes only to HR and the boss.'],
    ['What do the colours mean?', 'Green = OK. Orange = soon / waiting. Red = expired or rejected. Blue = HR needs your answer.'],
    ['HR asked me a question.', 'Open Requests, tap the request marked "HR needs your answer", type your answer and tap Send answer.'],
    ['My passport or permit will expire.', 'Look at Papers. If it is orange or red, tap ＋ New → Renew papers, or talk to HR.'],
    ['How do I change my PIN?', 'Tap Me → Change PIN. Type the old PIN, then the new PIN two times.'],
    ['How do I change the language?', 'Tap Me → Language (or 🌐 on the sign-in screen) and choose your language.'],
    ['Is my data safe?', 'Yes. You see only your own details. Your PIN is secret — the company cannot see it.'],
  ],
  guides: [
    { title: 'Your part', steps: ['Keep your PIN secret.', 'Check Papers every month.', 'Ask for leave early with this app.', 'Answer HR quickly when they ask.'] },
    { title: 'Sign in', steps: ['Open FW Worker.', 'Type your passport number.', 'Type your 6-digit PIN.', 'Tap Sign in.'] },
    { title: 'See your papers', steps: ['Tap 🛂 Papers.', 'Each paper shows its expiry date.', 'Orange or red: talk to HR.'] },
    { title: 'Ask for leave', steps: ['Tap ＋ New.', 'Tap Leave and choose the type.', 'Choose From and To dates.', 'Check and tap Send.'] },
    { title: 'Follow a request', steps: ['Tap 📨 Requests.', 'Tap a request to see its history.', 'Blue: HR needs your answer — reply there.', 'You can cancel while it is waiting.'] },
    { title: 'Change PIN or language', steps: ['Tap 👤 Me.', 'Tap Change PIN, or Language.', 'Follow the steps on the screen.'] },
    { title: 'Install the app', steps: ['Android: HR gives you the app link.', 'iPhone: install from the App Store.', 'Or open the link in Chrome → Add to home screen.'] },
  ],
}

const ta: WorkerHelp = {
  ui: { help: 'உதவி', faq: 'கேள்விகள்', howTo: 'எப்படி', pdf: 'படங்களுடன் வழிகாட்டி (PDF)', pdfNeedsSignIn: 'வழிகாட்டியைப் பதிவிறக்க உள்நுழையவும்.', pdfMissing: 'வழிகாட்டி இன்னும் தயாராகவில்லை. HR-இடம் கேளுங்கள்.', list: 'அனைத்தும்' },
  faq: [
    ['FW Worker என்றால் என்ன?', 'நிறுவனம் உங்களுக்குத் தரும் சொந்த ஆப். உங்கள் ஆவணங்களைப் பார்க்கலாம், விடுப்பு அல்லது பணம் கேட்கலாம், கோரிக்கைகளைப் பின்தொடரலாம். உங்கள் விவரங்கள் உங்களுக்கு மட்டுமே தெரியும்.'],
    ['எப்படி உள்நுழைவது?', 'உங்கள் பாஸ்போர்ட் எண்ணையும் HR கொடுத்த 6 இலக்க PIN-ஐயும் தட்டச்சு செய்து "உள்நுழை" அழுத்தவும்.'],
    ['PIN மறந்துவிட்டேன்.', 'HR அல்லது உங்கள் கடை மேலாளரிடம் கேளுங்கள். HR புதிய PIN தருவார். உங்கள் PIN-ஐ யாரிடமும் சொல்லாதீர்கள்.'],
    ['"பூட்டப்பட்டது" என்று வருகிறது.', 'பல முறை தவறான PIN போட்டீர்கள். சில நிமிடங்கள் காத்திருங்கள், அல்லது HR-இடம் திறக்கச் சொல்லுங்கள்.'],
    ['விடுப்பு எப்படிக் கேட்பது?', '＋ புதியது → விடுப்பு. வகையையும் தேதிகளையும் தேர்ந்தெடுத்து, சிறு காரணம் எழுதி, சரிபார்த்து அனுப்பவும்.'],
    ['என் கோரிக்கையை யார் பார்ப்பார்கள்?', 'முதலில் உங்கள் கடை மேலாளர், பிறகு HR. மேலாளர் பற்றிய புகார் HR-க்கும் முதலாளிக்கும் மட்டுமே போகும்.'],
    ['நிறங்களின் பொருள் என்ன?', 'பச்சை = சரி. ஆரஞ்சு = விரைவில் / காத்திருக்கிறது. சிவப்பு = காலாவதி அல்லது நிராகரிப்பு. நீலம் = HR உங்கள் பதிலைக் கேட்கிறது.'],
    ['HR ஒரு கேள்வி கேட்டார்.', 'கோரிக்கை → "HR உங்கள் பதிலை கேட்கிறது" என்ற கோரிக்கையைத் திறந்து, பதில் எழுதி "பதில் அனுப்பு" அழுத்தவும்.'],
    ['என் பாஸ்போர்ட் / பெர்மிட் காலாவதியாகப் போகிறது.', 'ஆவணம் பகுதியைப் பாருங்கள். ஆரஞ்சு அல்லது சிவப்பு என்றால் ＋ புதியது → ஆவண புதுப்பிப்பு, அல்லது HR-இடம் பேசுங்கள்.'],
    ['PIN-ஐ எப்படி மாற்றுவது?', 'நான் → PIN மாற்று. பழைய PIN, பிறகு புதிய PIN-ஐ இரண்டு முறை போடவும்.'],
    ['மொழியை எப்படி மாற்றுவது?', 'நான் → மொழி (அல்லது உள்நுழைவுத் திரையில் 🌐) அழுத்தி உங்கள் மொழியைத் தேர்ந்தெடுக்கவும்.'],
    ['என் தகவல் பாதுகாப்பானதா?', 'ஆம். உங்கள் விவரங்களை நீங்கள் மட்டுமே பார்க்கலாம். உங்கள் PIN ரகசியம் — நிறுவனத்தாலும் அதைப் பார்க்க முடியாது.'],
  ],
  guides: [
    { title: 'உங்கள் பொறுப்பு', steps: ['PIN-ஐ ரகசியமாக வைத்திருங்கள்.', 'ஒவ்வொரு மாதமும் ஆவணங்களைப் பாருங்கள்.', 'விடுப்பை முன்கூட்டியே இந்த ஆப்பில் கேளுங்கள்.', 'HR கேட்டால் விரைவாகப் பதில் சொல்லுங்கள்.'] },
    { title: 'உள்நுழைவு', steps: ['FW Worker-ஐத் திறக்கவும்.', 'பாஸ்போர்ட் எண்ணைத் தட்டச்சு செய்யவும்.', '6 இலக்க PIN-ஐப் போடவும்.', '"உள்நுழை" அழுத்தவும்.'] },
    { title: 'ஆவணங்களைப் பார்க்க', steps: ['🛂 ஆவணம் அழுத்தவும்.', 'ஒவ்வொரு ஆவணத்துக்கும் காலாவதி தேதி தெரியும்.', 'ஆரஞ்சு / சிவப்பு என்றால் HR-இடம் பேசுங்கள்.'] },
    { title: 'விடுப்பு கேட்க', steps: ['＋ புதியது அழுத்தவும்.', 'விடுப்பு → வகையைத் தேர்ந்தெடுக்கவும்.', 'தொடக்க, முடிவு தேதிகளைத் தேர்ந்தெடுக்கவும்.', 'சரிபார்த்து "அனுப்பு" அழுத்தவும்.'] },
    { title: 'கோரிக்கையைப் பின்தொடர', steps: ['📨 கோரிக்கை அழுத்தவும்.', 'ஒரு கோரிக்கையைத் தொட்டால் அதன் வரலாறு தெரியும்.', 'நீலம்: HR உங்கள் பதிலைக் கேட்கிறது — அங்கே பதில் சொல்லுங்கள்.', 'காத்திருக்கும்போது ரத்து செய்யலாம்.'] },
    { title: 'PIN / மொழி மாற்ற', steps: ['👤 நான் அழுத்தவும்.', '"PIN மாற்று" அல்லது "மொழி" அழுத்தவும்.', 'திரையில் உள்ள படிகளைப் பின்பற்றவும்.'] },
    { title: 'ஆப்பை நிறுவ', steps: ['Android: HR ஆப் இணைப்பைத் தருவார்.', 'iPhone: App Store-இல் நிறுவவும்.', 'அல்லது Chrome-இல் இணைப்பைத் திறந்து → முகப்புத் திரையில் சேர்.'] },
  ],
}

const hi: WorkerHelp = {
  ui: { help: 'मदद', faq: 'सवाल', howTo: 'कैसे करें', pdf: 'चित्रों वाली गाइड (PDF)', pdfNeedsSignIn: 'गाइड डाउनलोड करने के लिए साइन इन करें।', pdfMissing: 'गाइड अभी तैयार नहीं है। HR से पूछें।', list: 'सभी' },
  faq: [
    ['FW Worker क्या है?', 'कंपनी की ओर से आपका अपना ऐप। अपने कागज़ देखें, छुट्टी या पैसे माँगें और अपने अनुरोध देखें। आपकी जानकारी सिर्फ़ आप देख सकते हैं।'],
    ['साइन इन कैसे करें?', 'अपना पासपोर्ट नंबर और HR का दिया 6 अंकों का PIN लिखें, फिर साइन इन दबाएँ।'],
    ['मैं PIN भूल गया।', 'HR या अपने आउटलेट मैनेजर से पूछें। HR नया PIN देगा। अपना PIN किसी को न बताएँ।'],
    ['"लॉक" लिखा आ रहा है।', 'आपने कई बार गलत PIN डाला। कुछ मिनट रुकें या HR से खुलवाएँ।'],
    ['छुट्टी कैसे माँगें?', '＋ नया → छुट्टी। प्रकार और तारीखें चुनें, छोटा कारण लिखें, जाँचें और भेजें।'],
    ['मेरा अनुरोध कौन देखता है?', 'पहले आउटलेट मैनेजर, फिर HR। मैनेजर की शिकायत सिर्फ़ HR और मालिक तक जाती है।'],
    ['रंगों का मतलब?', 'हरा = ठीक। नारंगी = जल्द / इंतज़ार। लाल = समाप्त या अस्वीकार। नीला = HR को आपका जवाब चाहिए।'],
    ['HR ने सवाल पूछा है।', 'अनुरोध खोलें, "HR को आपका जवाब चाहिए" वाले पर दबाएँ, जवाब लिखें और भेजें।'],
    ['पासपोर्ट / परमिट खत्म होने वाला है।', 'कागज़ देखें। नारंगी या लाल हो तो ＋ नया → कागज़ नवीनीकरण, या HR से बात करें।'],
    ['PIN कैसे बदलें?', 'मैं → PIN बदलें। पुराना PIN, फिर नया PIN दो बार लिखें।'],
    ['भाषा कैसे बदलें?', 'मैं → भाषा (या साइन इन स्क्रीन पर 🌐) दबाकर अपनी भाषा चुनें।'],
    ['क्या मेरी जानकारी सुरक्षित है?', 'हाँ। आप सिर्फ़ अपनी जानकारी देखते हैं। आपका PIN गुप्त है — कंपनी भी उसे नहीं देख सकती।'],
  ],
  guides: [
    { title: 'आपकी ज़िम्मेदारी', steps: ['PIN गुप्त रखें।', 'हर महीने कागज़ देखें।', 'छुट्टी पहले से इस ऐप में माँगें।', 'HR पूछे तो जल्दी जवाब दें।'] },
    { title: 'साइन इन', steps: ['FW Worker खोलें।', 'पासपोर्ट नंबर लिखें।', '6 अंकों का PIN लिखें।', 'साइन इन दबाएँ।'] },
    { title: 'कागज़ देखें', steps: ['🛂 कागज़ दबाएँ।', 'हर कागज़ की समाप्ति तारीख दिखती है।', 'नारंगी या लाल: HR से बात करें।'] },
    { title: 'छुट्टी माँगें', steps: ['＋ नया दबाएँ।', 'छुट्टी → प्रकार चुनें।', 'से और तक तारीखें चुनें।', 'जाँचें और भेजें दबाएँ।'] },
    { title: 'अनुरोध देखें', steps: ['📨 अनुरोध दबाएँ।', 'किसी अनुरोध पर दबाकर इतिहास देखें।', 'नीला: HR को जवाब चाहिए — वहीं जवाब दें।', 'इंतज़ार के समय रद्द कर सकते हैं।'] },
    { title: 'PIN या भाषा बदलें', steps: ['👤 मैं दबाएँ।', 'PIN बदलें या भाषा दबाएँ।', 'स्क्रीन के कदम पूरे करें।'] },
    { title: 'ऐप इंस्टॉल करें', steps: ['Android: HR ऐप का लिंक देगा।', 'iPhone: App Store से इंस्टॉल करें।', 'या Chrome में लिंक खोलें → होम स्क्रीन पर जोड़ें।'] },
  ],
}

const ms: WorkerHelp = {
  ui: { help: 'Bantuan', faq: 'Soalan', howTo: 'Cara', pdf: 'Panduan bergambar (PDF)', pdfNeedsSignIn: 'Log masuk untuk muat turun panduan.', pdfMissing: 'Panduan belum siap. Tanya HR.', list: 'Semua' },
  faq: [
    ['Apa itu FW Worker?', 'Aplikasi anda sendiri daripada syarikat. Lihat dokumen, mohon cuti atau wang, dan ikuti permohonan anda. Hanya anda boleh lihat butiran anda.'],
    ['Bagaimana log masuk?', 'Taip nombor pasport dan PIN 6 digit yang diberi HR, kemudian tekan Log masuk.'],
    ['Saya lupa PIN.', 'Tanya HR atau pengurus outlet. HR akan beri PIN baharu. Jangan beritahu PIN anda kepada sesiapa.'],
    ['Tertulis "dikunci".', 'Anda salah taip PIN terlalu banyak kali. Tunggu beberapa minit atau minta HR membukanya.'],
    ['Bagaimana mohon cuti?', 'Tekan ＋ Baru → Cuti. Pilih jenis dan tarikh, tulis sebab ringkas, semak dan Hantar.'],
    ['Siapa lihat permohonan saya?', 'Mula-mula pengurus outlet, kemudian HR. Aduan tentang pengurus hanya kepada HR dan bos.'],
    ['Apa maksud warna?', 'Hijau = OK. Oren = tidak lama lagi / menunggu. Merah = tamat atau ditolak. Biru = HR perlukan jawapan anda.'],
    ['HR tanya soalan.', 'Buka Permohonan, tekan yang bertanda "HR perlukan jawapan", taip jawapan dan Hantar jawapan.'],
    ['Pasport / permit hampir tamat.', 'Lihat Dokumen. Jika oren atau merah, tekan ＋ Baru → Baharui dokumen, atau jumpa HR.'],
    ['Bagaimana tukar PIN?', 'Saya → Tukar PIN. Taip PIN lama, kemudian PIN baharu dua kali.'],
    ['Bagaimana tukar bahasa?', 'Saya → Bahasa (atau 🌐 di skrin log masuk) dan pilih bahasa anda.'],
    ['Adakah data saya selamat?', 'Ya. Anda hanya lihat butiran sendiri. PIN anda rahsia — syarikat pun tidak boleh melihatnya.'],
  ],
  guides: [
    { title: 'Tanggungjawab anda', steps: ['Rahsiakan PIN anda.', 'Semak Dokumen setiap bulan.', 'Mohon cuti awal melalui aplikasi ini.', 'Jawab HR dengan cepat.'] },
    { title: 'Log masuk', steps: ['Buka FW Worker.', 'Taip nombor pasport.', 'Taip PIN 6 digit.', 'Tekan Log masuk.'] },
    { title: 'Lihat dokumen', steps: ['Tekan 🛂 Dokumen.', 'Setiap dokumen tunjuk tarikh tamat.', 'Oren atau merah: jumpa HR.'] },
    { title: 'Mohon cuti', steps: ['Tekan ＋ Baru.', 'Tekan Cuti dan pilih jenis.', 'Pilih tarikh Dari dan Hingga.', 'Semak dan tekan Hantar.'] },
    { title: 'Ikuti permohonan', steps: ['Tekan 📨 Permohonan.', 'Tekan satu permohonan untuk lihat sejarah.', 'Biru: HR perlukan jawapan — balas di situ.', 'Boleh batal semasa menunggu.'] },
    { title: 'Tukar PIN / bahasa', steps: ['Tekan 👤 Saya.', 'Tekan Tukar PIN atau Bahasa.', 'Ikut langkah di skrin.'] },
    { title: 'Pasang aplikasi', steps: ['Android: HR beri pautan aplikasi.', 'iPhone: pasang dari App Store.', 'Atau buka pautan di Chrome → Tambah ke skrin utama.'] },
  ],
}

const ne: WorkerHelp = {
  ui: { help: 'मद्दत', faq: 'प्रश्न', howTo: 'कसरी', pdf: 'चित्रसहितको गाइड (PDF)', pdfNeedsSignIn: 'गाइड डाउनलोड गर्न साइन इन गर्नुहोस्।', pdfMissing: 'गाइड अझै तयार छैन। HR लाई सोध्नुहोस्।', list: 'सबै' },
  faq: [
    ['FW Worker के हो?', 'कम्पनीले दिएको तपाईंको आफ्नै एप। आफ्ना कागजात हेर्नुहोस्, बिदा वा पैसा माग्नुहोस्, अनुरोध हेर्नुहोस्। तपाईंको विवरण तपाईं मात्र देख्नुहुन्छ।'],
    ['साइन इन कसरी गर्ने?', 'राहदानी नम्बर र HR ले दिएको ६ अंकको PIN लेखेर साइन इन थिच्नुहोस्।'],
    ['PIN बिर्सें।', 'HR वा आउटलेट म्यानेजरलाई सोध्नुहोस्। HR ले नयाँ PIN दिनुहुन्छ। PIN कसैलाई नभन्नुहोस्।'],
    ['"लक" देखियो।', 'धेरै पटक गलत PIN हाल्नुभयो। केही मिनेट पर्खनुहोस् वा HR लाई खोल्न भन्नुहोस्।'],
    ['बिदा कसरी माग्ने?', '＋ नयाँ → बिदा। प्रकार र मिति छान्नुहोस्, छोटो कारण लेख्नुहोस्, जाँचेर पठाउनुहोस्।'],
    ['मेरो अनुरोध कसले हेर्छ?', 'पहिले आउटलेट म्यानेजर, त्यसपछि HR। म्यानेजरबारे उजुरी HR र मालिकलाई मात्र जान्छ।'],
    ['रङको अर्थ के हो?', 'हरियो = ठीक। सुन्तला = चाँडै / पर्खाइ। रातो = म्याद सकियो वा अस्वीकृत। नीलो = HR लाई तपाईंको जवाफ चाहिन्छ।'],
    ['HR ले प्रश्न सोध्नुभयो।', 'अनुरोध खोल्नुहोस्, "HR लाई जवाफ चाहिन्छ" भएकोमा थिच्नुहोस्, जवाफ लेखेर पठाउनुहोस्।'],
    ['राहदानी / परमिटको म्याद सकिँदैछ।', 'कागजात हेर्नुहोस्। सुन्तला वा रातो भए ＋ नयाँ → कागजात नवीकरण, वा HR सँग कुरा गर्नुहोस्।'],
    ['PIN कसरी बदल्ने?', 'म → PIN बदल्नुहोस्। पुरानो PIN, त्यसपछि नयाँ PIN दुई पटक लेख्नुहोस्।'],
    ['भाषा कसरी बदल्ने?', 'म → भाषा (वा साइन इन स्क्रिनमा 🌐) थिचेर आफ्नो भाषा छान्नुहोस्।'],
    ['मेरो जानकारी सुरक्षित छ?', 'हो। तपाईं आफ्नो विवरण मात्र देख्नुहुन्छ। PIN गोप्य हो — कम्पनीले पनि देख्न सक्दैन।'],
  ],
  guides: [
    { title: 'तपाईंको जिम्मेवारी', steps: ['PIN गोप्य राख्नुहोस्।', 'हरेक महिना कागजात हेर्नुहोस्।', 'बिदा अगाडि नै यो एपबाट माग्नुहोस्।', 'HR ले सोधे छिटो जवाफ दिनुहोस्।'] },
    { title: 'साइन इन', steps: ['FW Worker खोल्नुहोस्।', 'राहदानी नम्बर लेख्नुहोस्।', '६ अंकको PIN लेख्नुहोस्।', 'साइन इन थिच्नुहोस्।'] },
    { title: 'कागजात हेर्नुहोस्', steps: ['🛂 कागजात थिच्नुहोस्।', 'हरेक कागजातको म्याद मिति देखिन्छ।', 'सुन्तला वा रातो: HR सँग कुरा गर्नुहोस्।'] },
    { title: 'बिदा माग्नुहोस्', steps: ['＋ नयाँ थिच्नुहोस्।', 'बिदा → प्रकार छान्नुहोस्।', 'देखि र सम्म मिति छान्नुहोस्।', 'जाँचेर पठाउनुहोस् थिच्नुहोस्।'] },
    { title: 'अनुरोध हेर्नुहोस्', steps: ['📨 अनुरोध थिच्नुहोस्।', 'अनुरोधमा थिचेर इतिहास हेर्नुहोस्।', 'नीलो: HR लाई जवाफ चाहिन्छ — त्यहीँ जवाफ दिनुहोस्।', 'पर्खाइमा रद्द गर्न सकिन्छ।'] },
    { title: 'PIN वा भाषा बदल्नुहोस्', steps: ['👤 म थिच्नुहोस्।', 'PIN बदल्नुहोस् वा भाषा थिच्नुहोस्।', 'स्क्रिनका चरणहरू पालना गर्नुहोस्।'] },
    { title: 'एप इन्स्टल गर्नुहोस्', steps: ['Android: HR ले एपको लिंक दिनुहुन्छ।', 'iPhone: App Store बाट इन्स्टल गर्नुहोस्।', 'वा Chrome मा लिंक खोल्नुहोस् → होम स्क्रिनमा थप्नुहोस्।'] },
  ],
}

const bn: WorkerHelp = {
  ui: { help: 'সাহায্য', faq: 'প্রশ্ন', howTo: 'কীভাবে', pdf: 'ছবিসহ গাইড (PDF)', pdfNeedsSignIn: 'গাইড ডাউনলোড করতে সাইন ইন করুন।', pdfMissing: 'গাইড এখনও তৈরি হয়নি। HR-কে জিজ্ঞাসা করুন।', list: 'সব' },
  faq: [
    ['FW Worker কী?', 'কোম্পানির দেওয়া আপনার নিজের অ্যাপ। কাগজপত্র দেখুন, ছুটি বা টাকা চান, অনুরোধ দেখুন। আপনার তথ্য শুধু আপনিই দেখতে পান।'],
    ['কীভাবে সাইন ইন করব?', 'পাসপোর্ট নম্বর আর HR-এর দেওয়া ৬ অঙ্কের PIN লিখে সাইন ইন চাপুন।'],
    ['PIN ভুলে গেছি।', 'HR বা আউটলেট ম্যানেজারকে বলুন। HR নতুন PIN দেবে। PIN কাউকে বলবেন না।'],
    ['"লক" দেখাচ্ছে।', 'অনেকবার ভুল PIN দিয়েছেন। কয়েক মিনিট অপেক্ষা করুন বা HR-কে খুলে দিতে বলুন।'],
    ['কীভাবে ছুটি চাইব?', '＋ নতুন → ছুটি। ধরন ও তারিখ বেছে নিন, ছোট কারণ লিখুন, দেখে পাঠান।'],
    ['আমার অনুরোধ কে দেখে?', 'প্রথমে আউটলেট ম্যানেজার, তারপর HR। ম্যানেজার নিয়ে অভিযোগ শুধু HR ও মালিকের কাছে যায়।'],
    ['রঙের মানে কী?', 'সবুজ = ঠিক। কমলা = শীঘ্রই / অপেক্ষা। লাল = মেয়াদ শেষ বা বাতিল। নীল = HR আপনার উত্তর চায়।'],
    ['HR প্রশ্ন করেছে।', 'অনুরোধ খুলুন, "HR আপনার উত্তর চায়" লেখাটিতে চাপুন, উত্তর লিখে পাঠান।'],
    ['পাসপোর্ট / পারমিটের মেয়াদ শেষ হচ্ছে।', 'কাগজ দেখুন। কমলা বা লাল হলে ＋ নতুন → কাগজ নবায়ন, বা HR-এর সাথে কথা বলুন।'],
    ['PIN কীভাবে বদলাব?', 'আমি → PIN পরিবর্তন। পুরনো PIN, তারপর নতুন PIN দুবার লিখুন।'],
    ['ভাষা কীভাবে বদলাব?', 'আমি → ভাষা (বা সাইন ইন স্ক্রিনে 🌐) চেপে আপনার ভাষা বেছে নিন।'],
    ['আমার তথ্য কি নিরাপদ?', 'হ্যাঁ। আপনি শুধু নিজের তথ্য দেখেন। PIN গোপন — কোম্পানিও দেখতে পারে না।'],
  ],
  guides: [
    { title: 'আপনার দায়িত্ব', steps: ['PIN গোপন রাখুন।', 'প্রতি মাসে কাগজ দেখুন।', 'ছুটি আগে থেকেই এই অ্যাপে চান।', 'HR জিজ্ঞাসা করলে দ্রুত উত্তর দিন।'] },
    { title: 'সাইন ইন', steps: ['FW Worker খুলুন।', 'পাসপোর্ট নম্বর লিখুন।', '৬ অঙ্কের PIN লিখুন।', 'সাইন ইন চাপুন।'] },
    { title: 'কাগজ দেখুন', steps: ['🛂 কাগজ চাপুন।', 'প্রতিটি কাগজের মেয়াদের তারিখ দেখা যায়।', 'কমলা বা লাল: HR-এর সাথে কথা বলুন।'] },
    { title: 'ছুটি চান', steps: ['＋ নতুন চাপুন।', 'ছুটি → ধরন বেছে নিন।', 'থেকে ও পর্যন্ত তারিখ বেছে নিন।', 'দেখে পাঠান চাপুন।'] },
    { title: 'অনুরোধ দেখুন', steps: ['📨 অনুরোধ চাপুন।', 'অনুরোধে চেপে ইতিহাস দেখুন।', 'নীল: HR উত্তর চায় — সেখানেই উত্তর দিন।', 'অপেক্ষার সময় বাতিল করতে পারেন।'] },
    { title: 'PIN বা ভাষা বদলান', steps: ['👤 আমি চাপুন।', 'PIN পরিবর্তন বা ভাষা চাপুন।', 'স্ক্রিনের ধাপ অনুসরণ করুন।'] },
    { title: 'অ্যাপ ইনস্টল করুন', steps: ['Android: HR অ্যাপের লিংক দেবে।', 'iPhone: App Store থেকে ইনস্টল করুন।', 'বা Chrome-এ লিংক খুলুন → হোম স্ক্রিনে যোগ করুন।'] },
  ],
}

const HELP: Partial<Record<Lang, WorkerHelp>> = { en, ta, hi, ms, ne, bn }
export const helpFor = (lang: Lang): WorkerHelp => HELP[lang] || en
export const WORKER_HELP = HELP
