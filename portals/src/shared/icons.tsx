// Minimal stroke icon set (24px grid).
import type { ReactNode } from 'react';

const I = ({ children, size = 18 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const Icons = {
  dashboard: <I><rect x="3" y="3" width="7" height="9" rx="2" /><rect x="14" y="3" width="7" height="5" rx="2" /><rect x="14" y="12" width="7" height="9" rx="2" /><rect x="3" y="16" width="7" height="5" rx="2" /></I>,
  calendar: <I><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></I>,
  bookings: <I><path d="M5 4h14v16l-3-2-2 2-2-2-2 2-2-2-3 2z" /><path d="M9 9h6M9 13h4" /></I>,
  venue: <I><path d="M3 21h18M5 21V10l7-5 7 5v11" /><path d="M10 21v-5h4v5" /></I>,
  services: <I><path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2 8 12.7 4 8.8 9.5 8z" /></I>,
  finance: <I><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M3 10h18" /><circle cx="16" cy="15" r="1.5" /></I>,
  profile: <I><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></I>,
  reviews: <I><path d="M4 5h16v11H9l-5 4z" /><path d="M9 10h6" /></I>,
  bell: <I><path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z" /><path d="M10 21h4" /></I>,
  users: <I><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c1-3.5 3.5-5 6.5-5s5.5 1.5 6.5 5" /><circle cx="17" cy="9" r="2.5" /><path d="M17 14c2 0 3.8 1.2 4.5 3.5" /></I>,
  business: <I><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18" /></I>,
  card: <I><rect x="2.5" y="5" width="19" height="14" rx="3" /><path d="M2.5 10h19M6 15h4" /></I>,
  refund: <I><path d="M4 12a8 8 0 1 0 3-6.2" /><path d="M4 4v4h4" /></I>,
  payout: <I><path d="M12 3v12M7 10l5 5 5-5" /><path d="M4 19h16" /></I>,
  ledger: <I><path d="M5 3h11l3 3v15H5z" /><path d="M9 8h6M9 12h6M9 16h4" /></I>,
  scale: <I><path d="M12 3v18M5 21h14M4 8h16" /><path d="M7 8l-3 6a3 3 0 0 0 6 0zM17 8l-3 6a3 3 0 0 0 6 0z" /></I>,
  flag: <I><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></I>,
  tag: <I><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8" r="1.5" /></I>,
  ticket: <I><path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z" /><path d="M14 6v12" strokeDasharray="2 2" /></I>,
  pin: <I><path d="M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z" /><circle cx="12" cy="9" r="2.5" /></I>,
  settings: <I><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></I>,
  shield: <I><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" /></I>,
  log: <I><path d="M4 6h16M4 12h16M4 18h10" /></I>,
  menu: <I><path d="M4 7h16M4 12h16M4 17h16" /></I>,
  more: <I><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></I>,
  logout: <I><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" /></I>,
  plus: <I><path d="M12 5v14M5 12h14" /></I>,
  lock: <I><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></I>,
  wrench: <I><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z" /></I>,
  check: <I><path d="M5 12l4 4 10-10" /></I>,
  chevronLeft: <I><path d="M15 6l-6 6 6 6" /></I>,
  chevronRight: <I><path d="M9 6l6 6-6 6" /></I>,
  star: <I><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" /></I>,
  upload: <I><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 20h16" /></I>,
  trash: <I><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></I>,
  map: <I><path d="M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2z" /><path d="M9 4v14M15 6v14" /></I>,
  search: <I><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></I>,
};
