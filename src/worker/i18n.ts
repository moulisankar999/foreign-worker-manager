/* FW Worker texts. Tamil first; other languages fall back to English for any missing key.
 * Machine-drafted translations — have a native speaker check before wide release. */
export const LANGS = [
  { code: 'ta', native: 'தமிழ்' }, { code: 'en', native: 'English' }, { code: 'hi', native: 'हिन्दी' }, { code: 'te', native: 'తెలుగు' },
  { code: 'ml', native: 'മലയാളം' }, { code: 'kn', native: 'ಕನ್ನಡ' }, { code: 'bn', native: 'বাংলা' }, { code: 'ne', native: 'नेपाली' },
  { code: 'ms', native: 'Melayu' }, { code: 'my', native: 'မြန်မာ' },
] as const
export type Lang = (typeof LANGS)[number]['code']

const en = { company: 'Company',
  appName: 'FW Worker', signIn: 'Sign in', passport: 'Passport number', pin: '6-digit PIN',
  wrongOrLocked: 'Wrong passport or PIN, or login locked. Ask HR if it keeps failing.', busy: 'Too many tries. Wait a few minutes.',
  offline: 'No internet connection', sessionEnded: 'Please sign in again', error: 'Something went wrong. Try again.',
  tabHome: 'Home', tabDocs: 'Papers', tabReq: 'Requests', tabNew: 'New', tabMe: 'Me',
  hello: 'Hello', workerNo: 'Worker no.', outlet: 'Outlet', job: 'Job', joined: 'Joined', nationality: 'Country',
  basicPay: 'Basic pay', loanLeft: 'Loan left', openReq: 'Open requests', nextExpiry: 'Next expiry', allValid: 'All papers valid',
  daysLeft: '{n} days left', expiredAgo: 'Expired {n} days ago', expiresToday: 'Expires today', notRecorded: 'Not recorded',
  doc_passport: 'Passport', doc_permit: 'Work permit (PLKS)', doc_visa: 'Visa', doc_fomema: 'FOMEMA medical', doc_insurance: 'Insurance',
  renewalInProgress: 'Renewal in progress',
  st_manager_review: 'With manager', st_hr: 'With HR', st_returned: 'HR needs your answer', st_approved: 'Approved', st_rejected: 'Rejected', st_completed: 'Done', st_cancelled: 'Cancelled', st_w_hrm: 'With HR Manager', st_w_hra: 'With HR Admin', st_w_gm: 'With General Manager', st_w_ceo: 'With CEO',
  noRequests: 'No requests yet', fromManager: 'Raised by manager', overdueFlag: 'Sent to HR (manager late)', private: 'Private',
  t_leave: 'Leave', t_salary_advance: 'Salary advance', t_loan: 'Loan', t_salary_increment: 'Pay increase', t_resignation: 'Resign',
  t_renewal: 'Renew papers', t_passport: 'Get my passport', t_complaint: 'Problem / complaint',
  lv_annual: 'Annual leave', lv_medical: 'Medical leave', lv_home: 'Home leave', lv_emergency: 'Emergency leave',
  step: 'Step {a} of {b}', next: 'Next', back: 'Back', send: 'Send', cancel: 'Cancel', close: 'Close', done: 'OK',
  kind: 'Type of leave', from: 'From', to: 'To', amount: 'Amount (RM)', months: 'Pay back in (months)', reason: 'Reason (short)',
  lastDay: 'Last working day', whichDoc: 'Which paper?', date: 'Date needed', topic: 'About what?',
  tp_pay: 'Salary', tp_hostel: 'Hostel', tp_work: 'Work', tp_safety: 'Safety', tp_other: 'Other',
  aboutManager: 'It is about my outlet manager (private: only HR and the boss see it)',
  sentTo: 'Sent to your outlet manager', sentHr: 'Sent to HR', confirm: 'Check and send', passportNote: 'Your passport request goes straight to HR.',
  cancelReq: 'Cancel request', answer: 'Your answer', sendAnswer: 'Send answer', reasonGiven: 'Reason', history: 'History',
  ev_worker_submit: 'You sent it', ev_submit: 'Sent', ev_mgr_approve: 'Manager approved', ev_mgr_reject: 'Manager rejected', ev_auto_escalate: 'Sent to HR',
  ev_approve: 'Approved', ev_forward: 'Moved up', ev_reject: 'Rejected', ev_return: 'HR asked a question', ev_apply: 'Done',
  ev_cancel: 'Cancelled', ev_worker_cancel: 'You cancelled', ev_resubmit: 'Sent again', ev_worker_resubmit: 'You answered',
  changePin: 'Change PIN', currentPin: 'Current PIN', newPin: 'New PIN', repeatPin: 'New PIN again', pinChanged: 'PIN changed',
  pinMismatch: 'The two PINs are not the same', weakPin: 'PIN too easy (no 111111 / 123456)', wrongPin: 'Current PIN is wrong', samePin: 'New PIN is the same as the old one',
  language: 'Language', signOut: 'Sign out', refresh: 'Refresh', pinHelp: 'Forgot PIN? Ask HR for a new one.', sending: 'Sending…', sent: 'Sent ✓',
  confirmCancel: 'Cancel this request?', confirmResign: 'Are you sure you want to resign?', yes: 'Yes', no: 'No', install: 'Add to home screen',
  t_document_copy: 'Document copy', updated: 'A request was updated', tooMany: 'Too many open requests. Wait for the answers first.',
  dailyLimit: 'Daily limit reached. Try again tomorrow.', badDates: 'Choose valid dates', badAmount: 'Enter a valid amount',
}
export type Key = keyof typeof en
type Dict = Partial<Record<Key, string>>

