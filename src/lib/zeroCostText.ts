/* Zero-cost recruitment declaration — the text in each language. English is the reference text.
 * Field labels (name, passport no., signatures, date, …) reuse the consent-form translations.
 * Translations were prepared carefully but have NOT yet been checked by native speakers: the CEO / HR Admin can
 * correct them in Compliance → Rules → Zero-cost declaration translations (saved as app_config 'zerocost_translations'). */
import { CONSENT_EN, consentLanguage, type ConsentText, type ConsentTranslationsConfig } from './consentText'

export const ZC_KEYS = ['title', 'intro', 'z1', 'z2', 'z3', 'z4', 'z5', 'paid', 'reference'] as const
export type ZcKey = (typeof ZC_KEYS)[number]
export type ZcText = Record<ZcKey, string>
export interface ZcOverride { text: Partial<ZcText>; checked?: boolean; checkedBy?: string; updatedAt?: string; updatedBy?: string }
export interface ZcTranslationsConfig { items: Record<string, ZcOverride> }

export const ZC_KEY_LABEL: Record<ZcKey, string> = {
  title: 'Form title', intro: 'Opening statement', z1: '1. No fee paid', z2: '2. Anything paid is written below', z3: '3. Company pays the costs',
  z4: '4. Not forced', z5: '5. Grievance channel', paid: 'Money paid (box label)', reference: 'Reference line',
}

export const ZC_EN: ZcText = {
  title: 'ZERO-COST RECRUITMENT DECLARATION',
  intro: 'I, the worker named above, declare that:',
  z1: 'I did not pay any recruitment fee, deposit or other charge to the company, its staff or its agents to get this job.',
  z2: 'If I paid money to any agent or other person, in my home country or in Malaysia, for this job, I have written it below so the company can look into it.',
  z3: 'The company pays the levy, work permit, visa and recruitment costs. They are not deducted from my wages.',
  z4: 'Nobody forced or threatened me to sign this form. Signing it does not stop me from reporting a problem later.',
  z5: 'I can report any fee or unfair treatment through the company grievance channel, and I may do so without giving my name.',
  paid: 'Money paid for this job (amount, to whom, when) — write "None" if nothing:',
  reference: 'This declaration follows the Employer Pays Principle: workers should not pay for their own recruitment.',
}

