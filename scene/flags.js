// Country -> flag emoji, shared by the 3D store and the vendor site.
export const FLAGS = {
  'United States': '🇺🇸', 'Mexico': '🇲🇽', 'Japan': '🇯🇵', 'South Korea': '🇰🇷', 'China': '🇨🇳', 'Taiwan': '🇹🇼',
  'United Kingdom': '🇬🇧', 'Germany': '🇩🇪', 'Canada': '🇨🇦', 'India': '🇮🇳', 'Australia': '🇦🇺', 'Turkey': '🇹🇷',
  'France': '🇫🇷', 'Thailand': '🇹🇭', 'Poland': '🇵🇱', 'Sweden': '🇸🇪', 'Brazil': '🇧🇷', 'Indonesia': '🇮🇩',
  'Vietnam': '🇻🇳', 'Spain': '🇪🇸', 'Egypt': '🇪🇬', 'Italy': '🇮🇹', 'UAE': '🇦🇪', 'United Arab Emirates': '🇦🇪',
  'Netherlands': '🇳🇱', 'Malaysia': '🇲🇾', 'Greece': '🇬🇷', 'New Zealand': '🇳🇿', 'Ukraine': '🇺🇦', 'Belgium': '🇧🇪',
  'Croatia': '🇭🇷', 'Lebanon': '🇱🇧', 'Pakistan': '🇵🇰', 'Bulgaria': '🇧🇬', 'Nepal': '🇳🇵', 'Austria': '🇦🇹',
  'Bosnia': '🇧🇦', 'Bosnia and Herzegovina': '🇧🇦', 'Denmark': '🇩🇰', 'Ireland': '🇮🇪', 'Israel': '🇮🇱', 'Serbia': '🇷🇸',
  'Cyprus': '🇨🇾', 'Czech Republic': '🇨🇿', 'Czechia': '🇨🇿', 'Honduras': '🇭🇳', 'Hong Kong': '🇭🇰', 'Romania': '🇷🇴',
  'Singapore': '🇸🇬', 'Switzerland': '🇨🇭', 'Philippines': '🇵🇭', 'Russia': '🇷🇺', 'Portugal': '🇵🇹', 'Peru': '🇵🇪',
  'Colombia': '🇨🇴', 'Saudi Arabia': '🇸🇦', 'South Africa': '🇿🇦', 'Morocco': '🇲🇦', 'Finland': '🇫🇮', 'Hungary': '🇭🇺',
  'Iraq': '🇮🇶', 'Jordan': '🇯🇴', 'Guatemala': '🇬🇹', 'Bangladesh': '🇧🇩', 'Barbados': '🇧🇧', 'Trinidad and Tobago': '🇹🇹',
  'Argentina': '🇦🇷', 'Chile': '🇨🇱', 'Jamaica': '🇯🇲', 'Nigeria': '🇳🇬', 'Ghana': '🇬🇭', 'Iran': '🇮🇷', 'Norway': '🇳🇴',
};
export function flagFor(country) { return (country && FLAGS[country]) || ''; }
export const CATEGORY_LABELS = {
  candy: 'Candy', chips: 'Chips', chocolate: 'Chocolate', cookies: 'Cookies', drinks: 'Drinks',
  cereal: 'Cereal', noodles: 'Ramen & Noodles', pickles: 'Pickles', sparkling: 'Sparkling Water',
  mystery: 'Mystery Box', new: 'New Arrivals',
};
export function categoryLabel(key) { return CATEGORY_LABELS[key] || key; }