const ta: Dict = { company: 'நிறுவனம்',
  appName: 'FW Worker', signIn: 'உள்நுழை', passport: 'பாஸ்போர்ட் எண்', pin: '6 இலக்க PIN',
  wrongOrLocked: 'பாஸ்போர்ட் அல்லது PIN தவறு, அல்லது உள்நுழைவு பூட்டப்பட்டது. தொடர்ந்தால் HR-ஐ கேளுங்கள்.', busy: 'அதிக முயற்சிகள். சில நிமிடம் காத்திருங்கள்.',
  offline: 'இணைய இணைப்பு இல்லை', sessionEnded: 'மீண்டும் உள்நுழையுங்கள்', error: 'ஏதோ பிழை. மீண்டும் முயலுங்கள்.',
  tabHome: 'முகப்பு', tabDocs: 'ஆவணம்', tabReq: 'கோரிக்கை', tabNew: 'புதியது', tabMe: 'நான்',
  hello: 'வணக்கம்', workerNo: 'தொழிலாளர் எண்', outlet: 'கடை', job: 'வேலை', joined: 'சேர்ந்தது', nationality: 'நாடு',
  basicPay: 'அடிப்படை சம்பளம்', loanLeft: 'மீதி கடன்', openReq: 'திறந்த கோரிக்கைகள்', nextExpiry: 'அடுத்த காலாவதி', allValid: 'எல்லா ஆவணங்களும் சரி',
  daysLeft: 'இன்னும் {n} நாள்', expiredAgo: '{n} நாள் முன் காலாவதி', expiresToday: 'இன்று காலாவதி', notRecorded: 'பதிவு இல்லை',
  doc_passport: 'பாஸ்போர்ட்', doc_permit: 'வேலை அனுமதி (PLKS)', doc_visa: 'விசா', doc_fomema: 'FOMEMA மருத்துவம்', doc_insurance: 'காப்பீடு',
  renewalInProgress: 'புதுப்பித்தல் நடக்கிறது',
  st_manager_review: 'மேலாளரிடம்', st_hr: 'HR-இடம்', st_returned: 'HR உங்கள் பதிலை கேட்கிறது', st_approved: 'ஒப்புதல்', st_rejected: 'நிராகரிப்பு', st_completed: 'முடிந்தது', st_cancelled: 'ரத்து', st_w_hrm: 'HR மேலாளரிடம்', st_w_hra: 'HR நிர்வாகியிடம்', st_w_gm: 'பொது மேலாளரிடம்', st_w_ceo: 'CEO-இடம்',
  noRequests: 'இன்னும் கோரிக்கை இல்லை', fromManager: 'மேலாளர் அனுப்பியது', overdueFlag: 'HR-க்கு சென்றது (மேலாளர் தாமதம்)', private: 'ரகசியம்',
  t_leave: 'விடுப்பு', t_salary_advance: 'சம்பள முன்பணம்', t_loan: 'கடன்', t_salary_increment: 'சம்பள உயர்வு', t_resignation: 'ராஜினாமா',
  t_renewal: 'ஆவண புதுப்பிப்பு', t_passport: 'என் பாஸ்போர்ட் வேண்டும்', t_complaint: 'பிரச்சனை / புகார்',
  lv_annual: 'ஆண்டு விடுப்பு', lv_medical: 'மருத்துவ விடுப்பு', lv_home: 'ஊர் விடுப்பு', lv_emergency: 'அவசர விடுப்பு',
  step: 'படி {a} / {b}', next: 'அடுத்து', back: 'பின்', send: 'அனுப்பு', cancel: 'ரத்து', close: 'மூடு', done: 'சரி',
  kind: 'விடுப்பு வகை', from: 'முதல்', to: 'வரை', amount: 'தொகை (RM)', months: 'திருப்பி செலுத்த (மாதம்)', reason: 'காரணம் (சுருக்கமாக)',
  lastDay: 'கடைசி வேலை நாள்', whichDoc: 'எந்த ஆவணம்?', date: 'தேவைப்படும் தேதி', topic: 'எதைப் பற்றி?',
  tp_pay: 'சம்பளம்', tp_hostel: 'விடுதி', tp_work: 'வேலை', tp_safety: 'பாதுகாப்பு', tp_other: 'மற்றவை',
  aboutManager: 'இது என் கடை மேலாளர் பற்றியது (ரகசியம்: HR, முதலாளி மட்டும் பார்ப்பார்கள்)',
  sentTo: 'உங்கள் கடை மேலாளருக்கு அனுப்பப்பட்டது', sentHr: 'HR-க்கு அனுப்பப்பட்டது', confirm: 'சரிபார்த்து அனுப்பு', passportNote: 'பாஸ்போர்ட் கோரிக்கை நேராக HR-க்கு செல்லும்.',
  cancelReq: 'கோரிக்கையை ரத்து செய்', answer: 'உங்கள் பதில்', sendAnswer: 'பதில் அனுப்பு', reasonGiven: 'காரணம்', history: 'வரலாறு',
  ev_worker_submit: 'நீங்கள் அனுப்பினீர்கள்', ev_submit: 'அனுப்பப்பட்டது', ev_mgr_approve: 'மேலாளர் ஒப்புதல்', ev_mgr_reject: 'மேலாளர் நிராகரிப்பு', ev_auto_escalate: 'HR-க்கு சென்றது',
  ev_approve: 'ஒப்புதல்', ev_forward: 'மேலே அனுப்பப்பட்டது', ev_reject: 'நிராகரிப்பு', ev_return: 'HR கேள்வி கேட்டது', ev_apply: 'முடிந்தது',
  ev_cancel: 'ரத்து', ev_worker_cancel: 'நீங்கள் ரத்து செய்தீர்கள்', ev_resubmit: 'மீண்டும் அனுப்பப்பட்டது', ev_worker_resubmit: 'நீங்கள் பதில் அளித்தீர்கள்',
  changePin: 'PIN மாற்று', currentPin: 'தற்போதைய PIN', newPin: 'புதிய PIN', repeatPin: 'புதிய PIN மீண்டும்', pinChanged: 'PIN மாற்றப்பட்டது',
  pinMismatch: 'இரண்டு PIN-களும் ஒன்றல்ல', weakPin: 'PIN மிக எளிது (111111 / 123456 வேண்டாம்)', wrongPin: 'தற்போதைய PIN தவறு', samePin: 'புதிய PIN பழையது போலவே உள்ளது',
  language: 'மொழி', signOut: 'வெளியேறு', refresh: 'புதுப்பி', pinHelp: 'PIN மறந்தீர்களா? HR-இடம் புதியது கேளுங்கள்.', sending: 'அனுப்புகிறது…', sent: 'அனுப்பப்பட்டது ✓',
  confirmCancel: 'இந்த கோரிக்கையை ரத்து செய்யவா?', confirmResign: 'நிச்சயமாக ராஜினாமா செய்யவா?', yes: 'ஆம்', no: 'இல்லை', install: 'முகப்புத் திரையில் சேர்',
  t_document_copy: 'ஆவண நகல்', updated: 'ஒரு கோரிக்கை புதுப்பிக்கப்பட்டது', tooMany: 'திறந்த கோரிக்கைகள் அதிகம். பதிலுக்கு காத்திருங்கள்.',
  dailyLimit: 'இன்றைய வரம்பு முடிந்தது. நாளை முயலுங்கள்.', badDates: 'சரியான தேதிகளை தேர்வு செய்யுங்கள்', badAmount: 'சரியான தொகையை உள்ளிடுங்கள்',
}
const hi: Dict = { company: 'कंपनी',
  signIn: 'साइन इन', passport: 'पासपोर्ट नंबर', pin: '6 अंकों का PIN', wrongOrLocked: 'पासपोर्ट या PIN गलत है, या लॉगिन बंद है। बार-बार हो तो HR से पूछें।', busy: 'बहुत कोशिशें। कुछ मिनट रुकें।',
  offline: 'इंटरनेट नहीं है', sessionEnded: 'फिर से साइन इन करें', error: 'कुछ गलत हुआ। फिर कोशिश करें।',
  tabHome: 'होम', tabDocs: 'कागज़', tabReq: 'अनुरोध', tabNew: 'नया', tabMe: 'मैं', hello: 'नमस्ते', workerNo: 'कर्मचारी नं.', outlet: 'आउटलेट', job: 'काम', joined: 'जॉइन', nationality: 'देश',
  basicPay: 'मूल वेतन', loanLeft: 'बाकी कर्ज़', openReq: 'खुले अनुरोध', nextExpiry: 'अगली समाप्ति', allValid: 'सभी कागज़ वैध', daysLeft: '{n} दिन बाकी', expiredAgo: '{n} दिन पहले समाप्त', expiresToday: 'आज समाप्त', notRecorded: 'दर्ज नहीं',
  doc_passport: 'पासपोर्ट', doc_permit: 'वर्क परमिट (PLKS)', doc_visa: 'वीज़ा', doc_fomema: 'FOMEMA मेडिकल', doc_insurance: 'बीमा', renewalInProgress: 'नवीनीकरण जारी',
  st_manager_review: 'मैनेजर के पास', st_hr: 'HR के पास', st_returned: 'HR को आपका जवाब चाहिए', st_approved: 'मंज़ूर', st_rejected: 'नामंज़ूर', st_completed: 'पूरा', st_cancelled: 'रद्द', st_w_hrm: 'HR मैनेजर के पास', st_w_hra: 'HR एडमिन के पास', st_w_gm: 'जनरल मैनेजर के पास', st_w_ceo: 'CEO के पास',
  noRequests: 'अभी कोई अनुरोध नहीं', fromManager: 'मैनेजर ने भेजा', overdueFlag: 'HR को गया (मैनेजर देर)', private: 'गोपनीय',
  t_leave: 'छुट्टी', t_salary_advance: 'वेतन एडवांस', t_loan: 'कर्ज़', t_salary_increment: 'वेतन वृद्धि', t_resignation: 'इस्तीफ़ा', t_renewal: 'कागज़ नवीनीकरण', t_passport: 'मेरा पासपोर्ट', t_complaint: 'समस्या / शिकायत',
  lv_annual: 'वार्षिक छुट्टी', lv_medical: 'मेडिकल छुट्टी', lv_home: 'घर की छुट्टी', lv_emergency: 'आपात छुट्टी',
  step: 'चरण {a} / {b}', next: 'आगे', back: 'पीछे', send: 'भेजें', cancel: 'रद्द', close: 'बंद', done: 'ठीक', kind: 'छुट्टी का प्रकार', from: 'से', to: 'तक', amount: 'राशि (RM)', months: 'वापसी (महीने)', reason: 'कारण (छोटा)',
  lastDay: 'आखिरी काम का दिन', whichDoc: 'कौन सा कागज़?', date: 'तारीख', topic: 'किस बारे में?', tp_pay: 'वेतन', tp_hostel: 'हॉस्टल', tp_work: 'काम', tp_safety: 'सुरक्षा', tp_other: 'अन्य',
  aboutManager: 'यह मेरे आउटलेट मैनेजर के बारे में है (गोपनीय: केवल HR और मालिक देखेंगे)', sentTo: 'आपके आउटलेट मैनेजर को भेजा', sentHr: 'HR को भेजा', confirm: 'जाँचें और भेजें', passportNote: 'पासपोर्ट अनुरोध सीधे HR को जाता है।',
  cancelReq: 'अनुरोध रद्द करें', answer: 'आपका जवाब', sendAnswer: 'जवाब भेजें', reasonGiven: 'कारण', history: 'इतिहास',
  changePin: 'PIN बदलें', currentPin: 'मौजूदा PIN', newPin: 'नया PIN', repeatPin: 'नया PIN दोबारा', pinChanged: 'PIN बदल गया', pinMismatch: 'दोनों PIN अलग हैं', weakPin: 'PIN बहुत आसान', wrongPin: 'मौजूदा PIN गलत', samePin: 'नया PIN पुराने जैसा है',
  language: 'भाषा', signOut: 'साइन आउट', refresh: 'रीफ़्रेश', pinHelp: 'PIN भूल गए? HR से नया लें।', sending: 'भेज रहे हैं…', sent: 'भेजा ✓', confirmCancel: 'यह अनुरोध रद्द करें?', confirmResign: 'क्या आप सच में इस्तीफ़ा देना चाहते हैं?', yes: 'हाँ', no: 'नहीं',
}
const ms: Dict = { company: 'Syarikat',
  signIn: 'Log masuk', passport: 'Nombor pasport', pin: 'PIN 6 digit', wrongOrLocked: 'Pasport atau PIN salah, atau log masuk dikunci. Tanya HR jika berterusan.', busy: 'Terlalu banyak cubaan. Tunggu beberapa minit.',
  offline: 'Tiada internet', sessionEnded: 'Sila log masuk semula', error: 'Ada masalah. Cuba lagi.',
  tabHome: 'Utama', tabDocs: 'Dokumen', tabReq: 'Permohonan', tabNew: 'Baru', tabMe: 'Saya', hello: 'Hai', workerNo: 'No. pekerja', outlet: 'Cawangan', job: 'Kerja', joined: 'Mula kerja', nationality: 'Negara',
  basicPay: 'Gaji pokok', loanLeft: 'Baki pinjaman', openReq: 'Permohonan terbuka', nextExpiry: 'Tamat seterusnya', allValid: 'Semua dokumen sah', daysLeft: '{n} hari lagi', expiredAgo: 'Tamat {n} hari lalu', expiresToday: 'Tamat hari ini', notRecorded: 'Tiada rekod',
  doc_passport: 'Pasport', doc_permit: 'Permit kerja (PLKS)', doc_visa: 'Visa', doc_fomema: 'Perubatan FOMEMA', doc_insurance: 'Insurans', renewalInProgress: 'Pembaharuan sedang diproses',
  st_manager_review: 'Dengan pengurus', st_hr: 'Dengan HR', st_returned: 'HR perlukan jawapan', st_approved: 'Diluluskan', st_rejected: 'Ditolak', st_completed: 'Selesai', st_cancelled: 'Dibatalkan', st_w_hrm: 'Dengan Pengurus HR', st_w_hra: 'Dengan Admin HR', st_w_gm: 'Dengan Pengurus Besar', st_w_ceo: 'Dengan CEO',
  noRequests: 'Tiada permohonan', fromManager: 'Dibuat oleh pengurus', overdueFlag: 'Dihantar ke HR (pengurus lewat)', private: 'Sulit',
  t_leave: 'Cuti', t_salary_advance: 'Pendahuluan gaji', t_loan: 'Pinjaman', t_salary_increment: 'Kenaikan gaji', t_resignation: 'Berhenti kerja', t_renewal: 'Baharui dokumen', t_passport: 'Ambil pasport saya', t_complaint: 'Masalah / aduan',
  lv_annual: 'Cuti tahunan', lv_medical: 'Cuti sakit', lv_home: 'Cuti balik kampung', lv_emergency: 'Cuti kecemasan',
  step: 'Langkah {a} / {b}', next: 'Seterusnya', back: 'Kembali', send: 'Hantar', cancel: 'Batal', close: 'Tutup', done: 'OK', kind: 'Jenis cuti', from: 'Dari', to: 'Hingga', amount: 'Jumlah (RM)', months: 'Bayar balik (bulan)', reason: 'Sebab (ringkas)',
  lastDay: 'Hari kerja terakhir', whichDoc: 'Dokumen mana?', date: 'Tarikh diperlukan', topic: 'Tentang apa?', tp_pay: 'Gaji', tp_hostel: 'Asrama', tp_work: 'Kerja', tp_safety: 'Keselamatan', tp_other: 'Lain-lain',
  aboutManager: 'Ini tentang pengurus cawangan saya (sulit: hanya HR dan majikan)', sentTo: 'Dihantar kepada pengurus cawangan', sentHr: 'Dihantar kepada HR', confirm: 'Semak dan hantar', passportNote: 'Permohonan pasport terus ke HR.',
  cancelReq: 'Batal permohonan', answer: 'Jawapan anda', sendAnswer: 'Hantar jawapan', reasonGiven: 'Sebab', history: 'Sejarah',
  changePin: 'Tukar PIN', currentPin: 'PIN semasa', newPin: 'PIN baru', repeatPin: 'PIN baru sekali lagi', pinChanged: 'PIN ditukar', pinMismatch: 'Dua PIN tidak sama', weakPin: 'PIN terlalu mudah', wrongPin: 'PIN semasa salah', samePin: 'PIN baru sama dengan lama',
  language: 'Bahasa', signOut: 'Log keluar', refresh: 'Muat semula', pinHelp: 'Lupa PIN? Minta HR yang baru.', sending: 'Menghantar…', sent: 'Dihantar ✓', confirmCancel: 'Batal permohonan ini?', confirmResign: 'Pasti mahu berhenti kerja?', yes: 'Ya', no: 'Tidak',
}
// shorter sets: the most visible words; everything else falls back to English
const te: Dict = { company: 'కంపెనీ', signIn: 'సైన్ ఇన్', passport: 'పాస్‌పోర్ట్ నంబర్', pin: '6 అంకెల PIN', tabHome: 'హోమ్', tabDocs: 'పత్రాలు', tabReq: 'అభ్యర్థనలు', tabNew: 'కొత్తది', tabMe: 'నేను', hello: 'నమస్తే',
  basicPay: 'ప్రాథమిక జీతం', loanLeft: 'మిగిలిన అప్పు', openReq: 'తెరిచిన అభ్యర్థనలు', nextExpiry: 'తదుపరి గడువు', daysLeft: '{n} రోజులు మిగిలాయి', expiredAgo: '{n} రోజుల క్రితం గడువు ముగిసింది', notRecorded: 'నమోదు లేదు',
  doc_passport: 'పాస్‌పోర్ట్', doc_permit: 'వర్క్ పర్మిట్ (PLKS)', doc_visa: 'వీసా', doc_fomema: 'FOMEMA వైద్యం', doc_insurance: 'బీమా',
  st_manager_review: 'మేనేజర్ వద్ద', st_hr: 'HR వద్ద', st_returned: 'HR మీ జవాబు కోరుతోంది', st_approved: 'ఆమోదం', st_rejected: 'తిరస్కరణ', st_completed: 'పూర్తి', st_cancelled: 'రద్దు', st_w_hrm: 'HR మేనేజర్ వద్ద', st_w_hra: 'HR అడ్మిన్ వద్ద', st_w_gm: 'జనరల్ మేనేజర్ వద్ద', st_w_ceo: 'CEO వద్ద',
  t_leave: 'సెలవు', t_salary_advance: 'జీతం అడ్వాన్స్', t_loan: 'అప్పు', t_salary_increment: 'జీతం పెంపు', t_resignation: 'రాజీనామా', t_renewal: 'పత్రాల పునరుద్ధరణ', t_passport: 'నా పాస్‌పోర్ట్', t_complaint: 'సమస్య / ఫిర్యాదు',
  next: 'తదుపరి', back: 'వెనుకకు', send: 'పంపు', cancel: 'రద్దు', close: 'మూసివేయి', reason: 'కారణం', from: 'నుండి', to: 'వరకు', amount: 'మొత్తం (RM)', changePin: 'PIN మార్చు', language: 'భాష', signOut: 'సైన్ అవుట్', sent: 'పంపబడింది ✓',
  wrongOrLocked: 'పాస్‌పోర్ట్ లేదా PIN తప్పు, లేదా లాగిన్ లాక్ అయింది. HR ని అడగండి.' }
