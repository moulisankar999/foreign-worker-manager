/* 1.6.0 birthday card texts (machine-drafted — have a native speaker check before wide release) */
import type { Lang } from './i18n'
export interface BdayT { title: string; from: string; thanks: string; wishes: string; next: string }
export const BDAY_T: Record<Lang, BdayT> = {
  en: { title: 'Happy Birthday!', from: 'From', thanks: 'Thank you!', wishes: 'Birthday wishes', next: 'Next' },
  ms: { title: 'Selamat Hari Jadi!', from: 'Daripada', thanks: 'Terima kasih!', wishes: 'Ucapan hari jadi', next: 'Seterusnya' },
  ta: { title: 'இனிய பிறந்தநாள் வாழ்த்துகள்!', from: 'அனுப்பியவர்', thanks: 'நன்றி!', wishes: 'பிறந்தநாள் வாழ்த்துகள்', next: 'அடுத்து' },
  hi: { title: 'जन्मदिन मुबारक!', from: 'की ओर से', thanks: 'धन्यवाद!', wishes: 'जन्मदिन की शुभकामनाएँ', next: 'अगला' },
  te: { title: 'పుట్టినరోజు శుభాకాంక్షలు!', from: 'పంపినవారు', thanks: 'ధన్యవాదాలు!', wishes: 'పుట్టినరోజు శుభాకాంక్షలు', next: 'తదుపరి' },
  ml: { title: 'ജന്മദിനാശംസകൾ!', from: 'അയച്ചത്', thanks: 'നന്ദി!', wishes: 'ജന്മദിന ആശംസകൾ', next: 'അടുത്തത്' },
  kn: { title: 'ಹುಟ್ಟುಹಬ್ಬದ ಶುಭಾಶಯಗಳು!', from: 'ಕಳುಹಿಸಿದವರು', thanks: 'ಧನ್ಯವಾದಗಳು!', wishes: 'ಹುಟ್ಟುಹಬ್ಬದ ಶುಭಾಶಯಗಳು', next: 'ಮುಂದೆ' },
  bn: { title: 'শুভ জন্মদিন!', from: 'পাঠিয়েছেন', thanks: 'ধন্যবাদ!', wishes: 'জন্মদিনের শুভেচ্ছা', next: 'পরের' },
  ne: { title: 'जन्मदिनको शुभकामना!', from: 'पठाउने', thanks: 'धन्यवाद!', wishes: 'जन्मदिनका शुभकामना', next: 'अर्को' },
  my: { title: 'မွေးနေ့မှာ ပျော်ရွှင်ပါစေ!', from: 'ပေးပို့သူ', thanks: 'ကျေးဇူးတင်ပါသည်!', wishes: 'မွေးနေ့ ဆုတောင်းချက်များ', next: 'နောက်တစ်ခု' },
}