export const ZC_TR: Record<string, ZcText> = {
  ms: {
    title: 'AKUAN PENGAMBILAN TANPA KOS',
    intro: 'Saya, pekerja yang dinamakan di atas, mengaku bahawa:',
    z1: 'Saya tidak membayar sebarang yuran pengambilan, deposit atau caj lain kepada syarikat, kakitangannya atau ejennya untuk mendapatkan pekerjaan ini.',
    z2: 'Jika saya membayar wang kepada mana-mana ejen atau orang lain, di negara asal saya atau di Malaysia, untuk pekerjaan ini, saya telah menulisnya di bawah supaya syarikat boleh menyiasatnya.',
    z3: 'Syarikat membayar levi, permit kerja, visa dan kos pengambilan. Kos ini tidak dipotong daripada gaji saya.',
    z4: 'Tiada sesiapa memaksa atau mengugut saya untuk menandatangani borang ini. Menandatanganinya tidak menghalang saya daripada melaporkan masalah kemudian.',
    z5: 'Saya boleh melaporkan sebarang yuran atau layanan tidak adil melalui saluran aduan syarikat, dan saya boleh berbuat demikian tanpa memberikan nama saya.',
    paid: 'Wang yang dibayar untuk pekerjaan ini (jumlah, kepada siapa, bila) — tulis "Tiada" jika tidak ada:',
    reference: 'Akuan ini mengikut Prinsip Majikan Membayar: pekerja tidak sepatutnya membayar kos pengambilan mereka sendiri.',
  },
  ne: {
    title: 'शून्य-लागत भर्ती घोषणा',
    intro: 'माथि नाम उल्लेख गरिएको म कामदार घोषणा गर्छु कि:',
    z1: 'यो काम पाउन मैले कम्पनी, यसका कर्मचारी वा एजेन्टहरूलाई कुनै भर्ती शुल्क, धरौटी वा अन्य रकम तिरेको छैन।',
    z2: 'यो कामको लागि मैले मेरो देशमा वा मलेसियामा कुनै एजेन्ट वा अन्य व्यक्तिलाई पैसा तिरेको भए, कम्पनीले छानबिन गर्न सकोस् भनेर मैले तल लेखेको छु।',
    z3: 'लेभी, कार्य अनुमति, भिसा र भर्ती खर्च कम्पनीले तिर्छ। यी खर्च मेरो तलबबाट काटिँदैन।',
    z4: 'यो फारममा हस्ताक्षर गर्न कसैले मलाई जबरजस्ती वा धम्की दिएको छैन। हस्ताक्षर गरेपछि पनि म पछि कुनै समस्याको उजुरी गर्न सक्छु।',
    z5: 'कुनै शुल्क वा अन्यायपूर्ण व्यवहारबारे म कम्पनीको उजुरी माध्यमबाट उजुरी गर्न सक्छु, र मेरो नाम नदिई पनि गर्न सक्छु।',
    paid: 'यो कामको लागि तिरेको पैसा (रकम, कसलाई, कहिले) — केही नभए "छैन" लेख्नुहोस्:',
    reference: 'यो घोषणा "रोजगारदाताले तिर्ने सिद्धान्त" अनुसार हो: कामदारले आफ्नो भर्तीको खर्च तिर्नु हुँदैन।',
  },
  hi: {
    title: 'शून्य-लागत भर्ती घोषणा',
    intro: 'मैं, ऊपर नामित कर्मचारी, घोषणा करता/करती हूँ कि:',
    z1: 'यह नौकरी पाने के लिए मैंने कंपनी, उसके कर्मचारियों या एजेंटों को कोई भर्ती शुल्क, जमा राशि या अन्य शुल्क नहीं दिया है।',
    z2: 'यदि मैंने इस नौकरी के लिए अपने देश में या मलेशिया में किसी एजेंट या अन्य व्यक्ति को पैसे दिए हैं, तो मैंने उसे नीचे लिखा है ताकि कंपनी उसकी जाँच कर सके।',
    z3: 'लेवी, वर्क परमिट, वीज़ा और भर्ती का खर्च कंपनी देती है। यह खर्च मेरे वेतन से नहीं काटा जाता।',
    z4: 'इस फ़ॉर्म पर हस्ताक्षर करने के लिए किसी ने मुझे मजबूर नहीं किया या धमकी नहीं दी। हस्ताक्षर करने के बाद भी मैं बाद में किसी समस्या की शिकायत कर सकता/सकती हूँ।',
    z5: 'मैं किसी भी शुल्क या अनुचित व्यवहार की शिकायत कंपनी के शिकायत माध्यम से कर सकता/सकती हूँ, और अपना नाम बताए बिना भी कर सकता/सकती हूँ।',
    paid: 'इस नौकरी के लिए दिया गया पैसा (राशि, किसे, कब) — कुछ नहीं दिया तो "कुछ नहीं" लिखें:',
    reference: 'यह घोषणा "नियोक्ता भुगतान करे" सिद्धांत के अनुसार है: कर्मचारियों को अपनी भर्ती का खर्च नहीं देना चाहिए।',
  },
  bn: {
    title: 'শূন্য-খরচে নিয়োগের ঘোষণা',
    intro: 'আমি, উপরে নাম লেখা কর্মী, ঘোষণা করছি যে:',
    z1: 'এই চাকরি পেতে আমি কোম্পানি, এর কর্মী বা এজেন্টদের কোনো নিয়োগ ফি, জামানত বা অন্য কোনো টাকা দিইনি।',
    z2: 'এই চাকরির জন্য যদি আমি আমার দেশে বা মালয়েশিয়ায় কোনো এজেন্ট বা অন্য কাউকে টাকা দিয়ে থাকি, তাহলে কোম্পানি যেন তা খতিয়ে দেখতে পারে সেজন্য আমি নিচে লিখেছি।',
    z3: 'লেভি, ওয়ার্ক পারমিট, ভিসা এবং নিয়োগের খরচ কোম্পানি দেয়। এই খরচ আমার বেতন থেকে কাটা হয় না।',
    z4: 'কেউ আমাকে এই ফর্মে সই করতে বাধ্য করেনি বা ভয় দেখায়নি। সই করার পরেও আমি পরে কোনো সমস্যার অভিযোগ করতে পারি।',
    z5: 'কোনো ফি বা অন্যায় আচরণের বিষয়ে আমি কোম্পানির অভিযোগ ব্যবস্থার মাধ্যমে জানাতে পারি, এবং নাম না দিয়েও জানাতে পারি।',
    paid: 'এই চাকরির জন্য দেওয়া টাকা (পরিমাণ, কাকে, কখন) — কিছু না দিলে "কিছু না" লিখুন:',
    reference: 'এই ঘোষণা "নিয়োগকর্তা খরচ বহন করবে" নীতি অনুসরণ করে: কর্মীদের নিজের নিয়োগের খরচ দেওয়া উচিত নয়।',
  },
  my: {
    title: 'အခမဲ့ အလုပ်ခန့်ထားမှု ကြေညာချက်',
    intro: 'အထက်တွင် အမည်ဖော်ပြထားသော အလုပ်သမားဖြစ်သူ ကျွန်ုပ်သည် အောက်ပါအတိုင်း ကြေညာပါသည်-',
    z1: 'ဤအလုပ်ရရန် ကုမ္ပဏီ၊ ၎င်း၏ဝန်ထမ်းများ သို့မဟုတ် အေးဂျင့်များထံ အလုပ်ခန့်ထားခ၊ အာမခံငွေ သို့မဟုတ် အခြားမည်သည့်ငွေကိုမျှ ကျွန်ုပ် မပေးခဲ့ပါ။',
    z2: 'ဤအလုပ်အတွက် ကျွန်ုပ်၏နိုင်ငံတွင်ဖြစ်စေ မလေးရှားတွင်ဖြစ်စေ မည်သည့်အေးဂျင့် သို့မဟုတ် အခြားသူထံ ငွေပေးခဲ့ပါက ကုမ္ပဏီက စုံစမ်းနိုင်ရန် အောက်တွင် ရေးထားပါသည်။',
    z3: 'လီဗီ၊ အလုပ်ပါမစ်၊ ဗီဇာနှင့် အလုပ်ခန့်ထားမှုစရိတ်များကို ကုမ္ပဏီက ပေးပါသည်။ ၎င်းတို့ကို ကျွန်ုပ်၏လစာမှ မဖြတ်ပါ။',
    z4: 'ဤပုံစံကို လက်မှတ်ထိုးရန် မည်သူမျှ ကျွန်ုပ်ကို အတင်းအကျပ် သို့မဟုတ် ခြိမ်းခြောက်ခြင်း မပြုခဲ့ပါ။ လက်မှတ်ထိုးပြီးနောက်လည်း ပြဿနာတစ်ခုခုကို နောက်ပိုင်းတွင် တိုင်ကြားနိုင်ပါသည်။',
    z5: 'မည်သည့်အခကြေးငွေ သို့မဟုတ် မတရားဆက်ဆံမှုကိုမဆို ကုမ္ပဏီ၏ တိုင်ကြားရေးလမ်းကြောင်းမှတစ်ဆင့် အမည်မဖော်ဘဲလည်း တိုင်ကြားနိုင်ပါသည်။',
    paid: 'ဤအလုပ်အတွက် ပေးခဲ့သောငွေ (ပမာဏ၊ မည်သူ့ထံ၊ မည်သည့်အချိန်) — မရှိပါက "မရှိ" ဟု ရေးပါ-',
    reference: 'ဤကြေညာချက်သည် "အလုပ်ရှင်က ပေးချေရမည်" မူကို လိုက်နာပါသည်- အလုပ်သမားများသည် မိမိတို့၏ အလုပ်ခန့်ထားမှုစရိတ်ကို မပေးသင့်ပါ။',
  },
  ur: {
    title: 'بغیر لاگت بھرتی کا اقرار نامہ',
    intro: 'میں، اوپر درج نام والا کارکن، اقرار کرتا/کرتی ہوں کہ:',
    z1: 'یہ نوکری حاصل کرنے کے لیے میں نے کمپنی، اس کے عملے یا اس کے ایجنٹوں کو کوئی بھرتی فیس، زرِ ضمانت یا کوئی اور رقم ادا نہیں کی۔',
    z2: 'اگر میں نے اس نوکری کے لیے اپنے ملک میں یا ملائیشیا میں کسی ایجنٹ یا کسی اور شخص کو پیسے دیے ہیں تو میں نے انہیں نیچے لکھ دیا ہے تاکہ کمپنی اس کی جانچ کر سکے۔',
    z3: 'لیوی، ورک پرمٹ، ویزا اور بھرتی کے اخراجات کمپنی ادا کرتی ہے۔ یہ میری تنخواہ سے نہیں کاٹے جاتے۔',
    z4: 'کسی نے مجھے اس فارم پر دستخط کرنے پر مجبور نہیں کیا اور نہ دھمکی دی۔ دستخط کرنے کے بعد بھی میں بعد میں کسی مسئلے کی شکایت کر سکتا/سکتی ہوں۔',
    z5: 'میں کسی بھی فیس یا ناانصافی کی شکایت کمپنی کے شکایتی نظام کے ذریعے کر سکتا/سکتی ہوں، اور اپنا نام بتائے بغیر بھی کر سکتا/سکتی ہوں۔',
    paid: 'اس نوکری کے لیے ادا کی گئی رقم (کتنی، کسے، کب) — اگر کچھ نہیں تو "کچھ نہیں" لکھیں:',
    reference: 'یہ اقرار نامہ "آجر ادا کرے" کے اصول کے مطابق ہے: کارکنوں کو اپنی بھرتی کے اخراجات ادا نہیں کرنے چاہئیں۔',
  },
  id: {
    title: 'PERNYATAAN REKRUTMEN TANPA BIAYA',
    intro: 'Saya, pekerja yang namanya tersebut di atas, menyatakan bahwa:',
    z1: 'Saya tidak membayar biaya rekrutmen, uang jaminan, atau pungutan lain apa pun kepada perusahaan, stafnya, atau agennya untuk mendapatkan pekerjaan ini.',
    z2: 'Jika saya membayar uang kepada agen atau orang lain, di negara asal saya atau di Malaysia, untuk pekerjaan ini, saya telah menuliskannya di bawah agar perusahaan dapat memeriksanya.',
    z3: 'Perusahaan membayar levi, izin kerja, visa, dan biaya rekrutmen. Biaya ini tidak dipotong dari gaji saya.',
    z4: 'Tidak ada yang memaksa atau mengancam saya untuk menandatangani formulir ini. Menandatanganinya tidak menghalangi saya untuk melaporkan masalah di kemudian hari.',
    z5: 'Saya dapat melaporkan biaya atau perlakuan tidak adil melalui saluran pengaduan perusahaan, dan saya boleh melakukannya tanpa menyebutkan nama.',
    paid: 'Uang yang dibayarkan untuk pekerjaan ini (jumlah, kepada siapa, kapan) — tulis "Tidak ada" jika tidak ada:',
    reference: 'Pernyataan ini mengikuti Prinsip Pemberi Kerja Membayar: pekerja tidak boleh membayar biaya rekrutmen mereka sendiri.',
  },
  ta: {
    title: 'கட்டணமில்லா வேலைக்கு அமர்த்தல் உறுதிமொழி',
    intro: 'மேலே பெயர் குறிப்பிடப்பட்ட தொழிலாளியாகிய நான் உறுதியளிக்கிறேன்:',
    z1: 'இந்த வேலையைப் பெற நான் நிறுவனத்திற்கோ, அதன் ஊழியர்களுக்கோ, முகவர்களுக்கோ எந்த ஆட்சேர்ப்புக் கட்டணமும், வைப்புத் தொகையும், வேறு கட்டணமும் செலுத்தவில்லை.',
    z2: 'இந்த வேலைக்காக என் நாட்டிலோ மலேசியாவிலோ எந்த முகவருக்கோ வேறு நபருக்கோ நான் பணம் கொடுத்திருந்தால், நிறுவனம் அதை விசாரிக்க அதைக் கீழே எழுதியுள்ளேன்.',
    z3: 'லெவி, வேலை அனுமதி, விசா மற்றும் ஆட்சேர்ப்புச் செலவுகளை நிறுவனம் செலுத்துகிறது. இவை என் சம்பளத்திலிருந்து பிடிக்கப்படுவதில்லை.',
    z4: 'இந்தப் படிவத்தில் கையெழுத்திட யாரும் என்னைக் கட்டாயப்படுத்தவோ மிரட்டவோ இல்லை. கையெழுத்திட்ட பிறகும் பின்னர் எந்தப் பிரச்சினையையும் நான் புகார் செய்யலாம்.',
    z5: 'எந்தக் கட்டணம் அல்லது நியாயமற்ற நடத்தை பற்றியும் நிறுவனத்தின் புகார் வழியாக, என் பெயரைக் கூறாமலும், புகார் செய்யலாம்.',
    paid: 'இந்த வேலைக்காகச் செலுத்திய பணம் (தொகை, யாருக்கு, எப்போது) — எதுவும் இல்லையெனில் "இல்லை" என எழுதவும்:',
    reference: 'இந்த உறுதிமொழி "முதலாளியே செலுத்த வேண்டும்" என்ற கொள்கையைப் பின்பற்றுகிறது: தொழிலாளர்கள் தங்கள் ஆட்சேர்ப்புச் செலவைச் செலுத்தக் கூடாது.',
  },
  si: {
    title: 'ශුන්‍ය වියදම් බඳවා ගැනීමේ ප්‍රකාශය',
    intro: 'ඉහත නම සඳහන් සේවකයා වන මම මෙසේ ප්‍රකාශ කරමි:',
    z1: 'මෙම රැකියාව ලබා ගැනීමට මම සමාගමට, එහි කාර්ය මණ්ඩලයට හෝ නියෝජිතයින්ට කිසිදු බඳවා ගැනීමේ ගාස්තුවක්, තැන්පතුවක් හෝ වෙනත් මුදලක් ගෙවා නැත.',
    z2: 'මෙම රැකියාව සඳහා මගේ රටේ හෝ මැලේසියාවේ කිසියම් නියෝජිතයෙකුට හෝ වෙනත් අයෙකුට මම මුදල් ගෙවා ඇත්නම්, සමාගමට එය සොයා බැලීමට හැකි වන පරිදි මම එය පහත ලියා ඇත.',
    z3: 'ලෙවි, වැඩ බලපත්‍රය, වීසා සහ බඳවා ගැනීමේ වියදම් සමාගම ගෙවයි. ඒවා මගේ වැටුපෙන් අඩු නොකෙරේ.',
    z4: 'මෙම පෝරමය අත්සන් කිරීමට කිසිවෙකු මට බල කළේ හෝ තර්ජනය කළේ නැත. අත්සන් කිරීමෙන් පසුවද මට පසුව ගැටලුවක් පැමිණිලි කළ හැකිය.',
    z5: 'කිසියම් ගාස්තුවක් හෝ අසාධාරණ සැලකීමක් ගැන සමාගමේ පැමිණිලි ක්‍රමය හරහා, මගේ නම නොදී වුවද, මට පැමිණිලි කළ හැකිය.',
    paid: 'මෙම රැකියාව සඳහා ගෙවූ මුදල් (ප්‍රමාණය, කාටද, කවදාද) — කිසිවක් නැත්නම් "නැත" ලෙස ලියන්න:',
    reference: 'මෙම ප්‍රකාශය "සේවා යෝජකයා ගෙවිය යුතුය" යන මූලධර්මය අනුගමනය කරයි: සේවකයින් තමන්ගේ බඳවා ගැනීමේ වියදම් නොගෙවිය යුතුය.',
  },
  vi: {
    title: 'CAM KẾT TUYỂN DỤNG KHÔNG MẤT PHÍ',
    intro: 'Tôi, người lao động có tên ở trên, xin cam kết rằng:',
    z1: 'Tôi không trả bất kỳ phí tuyển dụng, tiền đặt cọc hay khoản phí nào khác cho công ty, nhân viên hoặc đại lý của công ty để có được công việc này.',
    z2: 'Nếu tôi đã trả tiền cho bất kỳ đại lý hoặc người nào khác, ở nước tôi hoặc ở Malaysia, cho công việc này, tôi đã ghi lại bên dưới để công ty xem xét.',
    z3: 'Công ty trả tiền levy, giấy phép lao động, thị thực và chi phí tuyển dụng. Các khoản này không bị trừ vào lương của tôi.',
    z4: 'Không ai ép buộc hay đe dọa tôi ký mẫu này. Việc ký không ngăn cản tôi khiếu nại về bất kỳ vấn đề nào sau này.',
    z5: 'Tôi có thể báo cáo bất kỳ khoản phí hay sự đối xử bất công nào qua kênh khiếu nại của công ty, và có thể làm vậy mà không cần ghi tên.',
    paid: 'Số tiền đã trả cho công việc này (bao nhiêu, cho ai, khi nào) — ghi "Không" nếu không có:',
    reference: 'Bản cam kết này tuân theo Nguyên tắc Người sử dụng lao động trả phí: người lao động không phải trả chi phí tuyển dụng của chính mình.',
  },
  th: {
    title: 'คำประกาศการจ้างงานโดยไม่มีค่าใช้จ่าย',
    intro: 'ข้าพเจ้า ลูกจ้างตามชื่อข้างต้น ขอประกาศว่า:',
    z1: 'ข้าพเจ้าไม่ได้จ่ายค่าธรรมเนียมการจัดหางาน เงินมัดจำ หรือค่าใช้จ่ายอื่นใดให้แก่บริษัท พนักงาน หรือตัวแทนของบริษัท เพื่อให้ได้งานนี้',
    z2: 'หากข้าพเจ้าได้จ่ายเงินให้ตัวแทนหรือบุคคลอื่นใด ไม่ว่าในประเทศของข้าพเจ้าหรือในมาเลเซีย เพื่องานนี้ ข้าพเจ้าได้เขียนไว้ด้านล่างเพื่อให้บริษัทตรวจสอบ',
    z3: 'บริษัทเป็นผู้จ่ายค่า levy ใบอนุญาตทำงาน วีซ่า และค่าใช้จ่ายในการจัดหางาน ค่าใช้จ่ายเหล่านี้ไม่ถูกหักจากค่าจ้างของข้าพเจ้า',
    z4: 'ไม่มีผู้ใดบังคับหรือข่มขู่ให้ข้าพเจ้าลงนามในแบบฟอร์มนี้ การลงนามไม่ได้ทำให้ข้าพเจ้าไม่สามารถร้องเรียนปัญหาในภายหลัง',
    z5: 'ข้าพเจ้าสามารถร้องเรียนเรื่องค่าธรรมเนียมหรือการปฏิบัติที่ไม่เป็นธรรมผ่านช่องทางร้องเรียนของบริษัท และสามารถทำได้โดยไม่ต้องระบุชื่อ',
    paid: 'เงินที่จ่ายเพื่องานนี้ (จำนวน ให้ใคร เมื่อใด) — หากไม่มี ให้เขียนว่า "ไม่มี":',
    reference: 'คำประกาศนี้เป็นไปตามหลักการนายจ้างเป็นผู้จ่าย: ลูกจ้างไม่ควรต้องจ่ายค่าใช้จ่ายในการจัดหางานของตนเอง',
  },
  km: {
    title: 'សេចក្តីប្រកាសអំពីការជ្រើសរើសដោយមិនគិតថ្លៃ',
    intro: 'ខ្ញុំ ជាកម្មករដែលមានឈ្មោះខាងលើ សូមប្រកាសថា៖',
    z1: 'ខ្ញុំមិនបានបង់ថ្លៃជ្រើសរើស ប្រាក់កក់ ឬថ្លៃផ្សេងទៀតណាមួយ ឱ្យក្រុមហ៊ុន បុគ្គលិក ឬភ្នាក់ងាររបស់ក្រុមហ៊ុន ដើម្បីទទួលបានការងារនេះទេ។',
    z2: 'ប្រសិនបើខ្ញុំបានបង់ប្រាក់ឱ្យភ្នាក់ងារ ឬអ្នកផ្សេងណាមួយ នៅប្រទេសរបស់ខ្ញុំ ឬនៅម៉ាឡេស៊ី សម្រាប់ការងារនេះ ខ្ញុំបានសរសេរវានៅខាងក្រោម ដើម្បីឱ្យក្រុមហ៊ុនពិនិត្យមើល។',
    z3: 'ក្រុមហ៊ុនបង់ថ្លៃ levy លិខិតអនុញ្ញាតការងារ ទិដ្ឋាការ និងថ្លៃជ្រើសរើស។ ថ្លៃទាំងនេះមិនត្រូវកាត់ពីប្រាក់ឈ្នួលរបស់ខ្ញុំទេ។',
    z4: 'គ្មាននរណាបង្ខំ ឬគំរាមខ្ញុំឱ្យចុះហត្ថលេខាលើទម្រង់នេះទេ។ ការចុះហត្ថលេខាមិនរារាំងខ្ញុំពីការប្តឹងអំពីបញ្ហានៅពេលក្រោយទេ។',
    z5: 'ខ្ញុំអាចរាយការណ៍អំពីថ្លៃ ឬការប្រព្រឹត្តមិនយុត្តិធម៌ តាមរយៈបណ្តាញបណ្តឹងរបស់ក្រុមហ៊ុន ហើយអាចធ្វើបានដោយមិនបញ្ចេញឈ្មោះ។',
    paid: 'ប្រាក់ដែលបានបង់សម្រាប់ការងារនេះ (ចំនួន ឱ្យនរណា ពេលណា) — សរសេរ "គ្មាន" ប្រសិនបើគ្មាន៖',
    reference: 'សេចក្តីប្រកាសនេះអនុវត្តតាមគោលការណ៍និយោជកជាអ្នកបង់៖ កម្មករមិនគួរបង់ថ្លៃជ្រើសរើសខ្លួនឯងទេ។',
  },
  tl: {
    title: 'DEKLARASYON NG RECRUITMENT NA WALANG BAYAD',
    intro: 'Ako, ang manggagawang nakapangalan sa itaas, ay nagpapahayag na:',
    z1: 'Hindi ako nagbayad ng anumang recruitment fee, deposito o iba pang singil sa kumpanya, sa mga tauhan nito o sa mga ahente nito upang makuha ang trabahong ito.',
    z2: 'Kung nagbayad ako ng pera sa sinumang ahente o ibang tao, sa aking bansa o sa Malaysia, para sa trabahong ito, isinulat ko ito sa ibaba upang masuri ng kumpanya.',
    z3: 'Ang kumpanya ang nagbabayad ng levy, work permit, visa at gastos sa recruitment. Hindi ito ibinabawas sa aking sahod.',
    z4: 'Walang pumilit o nagbanta sa akin na pirmahan ang form na ito. Ang pagpirma ay hindi pumipigil sa akin na magreklamo tungkol sa anumang problema sa hinaharap.',
    z5: 'Maaari kong iulat ang anumang singil o hindi patas na pagtrato sa pamamagitan ng daluyan ng reklamo ng kumpanya, at maaari kong gawin ito nang hindi ibinibigay ang aking pangalan.',
    paid: 'Perang ibinayad para sa trabahong ito (halaga, kanino, kailan) — isulat ang "Wala" kung wala:',
    reference: 'Ang deklarasyong ito ay sumusunod sa Employer Pays Principle: hindi dapat magbayad ang mga manggagawa para sa sarili nilang recruitment.',
  },
  zh: {
    title: '零费用招聘声明',
    intro: '本人，即上述员工，声明如下：',
    z1: '本人没有为获得这份工作向公司、其员工或其代理支付任何招聘费、押金或其他费用。',
    z2: '如本人曾为这份工作在本国或马来西亚向任何代理或其他人付款，本人已在下方写明，以便公司调查。',
    z3: '人头税（levy）、工作准证、签证和招聘费用由公司支付，不从本人工资中扣除。',
    z4: '没有任何人强迫或威胁本人签署本表格。签署本表格不妨碍本人日后投诉任何问题。',
    z5: '本人可以通过公司的投诉渠道举报任何收费或不公平对待，并且可以匿名举报。',
    paid: '为这份工作支付的款项（金额、付给谁、何时）——如没有，请写"无"：',
    reference: '本声明遵循"雇主付费原则"：员工不应承担自己的招聘费用。',
  },
}