const ml: Dict = { company: 'കമ്പനി', signIn: 'സൈൻ ഇൻ', passport: 'പാസ്‌പോർട്ട് നമ്പർ', pin: '6 അക്ക PIN', tabHome: 'ഹോം', tabDocs: 'രേഖകൾ', tabReq: 'അപേക്ഷകൾ', tabNew: 'പുതിയത്', tabMe: 'ഞാൻ', hello: 'നമസ്കാരം',
  basicPay: 'അടിസ്ഥാന ശമ്പളം', loanLeft: 'ബാക്കി വായ്പ', openReq: 'തുറന്ന അപേക്ഷകൾ', nextExpiry: 'അടുത്ത കാലാവധി', daysLeft: '{n} ദിവസം ബാക്കി', expiredAgo: '{n} ദിവസം മുമ്പ് കാലാവധി കഴിഞ്ഞു', notRecorded: 'രേഖപ്പെടുത്തിയിട്ടില്ല',
  doc_passport: 'പാസ്‌പോർട്ട്', doc_permit: 'വർക്ക് പെർമിറ്റ് (PLKS)', doc_visa: 'വിസ', doc_fomema: 'FOMEMA മെഡിക്കൽ', doc_insurance: 'ഇൻഷുറൻസ്',
  st_manager_review: 'മാനേജരുടെ പക്കൽ', st_hr: 'HR-ന്റെ പക്കൽ', st_returned: 'HR നിങ്ങളുടെ മറുപടി ചോദിക്കുന്നു', st_approved: 'അംഗീകരിച്ചു', st_rejected: 'നിരസിച്ചു', st_completed: 'പൂർത്തിയായി', st_cancelled: 'റദ്ദാക്കി', st_w_hrm: 'HR മാനേജരുടെ പക്കൽ', st_w_hra: 'HR അഡ്മിന്റെ പക്കൽ', st_w_gm: 'ജനറൽ മാനേജരുടെ പക്കൽ', st_w_ceo: 'CEO-യുടെ പക്കൽ',
  t_leave: 'അവധി', t_salary_advance: 'ശമ്പള അഡ്വാൻസ്', t_loan: 'വായ്പ', t_salary_increment: 'ശമ്പള വർദ്ധന', t_resignation: 'രാജി', t_renewal: 'രേഖ പുതുക്കൽ', t_passport: 'എന്റെ പാസ്‌പോർട്ട്', t_complaint: 'പ്രശ്നം / പരാതി',
  next: 'അടുത്തത്', back: 'പിന്നോട്ട്', send: 'അയയ്ക്കുക', cancel: 'റദ്ദാക്കുക', close: 'അടയ്ക്കുക', reason: 'കാരണം', from: 'മുതൽ', to: 'വരെ', amount: 'തുക (RM)', changePin: 'PIN മാറ്റുക', language: 'ഭാഷ', signOut: 'സൈൻ ഔട്ട്', sent: 'അയച്ചു ✓',
  wrongOrLocked: 'പാസ്‌പോർട്ട് അല്ലെങ്കിൽ PIN തെറ്റ്, അല്ലെങ്കിൽ ലോഗിൻ ലോക്ക്. HR-നോട് ചോദിക്കുക.' }
