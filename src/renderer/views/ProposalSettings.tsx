import React from 'react'
import { rased } from '../api.js'
import { registerNavigationBlocker } from '../router.js'
import type { Lang } from '../i18n.js'
import { emptyProposalProfile, GEMINI_MODEL, type ProposalProfile } from '@shared/proposals.js'

export function ProposalSettings({ lang }: { lang: Lang }): React.ReactElement {
  const ar = lang === 'ar'
  const [profile, setProfile] = React.useState<ProposalProfile>(emptyProposalProfile())
  const [savedProfile, setSavedProfile] = React.useState<ProposalProfile>(emptyProposalProfile())
  const [hasKey, setHasKey] = React.useState(false)
  const [key, setKey] = React.useState('')
  const [message, setMessage] = React.useState('')
  React.useEffect(() => { void rased.getProposalSetup().then(s => { if (s) { setProfile(s.profile); setSavedProfile(s.profile); setHasKey(s.hasKey) } }) }, [])
  const dirtyRef = React.useRef(false)
  dirtyRef.current = JSON.stringify(profile) !== JSON.stringify(savedProfile)
  React.useEffect(() => registerNavigationBlocker(() => !dirtyRef.current || window.confirm(ar ? 'تعديلات ملفك المهني غير محفوظة. هل تريد المغادرة؟' : 'Your profile changes are unsaved. Leave?')), [ar])
  const set = (field: keyof ProposalProfile, value: string): void => setProfile(p => ({ ...p, [field]: value }))
  const saveKey = async (): Promise<void> => {
    const result = await rased.saveGeminiKey(key)
    if (result.ok) { setKey(''); setHasKey(true); setMessage(ar ? 'تم حفظ المفتاح مشفرًا على هذا الجهاز.' : 'Key encrypted and saved on this device.') }
    else setMessage(ar ? 'تعذر حفظ المفتاح. تأكد من دعم تشفير Windows وصحة الإدخال.' : 'Could not save key. Check Windows encryption and input.')
  }
  return <div className="set-group proposal-settings">
    <h2>{ar ? 'مساعد العروض' : 'Proposal Assistant'}</h2>
    <p className="desc">{ar ? 'Gemini هو المزود الحالي. لا تُولّد عروض ولا تُرسل بيانات تلقائيًا أثناء متابعة المشاريع.' : 'Gemini is the current provider. No proposal is generated or data sent while watching projects.'}</p>
    <p className="muted small" dir="ltr">Model: {GEMINI_MODEL}</p>
    <div className="set-row"><label>{ar ? 'مفتاح Gemini API' : 'Gemini API key'}</label><span className={hasKey ? 'tag good' : 'tag uncertain'}>{hasKey ? (ar ? 'محفوظ' : 'Saved') : (ar ? 'غير محفوظ' : 'Not saved')}</span></div>
    <input className="input" type="password" autoComplete="off" spellCheck={false} value={key} onChange={e => setKey(e.target.value)} placeholder={ar ? 'الصق مفتاحك هنا' : 'Paste your key here'} aria-label="Gemini API key" />
    <div className="row-actions"><button className="btn primary sm" disabled={!key} onClick={() => void saveKey()}>{ar ? 'حفظ المفتاح' : 'Save key'}</button><button className="btn danger sm" disabled={!hasKey} onClick={() => { if (window.confirm(ar ? 'حذف المفتاح من هذا الجهاز؟' : 'Delete key from this device?')) void rased.deleteGeminiKey().then(() => { setHasKey(false); setMessage(ar ? 'تم حذف المفتاح.' : 'Key deleted.') }) }}>{ar ? 'حذف المفتاح' : 'Delete key'}</button></div>
    <p className="hint">{ar ? 'المفتاح مشفّر بحماية Windows وخارج قاعدة البيانات والتصدير. لا تشاركه مع أحد؛ تكلفة الاستخدام وحصته حسب حسابك لدى Google.' : 'The key is Windows-encrypted outside the database and exports. Keep it private; usage costs and quotas depend on your Google account.'}</p>
    <h3>{ar ? 'ملفك المهني' : 'Your freelancer profile'}</h3>
    <p className="hint">{ar ? 'اكتب حقائق حقيقية فقط. المعلومات دي هتظهر في المعاينة قبل إرسالها.' : 'Enter only real facts. You will preview these before sending.'}</p>
    {([['skills', ar ? 'المهارات' : 'Skills', 2000], ['experience', ar ? 'الخبرة' : 'Experience', 3000], ['portfolio', ar ? 'نماذج الأعمال والروابط' : 'Portfolio examples and links', 3000], ['tone', ar ? 'أسلوب العرض' : 'Proposal tone', 500]] as const).map(([field, label, max]) => <div key={field} className="proposal-field"><label htmlFor={`profile-${field}`}>{label}</label><textarea id={`profile-${field}`} className="textarea" dir="auto" maxLength={max} value={profile[field]} onChange={e => set(field, e.target.value)} /></div>)}
    <div className="set-row"><label htmlFor="profile-language">{ar ? 'لغة العرض' : 'Proposal language'}</label><select id="profile-language" className="select" value={profile.language} onChange={e => set('language', e.target.value)}><option value="ar">العربية</option><option value="en">English</option></select></div>
    <div className="row-actions"><button className="btn primary sm" disabled={!dirtyRef.current} onClick={() => void rased.saveProposalProfile(profile).then(r => { if (r.ok) setSavedProfile(profile); setMessage(r.ok ? (ar ? 'تم حفظ الملف الشخصي محليًا.' : 'Profile saved locally.') : (ar ? 'تعذر حفظ الملف الشخصي.' : 'Could not save profile.')) })}>{ar ? 'حفظ الملف الشخصي' : 'Save profile'}</button><button className="btn danger sm" onClick={() => { if (window.confirm(ar ? 'مسح الملف الشخصي؟' : 'Clear profile?')) void rased.saveProposalProfile(emptyProposalProfile()).then(() => { setProfile(emptyProposalProfile()); setSavedProfile(emptyProposalProfile()); setMessage(ar ? 'تم مسح الملف الشخصي.' : 'Profile cleared.') }) }}>{ar ? 'مسح الملف' : 'Clear profile'}</button></div>
    {message && <p className="meta" role="status">{message}</p>}
  </div>
}
