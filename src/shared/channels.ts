// Narrow, typed IPC surface. The renderer never sees Node, SQL or fetch.
export const IPC = {
  getProjects: 'rased:get-projects',
  getProjectCount: 'rased:get-project-count',
  setReadState: 'rased:set-read-state',
  markAllRead: 'rased:mark-all-read',
  getSettings: 'rased:get-settings',
  updateSettings: 'rased:update-settings',
  getHealth: 'rased:get-health',
  pause: 'rased:pause',
  resume: 'rased:resume',
  refresh: 'rased:refresh',
  openProject: 'rased:open-project',
  getDiagnostics: 'rased:get-diagnostics',
  projectsChanged: 'rased:projects-changed',
  healthChanged: 'rased:health-changed',
  settingsChanged: 'rased:settings-changed',
  playBeep: 'rased:play-beep'
} as const