const kn: Dict = { company: 'ಕಂಪನಿ', signIn: 'ಸೈನ್ ಇನ್', passport: 'ಪಾಸ್‌ಪೋರ್ಟ್ ಸಂಖ್ಯೆ', pin: '6 ಅಂಕಿಯ PIN', tabHome: 'ಮುಖಪುಟ', tabDocs: 'ದಾಖಲೆ', tabReq: 'ವಿನಂತಿ', tabNew: 'ಹೊಸದು', tabMe: 'ನಾನು', hello: 'ನಮಸ್ಕಾರ',
  basicPay: 'ಮೂಲ ವೇತನ', loanLeft: 'ಉಳಿದ ಸಾಲ', openReq: 'ತೆರೆದ ವಿನಂತಿಗಳು', nextExpiry: 'ಮುಂದಿನ ಅವಧಿ ಮುಕ್ತಾಯ', daysLeft: '{n} ದಿನ ಉಳಿದಿದೆ', expiredAgo: '{n} ದಿನಗಳ ಹಿಂದೆ ಮುಗಿದಿದೆ', notRecorded: 'ದಾಖಲಾಗಿಲ್ಲ',
  doc_passport: 'ಪಾಸ್‌ಪೋರ್ಟ್', doc_permit: 'ಕೆಲಸದ ಪರವಾನಗಿ (PLKS)', doc_visa: 'ವೀಸಾ', doc_fomema: 'FOMEMA ವೈದ್ಯಕೀಯ', doc_insurance: 'ವಿಮೆ',
  st_manager_review: 'ಮ್ಯಾನೇಜರ್ ಬಳಿ', st_hr: 'HR ಬಳಿ', st_returned: 'HR ನಿಮ್ಮ ಉತ್ತರ ಕೇಳುತ್ತಿದೆ', st_approved: 'ಅನುಮೋದನೆ', st_rejected: 'ತಿರಸ್ಕೃತ', st_completed: 'ಮುಗಿದಿದೆ', st_cancelled: 'ರದ್ದು', st_w_hrm: 'HR ಮ್ಯಾನೇಜರ್ ಬಳಿ', st_w_hra: 'HR ಅಡ್ಮಿನ್ ಬಳಿ', st_w_gm: 'ಜನರಲ್ ಮ್ಯಾನೇಜರ್ ಬಳಿ', st_w_ceo: 'CEO ಬಳಿ',
  t_leave: 'ರಜೆ', t_salary_advance: 'ಸಂಬಳ ಮುಂಗಡ', t_loan: 'ಸಾಲ', t_salary_increment: 'ಸಂಬಳ ಏರಿಕೆ', t_resignation: 'ರಾಜೀನಾಮೆ', t_renewal: 'ದಾಖಲೆ ನವೀಕರಣ', t_passport: 'ನನ್ನ ಪಾಸ್‌ಪೋರ್ಟ್', t_complaint: 'ಸಮಸ್ಯೆ / ದೂರು',
  next: 'ಮುಂದೆ', back: 'ಹಿಂದೆ', send: 'ಕಳುಹಿಸು', cancel: 'ರದ್ದು', close: 'ಮುಚ್ಚು', reason: 'ಕಾರಣ', from: 'ಇಂದ', to: 'ವರೆಗೆ', amount: 'ಮೊತ್ತ (RM)', changePin: 'PIN ಬದಲಿಸಿ', language: 'ಭಾಷೆ', signOut: 'ಸೈನ್ ಔಟ್', sent: 'ಕಳುಹಿಸಲಾಗಿದೆ ✓',
  wrongOrLocked: 'ಪಾಸ್‌ಪೋರ್ಟ್ ಅಥವಾ PIN ತಪ್ಪು, ಅಥವಾ ಲಾಗಿನ್ ಲಾಕ್. HR ಕೇಳಿ.' }
