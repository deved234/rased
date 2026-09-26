import React from 'react'

// Minimal hand-drawn stroke icon set (24 viewBox, currentColor). No icon lib.
const PATHS: Record<string, React.ReactNode> = {
  briefcase: <path d="M4 8h16v11H4z M9 8V5h6v3 M4 13h16" />,
  bookmark: <path d="M7 4h10v16l-5-4-5 4z" />,
  bookmarkFill: <path d="M7 4h10v16l-5-4-5 4z" fill="currentColor" stroke="none" />,
  filter: <path d="M4 5h16 M7 12h10 M10 19h4" />,
  gear: <path d="M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 1 0 12 8.5 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9l2.1 2.1 M17 17l2.1 2.1 M19.1 4.9L17 7 M7 17l-2.1 2.1" />,
  search: <path d="M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12z M15.5 15.5L20 20" />,
  bell: <path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2.5h-15z M10 21a2 2 0 0 0 4 0" />,
  home: <path d="M4 11l8-7 8 7 M6 10v10h12V10" />,
  chevR: <path d="M9 5l7 7-7 7" />,
  chevL: <path d="M15 5l-7 7 7 7" />,
  chevD: <path d="M5 9l7 7 7-7" />,
  x: <path d="M6 6l12 12 M18 6L6 18" />,
  plus: <path d="M12 5v14 M5 12h14" />,
  check: <path d="M5 12l5 5 9-11" />,
  external: <path d="M14 4h6v6 M20 4l-9 9 M18 13v7H4V6h7" />,
  copy: <path d="M9 9h11v11H9z M5 15V4h11" />,
  clock: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3 2" />,
  refresh: <path d="M20 12a8 8 0 1 1-2.3-5.6 M20 3v4h-4" />,
  pin: <path d="M9 4h6l1 7 2 3v2H6v-2l2-3z M12 16v5" />,
  eye: <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />,
  eyeOff: <path d="M4 4l16 16 M9.9 5.9A9.5 9.5 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.3 3.9 M6 8A16 16 0 0 0 2.5 12S6 18.5 12 18.5c1.2 0 2.3-.3 3.3-.7" />,
  pause: <path d="M9 5v14 M15 5v14" />,
  play: <path d="M7 4l13 8-13 8z" />,
  folder: <path d="M3 6h6l2 2h10v11H3z" />,
  keyboard: <path d="M3 7h18v10H3z M7 11h.01 M11 11h.01 M15 11h.01 M17 11h.01 M7 14.5h10" />,
  info: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 11v5 M12 7.5h.01" />,
  warn: <path d="M12 3L2.5 20h19z M12 10v4 M12 17h.01" />,
  trash: <path d="M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13" />,
  edit: <path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z" />,
  globe: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M3 12h18 M12 3c3 3.5 3 14 0 18 M12 3c-3 3.5-3 14 0 18" />,
  sound: <path d="M4 10v4h4l5 4V6l-5 4z M16 9a4.2 4.2 0 0 1 0 6 M18.5 6.5a8 8 0 0 1 0 11" />,
  mute: <path d="M4 10v4h4l5 4V6l-5 4z M16 9l6 6 M22 9l-6 6" />,
  collapse: <path d="M4 6h16v12H4z M14 6v12" />,
  dots: <path d="M5 12h.01 M12 12h.01 M19 12h.01" />,
  back: <path d="M19 12H5 M11 6l-6 6 6 6" />,
  download: <path d="M12 4v12 M6 10l6 6 6-6 M4 20h16" />,
  upload: <path d="M12 16V4 M6 10l6-6 6 6 M4 20h16" />
}

export function Icon({ name, size = 18, label }: { name: keyof typeof PATHS; size?: number; label?: string }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      {PATHS[name]}
    </svg>
  )
}
