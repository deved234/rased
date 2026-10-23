import React from 'react'
import { emptyProposalProfile } from '@shared/proposals.js'
import { sanitizeProfileSet, type ProfileEntry, type ProfileSet } from '@shared/proposalProfiles.js'

interface Props {
  ar: boolean
  value: ProfileSet | null
  saved: ProfileSet | null
  error: boolean
  busy: boolean
  onChange: (value: ProfileSet) => void
  onSave: (value: ProfileSet) => void
  onRecover: () => void
}

export function ProfileEditor({ ar, value, saved, error, busy, onChange, onSave, onRecover }: Props): React.ReactElement {
  const [selected, setSelected] = React.useState('')
  const profile = value?.profiles.find(p => p.id === selected) ?? value?.profiles.find(p => p.id === value.defaultId)
  const dirty = JSON.stringify(value) !== JSON.stringify(saved)
  const set = (field: keyof ProfileEntry, text: string): void => {
    if (value && profile) onChange({ ...value, profiles: value.profiles.map(p => p.id === profile.id ? { ...p, [field]: text } : p) })
  }
  return <section className="profile-manager" aria-labelledby="profiles-heading">
    <h3 id="profiles-heading">{ar ? '4. الملفات المهنية' : '4. Freelancer profiles'}</h3>
    <p className="hint">{ar ? 'حتى 10 ملفات. الافتراضي يُستخدم في التقديم السريع والتوليد بالموافقة الدائمة؛ تغييره لا يسحب الموافقة. المسودات المحفوظة لا تتغير.' : 'Up to 10 profiles. The default supplies Quick Apply and generation under standing consent; changing it does not revoke consent. Saved drafts stay unchanged.'}</p>
    {error && <div className="banner warn" role="alert"><p>{ar ? 'تعذر قراءة مجموعة الملفات المحفوظة. لم نغيّر بياناتها؛ يظهر الملف القديم للقراءة ويُستخدم مؤقتًا.' : 'The saved profile set is unreadable. Its data is preserved; the legacy profile is shown read-only and used temporarily.'}</p><button className="btn danger sm" disabled={busy} onClick={() => {
      if (window.confirm(ar ? 'استبدال المجموعة التالفة بملف واحد من البيانات القديمة؟' : 'Replace the damaged set with one profile from legacy data?')) onRecover()
    }}>{ar ? 'إعادة الإنشاء من البروفايل القديم' : 'Recreate from legacy profile'}</button></div>}
    <div className="profile-list">{value?.profiles.map(entry => <div className="profile-list-card" key={entry.id}>
      <button className="btn ghost profile-select" aria-pressed={entry.id === profile?.id} disabled={busy} onClick={() => setSelected(entry.id)}><span dir="auto">{entry.name || (ar ? 'ملف جديد' : 'New profile')}</span></button>
      {entry.id === value.defaultId && <span className="tag good">{ar ? 'افتراضي' : 'Default'}</span>}
      <button className="btn sm" disabled={busy || error || entry.id === value.defaultId || dirty} onClick={() => onSave({ ...value, defaultId: entry.id })}>{ar ? 'تعيين كافتراضي' : 'Set as default'}</button>
      <button className="btn danger sm" disabled={busy || error || value.profiles.length === 1 || entry.id === value.defaultId} onClick={() => {
        if (window.confirm(ar ? `حذف الملف «${entry.name}»؟` : `Delete profile “${entry.name}”?`)) onChange({ ...value, profiles: value.profiles.filter(p => p.id !== entry.id) })
      }}>{ar ? 'حذف' : 'Delete'}</button>
    </div>)}</div>
    <button className="btn sm" disabled={busy || error || !value || value.profiles.length >= 10} onClick={() => {
      if (!value) return
      const id = crypto.randomUUID().replaceAll('-', '')
      onChange({ ...value, profiles: [...value.profiles, { ...emptyProposalProfile(), id, name: ar ? 'ملف جديد' : 'New profile', quickTemplate: '' }] }); setSelected(id)
    }}>{ar ? 'إضافة ملف' : 'Add profile'}</button>
    <p className="hint">{ar ? 'احفظ التعديلات قبل تعيين الافتراضي. لحذف الافتراضي، عيّن ملفًا آخر أولًا؛ لا يمكن حذف آخر ملف.' : 'Save edits before setting a default. To delete the default, assign another first; the last profile cannot be deleted.'}</p>
    {profile && <>
      <div className="proposal-field"><label htmlFor="profile-name">{ar ? 'اسم الملف' : 'Profile name'}</label><input id="profile-name" className="input" dir="auto" disabled={busy} readOnly={error} maxLength={60} value={profile.name} onChange={e => set('name', e.target.value)} /></div>
      {([['skills', ar ? 'المهارات' : 'Skills', 2000], ['experience', ar ? 'الخبرة' : 'Experience', 3000], ['portfolio', ar ? 'نماذج الأعمال والروابط' : 'Portfolio examples and links', 3000], ['tone', ar ? 'أسلوب العرض' : 'Proposal tone', 500]] as const).map(([field, label, max]) => <div key={field} className="proposal-field"><label htmlFor={`profile-${field}`}>{label}</label><textarea id={`profile-${field}`} disabled={busy} readOnly={error} className="textarea" dir="auto" maxLength={max} value={profile[field]} onChange={e => set(field, e.target.value)} /></div>)}
      <div className="set-row"><label htmlFor="profile-language">{ar ? 'لغة العرض' : 'Proposal language'}</label><select id="profile-language" disabled={busy || error} className="select" value={profile.language} onChange={e => set('language', e.target.value)}><option value="ar">العربية</option><option value="en">English</option></select></div>
      <div className="proposal-field"><label htmlFor="profile-template">{ar ? 'قالب التقديم السريع (اختياري)' : 'Quick Apply template (optional)'}</label><textarea id="profile-template" className="textarea" dir="auto" disabled={busy} readOnly={error} maxLength={10000} value={profile.quickTemplate} onChange={e => set('quickTemplate', e.target.value)} /><p className="hint">{profile.quickTemplate.length} / 10000 · {ar ? 'يُستخدم عند جعل هذا الملف افتراضيًا. لا يُرسل إلى مزوّد الذكاء الاصطناعي.' : 'Used when this profile is the default. Excluded from AI requests.'}</p></div>
    </>}
    {value && !sanitizeProfileSet(value) && <p className="field-err" role="alert">{ar ? 'كل ملف يحتاج اسمًا من 1 إلى 60 حرفًا ضمن حدود الحقول.' : 'Each profile needs a name of 1–60 characters and fields within their limits.'}</p>}
    <button className="btn primary sm" disabled={!dirty || busy || error || !sanitizeProfileSet(value)} onClick={() => value && onSave(value)}>{ar ? 'حفظ الملفات المهنية' : 'Save profiles'}</button>
    <p className="hint" role="status">{dirty ? (ar ? 'تعديلات ملفات غير محفوظة' : 'Unsaved profile changes') : ''}</p>
  </section>
}