const bn: Dict = { company: 'কোম্পানি', signIn: 'সাইন ইন', passport: 'পাসপোর্ট নম্বর', pin: '৬ অঙ্কের PIN', tabHome: 'হোম', tabDocs: 'কাগজ', tabReq: 'অনুরোধ', tabNew: 'নতুন', tabMe: 'আমি', hello: 'নমস্কার',
  basicPay: 'মূল বেতন', loanLeft: 'বাকি ঋণ', openReq: 'খোলা অনুরোধ', nextExpiry: 'পরবর্তী মেয়াদ শেষ', daysLeft: '{n} দিন বাকি', expiredAgo: '{n} দিন আগে মেয়াদ শেষ', notRecorded: 'রেকর্ড নেই',
  doc_passport: 'পাসপোর্ট', doc_permit: 'ওয়ার্ক পারমিট (PLKS)', doc_visa: 'ভিসা', doc_fomema: 'FOMEMA মেডিকেল', doc_insurance: 'বিমা',
  st_manager_review: 'ম্যানেজারের কাছে', st_hr: 'HR-এর কাছে', st_returned: 'HR আপনার উত্তর চায়', st_approved: 'অনুমোদিত', st_rejected: 'প্রত্যাখ্যাত', st_completed: 'সম্পন্ন', st_cancelled: 'বাতিল', st_w_hrm: 'HR ম্যানেজারের কাছে', st_w_hra: 'HR অ্যাডমিনের কাছে', st_w_gm: 'জেনারেল ম্যানেজারের কাছে', st_w_ceo: 'CEO-র কাছে',
  t_leave: 'ছুটি', t_salary_advance: 'বেতন অগ্রিম', t_loan: 'ঋণ', t_salary_increment: 'বেতন বৃদ্ধি', t_resignation: 'পদত্যাগ', t_renewal: 'কাগজ নবায়ন', t_passport: 'আমার পাসপোর্ট', t_complaint: 'সমস্যা / অভিযোগ',
  next: 'পরবর্তী', back: 'পিছনে', send: 'পাঠান', cancel: 'বাতিল', close: 'বন্ধ', reason: 'কারণ', from: 'থেকে', to: 'পর্যন্ত', amount: 'পরিমাণ (RM)', changePin: 'PIN পরিবর্তন', language: 'ভাষা', signOut: 'সাইন আউট', sent: 'পাঠানো হয়েছে ✓',
  wrongOrLocked: 'পাসপোর্ট বা PIN ভুল, অথবা লগইন লক। HR-কে জিজ্ঞাসা করুন।' }
