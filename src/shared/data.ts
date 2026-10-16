export interface BackupPreferences {
  schedule: 'off' | 'daily' | 'weekly'
  keep: 3 | 5 | 10
}

export interface BackupCounts {
  projects: number
  notes: number
  drafts: number
  filters: number
}

export interface RestorePreview {
  ok: boolean
  error?: string
  token?: string
  createdAt?: string
  appVersion?: string
  incoming?: BackupCounts
  current?: BackupCounts
  startupRequested?: boolean
}

export interface DataStatus {
  preferences: BackupPreferences
  busy: boolean
  lastBackupAt: string | null
  lastBackupPath: string | null
  lastBackupError: string | null
  lastRestore: { ok: boolean; at: string; error?: string; rollbackPath?: string; originalFilesPath?: string } | null
}

export function sanitizeBackupPreferences(value: unknown): BackupPreferences | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (!['off', 'daily', 'weekly'].includes(String(v.schedule)) || ![3, 5, 10].includes(Number(v.keep)) || typeof v.keep !== 'number') return null
  return { schedule: v.schedule as BackupPreferences['schedule'], keep: v.keep as BackupPreferences['keep'] }
}

export function dataErrorText(code: string | undefined, ar: boolean): string {
  const messages: Record<string, [string, string]> = {
    'busy': ['يوجد نسخ أو استعادة قيد التنفيذ. انتظر ثم حاول مجددًا.', 'A backup or restore is running. Wait and retry.'],
    'too-large': ['حجم الملف أكبر من الحد المدعوم. اختر ملفًا أصغر.', 'The file exceeds the supported size. Choose a smaller file.'],
    'invalid-json': ['ملف الإعدادات ليس JSON صالحًا. اختر الملف الأصلي المصدّر من راصد.', 'Invalid JSON. Choose the original RASED settings export.'],
    'bad-schema': ['الملف غير متوافق أو بياناته غير صالحة. اختر ملفًا أصليًا من راصد.', 'Incompatible or invalid data. Choose an original RASED file.'],
    'newer-schema': ['النسخة الاحتياطية من إصدار أحدث. حدّث راصد أولًا.', 'This backup needs a newer RASED version. Update first.'],
    'read-failed': ['تعذر قراءة الملف. راجع مكانه وصلاحياته وأعد المحاولة.', 'Could not read the file. Check its location and permissions, then retry.'],
    'write-failed': ['تعذر حفظ الملف. راجع المساحة المتاحة وصلاحيات المجلد.', 'Could not save the file. Check free space and folder permissions.'],
    'backup-failed': ['تعذر إنشاء النسخة الاحتياطية. راجع مساحة القرص وصلاحيات المجلد وأعد المحاولة.', 'Could not create the backup. Check disk space and folder permissions, then retry.'],
    'rollback-failed': ['تعذر إنشاء نسخة الرجوع؛ لم تُستعد البيانات. راجع مساحة القرص وأعد المحاولة.', 'Could not create the rollback backup; no data was restored. Check disk space and retry.'],
    'restore-failed': ['تعذرت الاستعادة وبقيت البيانات السابقة. اختر النسخة وأعد المحاولة.', 'Restore failed; previous data was kept. Select the backup and retry.'],
    'protected-location': ['اختر ملفًا منفصلًا خارج ملفات قاعدة بيانات راصد.', 'Choose a separate file outside RASED database files.'],
    'no-validated-import': ['اختر ملف الإعدادات وراجعه من جديد.', 'Select and preview the settings file again.'],
    'preview-expired': ['انتهت صلاحية المعاينة. اختر النسخة الاحتياطية من جديد.', 'The preview expired. Select the backup again.']
  }
  return messages[code ?? '']?.[ar ? 0 : 1] ?? (ar ? 'تعذر إتمام العملية. أعد المحاولة.' : 'The operation failed. Retry.')
}
