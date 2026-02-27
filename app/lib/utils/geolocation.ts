/**
 * Geolocation Utility
 * Get location from IP address using Cloudflare headers
 */

export interface LocationData {
  country: string;
  countryCode: string;
  region: string;
  city: string;
  latitude?: string;
  longitude?: string;
}

/**
 * Get location from request headers (Cloudflare)
 * Cloudflare automatically provides geo headers on Workers/Pages
 */
export function getLocationFromHeaders(request: Request): LocationData {
  // Cloudflare headers
  const cfCountry = request.headers.get('cf-ipcountry');
  const cfCity = request.headers.get('cf-ipcity');
  const cfRegion = request.headers.get('cf-region');
  const cfLatitude = request.headers.get('cf-iplatitude');
  const cfLongitude = request.headers.get('cf-iplongitude');
  
  if (cfCountry && cfCountry !== 'XX') {
    return {
      country: getCountryName(cfCountry),
      countryCode: cfCountry,
      region: cfRegion ? decodeHeader(cfRegion) : 'Unknown',
      city: cfCity ? decodeHeader(cfCity) : 'Unknown',
      latitude: cfLatitude || undefined,
      longitude: cfLongitude || undefined,
    };
  }
  
  // Development fallback
  if (process.env.NODE_ENV === 'development') {
    return {
      country: 'Local Development',
      countryCode: 'Local',
      region: 'Development',
      city: 'Localhost',
    };
  }
  
  return {
    country: 'Unknown',
    countryCode: 'Unknown',
    region: 'Unknown',
    city: 'Unknown',
  };
}

/**
 * Format location as string
 */
export function formatLocation(location: LocationData): string {
  const parts = [];
  
  if (location.city && location.city !== 'Unknown') parts.push(location.city);
  if (location.region && location.region !== 'Unknown') parts.push(location.region);
  if (location.countryCode && location.countryCode !== 'Unknown') parts.push(location.countryCode);
  
  return parts.length > 0 ? parts.join(', ') : 'Unknown';
}

/**
 * Format location for display (full country name)
 */
export function formatLocationDisplay(location: LocationData): string {
  const parts = [];
  
  if (location.city && location.city !== 'Unknown') parts.push(location.city);
  if (location.region && location.region !== 'Unknown') parts.push(location.region);
  if (location.country && location.country !== 'Unknown') parts.push(location.country);
  
  return parts.length > 0 ? parts.join(', ') : 'Unknown';
}

/**
 * Decode URL-encoded header value
 */
function decodeHeader(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch (e) {
    return value;
  }
}

/**
 * Get country flag emoji
 */
export function getCountryFlag(countryCode: string): string {
  if (!countryCode || countryCode === 'Unknown' || countryCode === 'Local') {
    return '🌍';
  }
  
  // Convert country code to flag emoji
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map(char => 127397 + char.charCodeAt(0));
  
  return String.fromCodePoint(...codePoints);
}

/**
 * Complete ISO 3166-1 alpha-2 country codes
 * All 249 officially assigned codes
 */