const ne: Dict = { company: 'कम्पनी', signIn: 'साइन इन', passport: 'राहदानी नम्बर', pin: '६ अंकको PIN', tabHome: 'गृह', tabDocs: 'कागजात', tabReq: 'अनुरोध', tabNew: 'नयाँ', tabMe: 'म', hello: 'नमस्ते',
  basicPay: 'आधारभूत तलब', loanLeft: 'बाँकी ऋण', openReq: 'खुला अनुरोध', nextExpiry: 'अर्को म्याद', daysLeft: '{n} दिन बाँकी', expiredAgo: '{n} दिन अघि म्याद सकियो', notRecorded: 'रेकर्ड छैन',
  doc_passport: 'राहदानी', doc_permit: 'वर्क परमिट (PLKS)', doc_visa: 'भिसा', doc_fomema: 'FOMEMA मेडिकल', doc_insurance: 'बीमा',
  st_manager_review: 'म्यानेजरसँग', st_hr: 'HR सँग', st_returned: 'HR लाई तपाईंको जवाफ चाहियो', st_approved: 'स्वीकृत', st_rejected: 'अस्वीकृत', st_completed: 'सम्पन्न', st_cancelled: 'रद्द', st_w_hrm: 'HR म्यानेजरसँग', st_w_hra: 'HR एडमिनसँग', st_w_gm: 'जनरल म्यानेजरसँग', st_w_ceo: 'CEO सँग',
  t_leave: 'बिदा', t_salary_advance: 'तलब पेस्की', t_loan: 'ऋण', t_salary_increment: 'तलब वृद्धि', t_resignation: 'राजीनामा', t_renewal: 'कागजात नवीकरण', t_passport: 'मेरो राहदानी', t_complaint: 'समस्या / गुनासो',
  next: 'अर्को', back: 'पछाडि', send: 'पठाउनुहोस्', cancel: 'रद्द', close: 'बन्द', reason: 'कारण', from: 'देखि', to: 'सम्म', amount: 'रकम (RM)', changePin: 'PIN बदल्नुहोस्', language: 'भाषा', signOut: 'साइन आउट', sent: 'पठाइयो ✓',
  wrongOrLocked: 'राहदानी वा PIN गलत, वा लगइन बन्द। HR लाई सोध्नुहोस्।' }
