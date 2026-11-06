// אייקונים אחידים (קו 1.8, 24px). מחרוזות SVG סטטיות בלבד, ללא קלט משתמש.
const svg = d => `<svg class="ic" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICON = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  resume: svg('<path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M4 4v4h4"/><path d="M12 8v4l3 2"/>'),
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
  user: svg('<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.6-3.6 3.4-5.5 7-5.5s6.4 1.9 7 5.5"/>'),
  shield: svg('<path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/>'),
  pdf: svg('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M9.5 15h5M9.5 18h3"/>'),
  image: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 18 5-5 4 4 3-3 4 4"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
};