function clean(t?: Partial<ZcText>): Partial<ZcText> {
  const o: Partial<ZcText> = {}
  for (const k of ZC_KEYS) { const v = t?.[k]; if (typeof v === 'string' && v.trim()) o[k] = v.trim() }
  return o
}

/** second language of the declaration (same rule as the consent form): the worker's language, else Bahasa Malaysia.
 *  The field labels (name, passport no., signatures) come from the consent-form translation of that language. */
export function zeroCostLanguage(primary: string | undefined, zc: ZcTranslationsConfig, consent: ConsentTranslationsConfig): { code: string; text: ZcText; labels: ConsentText; fallback?: string } {
  const ms = { ...ZC_TR.ms, ...clean(zc.items?.ms?.text) }
  const msLabels = consentLanguage('ms', consent).text
  if (!primary || primary === 'en' || primary === 'ms') return { code: 'ms', text: ms, labels: msLabels, fallback: primary ? undefined : 'Primary language not recorded — English + Bahasa Malaysia used.' }
  const ov = zc.items?.[primary]
  const base = ZC_TR[primary]
  const cl = consentLanguage(primary, consent)
  const full = ov && ZC_KEYS.every((k) => (ov.text?.[k] || '').trim())
  if ((!base && !full) || cl.code !== primary) return { code: 'ms', text: ms, labels: msLabels, fallback: 'No translation for the worker\u2019s language yet — English + Bahasa Malaysia used.' }
  return { code: primary, text: { ...(base || ZC_EN), ...clean(ov?.text) }, labels: cl.text }
}
export const ZC_LABELS_EN = CONSENT_EN