export const VALID_COUNTRY_CODES: Record<string, string> = {
  'AD': 'Andorra', 'AE': 'United Arab Emirates', 'AF': 'Afghanistan', 'AG': 'Antigua and Barbuda',
  'AI': 'Anguilla', 'AL': 'Albania', 'AM': 'Armenia', 'AO': 'Angola', 'AQ': 'Antarctica',
  'AR': 'Argentina', 'AS': 'American Samoa', 'AT': 'Austria', 'AU': 'Australia', 'AW': 'Aruba',
  'AX': 'Åland Islands', 'AZ': 'Azerbaijan', 'BA': 'Bosnia and Herzegovina', 'BB': 'Barbados',
  'BD': 'Bangladesh', 'BE': 'Belgium', 'BF': 'Burkina Faso', 'BG': 'Bulgaria', 'BH': 'Bahrain',
  'BI': 'Burundi', 'BJ': 'Benin', 'BL': 'Saint Barthélemy', 'BM': 'Bermuda', 'BN': 'Brunei',
  'BO': 'Bolivia', 'BQ': 'Caribbean Netherlands', 'BR': 'Brazil', 'BS': 'Bahamas', 'BT': 'Bhutan',
  'BV': 'Bouvet Island', 'BW': 'Botswana', 'BY': 'Belarus', 'BZ': 'Belize', 'CA': 'Canada',
  'CC': 'Cocos Islands', 'CD': 'DR Congo', 'CF': 'Central African Republic', 'CG': 'Congo',
  'CH': 'Switzerland', 'CI': 'Ivory Coast', 'CK': 'Cook Islands', 'CL': 'Chile', 'CM': 'Cameroon',
  'CN': 'China', 'CO': 'Colombia', 'CR': 'Costa Rica', 'CU': 'Cuba', 'CV': 'Cape Verde',
  'CW': 'Curaçao', 'CX': 'Christmas Island', 'CY': 'Cyprus', 'CZ': 'Czech Republic', 'DE': 'Germany',
  'DJ': 'Djibouti', 'DK': 'Denmark', 'DM': 'Dominica', 'DO': 'Dominican Republic', 'DZ': 'Algeria',
  'EC': 'Ecuador', 'EE': 'Estonia', 'EG': 'Egypt', 'EH': 'Western Sahara', 'ER': 'Eritrea',
  'ES': 'Spain', 'ET': 'Ethiopia', 'FI': 'Finland', 'FJ': 'Fiji', 'FK': 'Falkland Islands',
  'FM': 'Micronesia', 'FO': 'Faroe Islands', 'FR': 'France', 'GA': 'Gabon', 'GB': 'United Kingdom',
  'GD': 'Grenada', 'GE': 'Georgia', 'GF': 'French Guiana', 'GG': 'Guernsey', 'GH': 'Ghana',
  'GI': 'Gibraltar', 'GL': 'Greenland', 'GM': 'Gambia', 'GN': 'Guinea', 'GP': 'Guadeloupe',
  'GQ': 'Equatorial Guinea', 'GR': 'Greece', 'GS': 'South Georgia', 'GT': 'Guatemala', 'GU': 'Guam',
  'GW': 'Guinea-Bissau', 'GY': 'Guyana', 'HK': 'Hong Kong', 'HM': 'Heard Island', 'HN': 'Honduras',
  'HR': 'Croatia', 'HT': 'Haiti', 'HU': 'Hungary', 'ID': 'Indonesia', 'IE': 'Ireland',
  'IL': 'Israel', 'IM': 'Isle of Man', 'IN': 'India', 'IO': 'British Indian Ocean Territory',
  'IQ': 'Iraq', 'IR': 'Iran', 'IS': 'Iceland', 'IT': 'Italy', 'JE': 'Jersey', 'JM': 'Jamaica',
  'JO': 'Jordan', 'JP': 'Japan', 'KE': 'Kenya', 'KG': 'Kyrgyzstan', 'KH': 'Cambodia',
  'KI': 'Kiribati', 'KM': 'Comoros', 'KN': 'Saint Kitts and Nevis', 'KP': 'North Korea',
  'KR': 'South Korea', 'KW': 'Kuwait', 'KY': 'Cayman Islands', 'KZ': 'Kazakhstan', 'LA': 'Laos',
  'LB': 'Lebanon', 'LC': 'Saint Lucia', 'LI': 'Liechtenstein', 'LK': 'Sri Lanka', 'LR': 'Liberia',
  'LS': 'Lesotho', 'LT': 'Lithuania', 'LU': 'Luxembourg', 'LV': 'Latvia', 'LY': 'Libya',
  'MA': 'Morocco', 'MC': 'Monaco', 'MD': 'Moldova', 'ME': 'Montenegro', 'MF': 'Saint Martin',
  'MG': 'Madagascar', 'MH': 'Marshall Islands', 'MK': 'North Macedonia', 'ML': 'Mali',
  'MM': 'Myanmar', 'MN': 'Mongolia', 'MO': 'Macau', 'MP': 'Northern Mariana Islands',
  'MQ': 'Martinique', 'MR': 'Mauritania', 'MS': 'Montserrat', 'MT': 'Malta', 'MU': 'Mauritius',
  'MV': 'Maldives', 'MW': 'Malawi', 'MX': 'Mexico', 'MY': 'Malaysia', 'MZ': 'Mozambique',
  'NA': 'Namibia', 'NC': 'New Caledonia', 'NE': 'Niger', 'NF': 'Norfolk Island', 'NG': 'Nigeria',
  'NI': 'Nicaragua', 'NL': 'Netherlands', 'NO': 'Norway', 'NP': 'Nepal', 'NR': 'Nauru',
  'NU': 'Niue', 'NZ': 'New Zealand', 'OM': 'Oman', 'PA': 'Panama', 'PE': 'Peru',
  'PF': 'French Polynesia', 'PG': 'Papua New Guinea', 'PH': 'Philippines', 'PK': 'Pakistan',
  'PL': 'Poland', 'PM': 'Saint Pierre and Miquelon', 'PN': 'Pitcairn Islands', 'PR': 'Puerto Rico',
  'PS': 'Palestine', 'PT': 'Portugal', 'PW': 'Palau', 'PY': 'Paraguay', 'QA': 'Qatar',
  'RE': 'Réunion', 'RO': 'Romania', 'RS': 'Serbia', 'RU': 'Russia', 'RW': 'Rwanda',
  'SA': 'Saudi Arabia', 'SB': 'Solomon Islands', 'SC': 'Seychelles', 'SD': 'Sudan',
  'SE': 'Sweden', 'SG': 'Singapore', 'SH': 'Saint Helena', 'SI': 'Slovenia', 'SJ': 'Svalbard',
  'SK': 'Slovakia', 'SL': 'Sierra Leone', 'SM': 'San Marino', 'SN': 'Senegal', 'SO': 'Somalia',
  'SR': 'Suriname', 'SS': 'South Sudan', 'ST': 'São Tomé and Príncipe', 'SV': 'El Salvador',
  'SX': 'Sint Maarten', 'SY': 'Syria', 'SZ': 'Eswatini', 'TC': 'Turks and Caicos',
  'TD': 'Chad', 'TF': 'French Southern Territories', 'TG': 'Togo', 'TH': 'Thailand',
  'TJ': 'Tajikistan', 'TK': 'Tokelau', 'TL': 'Timor-Leste', 'TM': 'Turkmenistan', 'TN': 'Tunisia',
  'TO': 'Tonga', 'TR': 'Turkey', 'TT': 'Trinidad and Tobago', 'TV': 'Tuvalu', 'TW': 'Taiwan',
  'TZ': 'Tanzania', 'UA': 'Ukraine', 'UG': 'Uganda', 'UM': 'US Minor Outlying Islands',
  'US': 'United States', 'UY': 'Uruguay', 'UZ': 'Uzbekistan', 'VA': 'Vatican City',
  'VC': 'Saint Vincent and the Grenadines', 'VE': 'Venezuela', 'VG': 'British Virgin Islands',
  'VI': 'US Virgin Islands', 'VN': 'Vietnam', 'VU': 'Vanuatu', 'WF': 'Wallis and Futuna',
  'WS': 'Samoa', 'XK': 'Kosovo', 'YE': 'Yemen', 'YT': 'Mayotte', 'ZA': 'South Africa',
  'ZM': 'Zambia', 'ZW': 'Zimbabwe',
  // Special codes
  'Local': 'Local Development', 'XX': 'Unknown',
};

/**
 * Check if a code is a valid ISO country code
 */
export function isValidCountryCode(code: string): boolean {
  if (!code || code.length !== 2) return false;
  return code.toUpperCase() in VALID_COUNTRY_CODES;
}

/**
 * Get country name from ISO 3166-1 alpha-2 code
 */
export function getCountryName(code: string): string {
  if (!code) return 'Unknown';
  const upperCode = code.toUpperCase();
  return VALID_COUNTRY_CODES[upperCode] || code;
}

/**
 * Extract just the country code for database storage
 */
export function getCountryCode(location: LocationData): string {
  return location.countryCode || 'Unknown';
}
