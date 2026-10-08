const range = (a, b) => Array.from({ length: b.charCodeAt(0) - a.charCodeAt(0) + 1 }, (_, i) => String.fromCharCode(a.charCodeAt(0) + i));
const LOCATIONS = {
  'Academic Blocks': ['SJT', 'TT', 'PRP', 'SMV', 'MB', 'GDN', 'CDMM'],
  "Men's Hostels": range('A', 'T').map(c => `MH-${c}`),
  "Ladies' Hostels": range('A', 'J').map(c => `LH-${c}`),
  'Food Courts': ['Gazebo', 'Food Mall', 'DC'],
  Other: ['Central Library', 'Sports Complex']
};
const CATEGORIES = ['ID Cards', 'Room Keys', 'Calculators', 'Lab Equipment', 'Earphones', 'Wallets'];
const MEETUP_POINTS = ['SJT Ground Floor Reception', 'TT Ground Floor Reception', 'Central Library Security Desk',
  'Gazebo Food Court Entrance', 'Sports Complex Reception', 'Main Gate Security Desk'];
module.exports = { LOCATIONS, ALL_LOCATIONS: Object.values(LOCATIONS).flat(), CATEGORIES, MEETUP_POINTS };