const my: Dict = { company: 'ကုမ္ပဏီ', signIn: 'ဝင်ရန်', passport: 'နိုင်ငံကူးလက်မှတ် နံပါတ်', pin: 'ဂဏန်း ၆ လုံး PIN', tabHome: 'ပင်မ', tabDocs: 'စာရွက်', tabReq: 'တောင်းဆို', tabNew: 'အသစ်', tabMe: 'ကျွန်ုပ်', hello: 'မင်္ဂလာပါ',
  basicPay: 'အခြေခံလစာ', loanLeft: 'ကျန်ချေး', openReq: 'ဖွင့်ထားသော တောင်းဆိုမှု', nextExpiry: 'နောက်သက်တမ်းကုန်', daysLeft: '{n} ရက် ကျန်', expiredAgo: '{n} ရက်က သက်တမ်းကုန်', notRecorded: 'မှတ်တမ်းမရှိ',
  doc_passport: 'နိုင်ငံကူးလက်မှတ်', doc_permit: 'အလုပ်ပါမစ် (PLKS)', doc_visa: 'ဗီဇာ', doc_fomema: 'FOMEMA ဆေးစစ်', doc_insurance: 'အာမခံ',
  st_manager_review: 'မန်နေဂျာထံ', st_hr: 'HR ထံ', st_returned: 'HR က အဖြေလိုသည်', st_approved: 'ခွင့်ပြု', st_rejected: 'ငြင်းပယ်', st_completed: 'ပြီး', st_cancelled: 'ပယ်ဖျက်', st_w_hrm: 'HR မန်နေဂျာထံ', st_w_hra: 'HR အက်ဒမင်ထံ', st_w_gm: 'အထွေထွေမန်နေဂျာထံ', st_w_ceo: 'CEO ထံ',
  t_leave: 'ခွင့်', t_salary_advance: 'လစာကြိုထုတ်', t_loan: 'ချေးငွေ', t_salary_increment: 'လစာတိုး', t_resignation: 'နုတ်ထွက်', t_renewal: 'စာရွက်သက်တမ်းတိုး', t_passport: 'ကျွန်ုပ်၏ပတ်စ်ပို့', t_complaint: 'ပြဿနာ / တိုင်ကြား',
  next: 'ရှေ့', back: 'နောက်', send: 'ပို့', cancel: 'ပယ်ဖျက်', close: 'ပိတ်', reason: 'အကြောင်း', from: 'မှ', to: 'ထိ', amount: 'ပမာဏ (RM)', changePin: 'PIN ပြောင်း', language: 'ဘာသာ', signOut: 'ထွက်ရန်', sent: 'ပို့ပြီး ✓',
  wrongOrLocked: 'ပတ်စ်ပို့ သို့ PIN မှား၊ သို့ ဝင်ခွင့်ပိတ်။ HR ကိုမေးပါ။' }

const DICTS: Record<Lang, Dict> = { ta, en, hi, te, ml, kn, bn, ne, ms, my }
export function translator(lang: Lang) {
  const d = DICTS[lang] || en
  return (k: Key, vars?: Record<string, string | number>) => {
    let s = d[k] ?? en[k] ?? k
    if (vars) for (const [a, b] of Object.entries(vars)) s = s.replace(`{${a}}`, String(b))
    return s
  }
}
export type T = ReturnType<typeof translator>
/** first language: the worker's own (if we have it), else Tamil */
export function initialLang(workerLang?: string | null): Lang {
  const saved = localStorage.getItem('fww-lang') as Lang | null
  if (saved && saved in DICTS) return saved
  if (workerLang && workerLang in DICTS) return workerLang as Lang
  return 'ta'
}
