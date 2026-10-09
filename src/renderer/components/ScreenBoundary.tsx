import React from 'react'
import { requestAction } from '../router.js'

/** Keeps a failed optional screen from replacing the entire desktop shell. */
export class ScreenBoundary extends React.Component<{ ar: boolean; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true } }
  render(): React.ReactNode {
    if (!this.state.failed) return this.props.children
    return <div className="detail-wrap" role="alert"><p>{this.props.ar ? 'تعذر فتح هذه الشاشة. البيانات المحفوظة لم تتغير.' : 'Could not open this screen. Saved data has not changed.'}</p><button className="btn" onClick={() => requestAction(() => window.location.reload())}>{this.props.ar ? 'إعادة تحميل الواجهة' : 'Reload interface'}</button></div>
  }
}
