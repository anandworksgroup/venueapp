// Offline gazetteer for Delhi NCR (launch region). Centroids are approximate
// and exist so the platform works without a geocoding API; in production,
// import authoritative area boundaries/pincodes and keep this as a fallback.
// [id, name, pincode, lat, lng, radius_km, aliases]

export const CITIES = [
  { id: 'faridabad', name: 'Faridabad', state: 'Haryana', lat: 28.4089, lng: 77.3178 },
  { id: 'delhi', name: 'New Delhi', state: 'Delhi', lat: 28.6139, lng: 77.209 },
  { id: 'noida', name: 'Noida', state: 'Uttar Pradesh', lat: 28.5355, lng: 77.391 },
  { id: 'greater-noida', name: 'Greater Noida', state: 'Uttar Pradesh', lat: 28.4744, lng: 77.504 },
  { id: 'gurugram', name: 'Gurugram', state: 'Haryana', lat: 28.4595, lng: 77.0266 },
  { id: 'ghaziabad', name: 'Ghaziabad', state: 'Uttar Pradesh', lat: 28.6692, lng: 77.4538 },
];

export const AREAS = {
  faridabad: [
    ['sector-9', 'Sector 9', '121006', 28.3847, 77.3339, 1.0],
    ['sector-11', 'Sector 11', '121006', 28.3905, 77.3162, 1.0],
    ['sector-14', 'Sector 14', '121007', 28.3988, 77.3131, 1.0],
    ['sector-15', 'Sector 15', '121007', 28.3947, 77.3255, 1.0],
    ['sector-16', 'Sector 16', '121002', 28.4097, 77.3197, 1.0],
    ['sector-17', 'Sector 17', '121002', 28.4036, 77.331, 1.0],
    ['sector-21', 'Sector 21', '121001', 28.4235, 77.3015, 1.4, ['sector 21a', 'sector 21b', 'sector 21c', 'sector 21d']],
    ['sector-28', 'Sector 28', '121008', 28.4402, 77.3102, 1.0],
    ['sector-31', 'Sector 31', '121003', 28.4521, 77.3148, 1.0],
    ['sector-37', 'Sector 37', '121003', 28.4695, 77.3083, 1.2],
    ['sector-46', 'Sector 46', '121010', 28.4452, 77.2881, 1.0],
    ['sector-81', 'Sector 81', '121002', 28.383, 77.382, 1.2],
    ['sector-86', 'Sector 86', '121002', 28.404, 77.393, 1.2],
    ['sector-88', 'Sector 88', '121002', 28.416, 77.39, 1.2],
    ['nit', 'NIT Faridabad', '121001', 28.386, 77.295, 1.8, ['nit', 'nit faridabad', 'new industrial township']],
    ['old-faridabad', 'Old Faridabad', '121002', 28.411, 77.311, 1.2],
    ['ballabgarh', 'Ballabgarh', '121004', 28.341, 77.326, 2.5],
    ['greater-faridabad', 'Greater Faridabad', '121002', 28.395, 77.38, 3.5, ['neharpar', 'greater fbd']],
    ['surajkund', 'Surajkund', '121009', 28.484, 77.284, 1.8],
    ['badkhal', 'Badkhal', '121001', 28.4172, 77.2748, 1.5],
  ],
  delhi: [
    ['saket', 'Saket', '110017', 28.5245, 77.2066, 1.5],
    ['chhattarpur', 'Chhattarpur', '110074', 28.499, 77.179, 2.5, ['chattarpur']],
    ['mehrauli', 'Mehrauli', '110030', 28.5244, 77.1855, 1.5],
    ['lajpat-nagar', 'Lajpat Nagar', '110024', 28.5677, 77.2433, 1.3],
    ['sarita-vihar', 'Sarita Vihar', '110076', 28.531, 77.289, 1.2],
    ['badarpur', 'Badarpur', '110044', 28.494, 77.303, 1.5],
    ['rajouri-garden', 'Rajouri Garden', '110027', 28.6415, 77.121, 1.5],
    ['kirti-nagar', 'Kirti Nagar', '110015', 28.6554, 77.1419, 1.3],
    ['dwarka', 'Dwarka', '110075', 28.5921, 77.046, 3.5],
    ['pitampura', 'Pitampura', '110034', 28.702, 77.131, 1.5],
  ],
  noida: [
    ['noida-sector-18', 'Sector 18', '201301', 28.57, 77.326, 1.0],
    ['noida-sector-50', 'Sector 50', '201301', 28.572, 77.364, 1.0],
    ['noida-sector-62', 'Sector 62', '201309', 28.627, 77.365, 1.4],
    ['noida-sector-135', 'Sector 135', '201304', 28.492, 77.404, 1.5],
  ],
  'greater-noida': [
    ['pari-chowk', 'Pari Chowk', '201310', 28.4655, 77.5118, 1.5],
    ['knowledge-park', 'Knowledge Park', '201310', 28.4704, 77.4903, 1.8],
  ],
  gurugram: [
    ['mg-road', 'MG Road', '122002', 28.48, 77.08, 1.5],
    ['sohna-road', 'Sohna Road', '122018', 28.405, 77.045, 2.5],
    ['dlf-phase-3', 'DLF Phase 3', '122002', 28.494, 77.093, 1.2],
    ['gurugram-sector-29', 'Sector 29', '122001', 28.468, 77.062, 1.0],
    ['golf-course-road', 'Golf Course Road', '122002', 28.448, 77.1, 2.0],
    ['manesar', 'Manesar', '122051', 28.354, 76.937, 3.0],
  ],
  ghaziabad: [
    ['indirapuram', 'Indirapuram', '201014', 28.6415, 77.3712, 1.8],
    ['vaishali', 'Vaishali', '201010', 28.649, 77.339, 1.3],
    ['raj-nagar-extension', 'Raj Nagar Extension', '201017', 28.696, 77.425, 2.0],
  ],
};
