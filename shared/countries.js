// Countries for anything that ships or meets (the market's listings): ISO
// 3166-1 alpha-2 codes, the EU's members, and the two destinations that are
// not countries, `EU` (every member state) and `WW` (worldwide). Names come
// from the browser in the page's language (Intl.DisplayNames), so no list of
// names is kept here.
//
//   destinationsFor('AT')   → ['AT', 'EU', 'WW']: what a listing must ship to for a buyer in Austria
//   countryName('DE', 'fr') → 'Allemagne'

export const COUNTRIES = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM ' +
  'CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY ' +
  'HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF ' +
  'MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE ' +
  'RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ ' +
  'VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' ');

/** The member states of the European Union. */
export const EU = 'AT BE BG CY CZ DE DK EE ES FI FR GR HR HU IE IT LT LU LV MT NL PL PT RO SE SI SK'.split(' ');

/** Destinations that are not one country. */
export const REGIONS = ['EU', 'WW'];

export const isCountry = (code) => COUNTRIES.includes(code);
/** A country, or one of the regions a listing may ship to. */
export const isDestination = (code) => isCountry(code) || REGIONS.includes(code);

/** What a listing must ship to for a buyer in `country`: the country itself, the EU when it is a member, worldwide. */
export function destinationsFor(country) {
  if (!isCountry(country)) return [];
  return [country, ...(EU.includes(country) ? ['EU'] : []), 'WW'];
}

const names = new Map();
/** A country's name in `lang` (the browser's own names); the code when the browser has none. */
export function countryName(code, lang = 'en') {
  const key = `${lang}`;
  let dn = names.get(key);
  if (dn === undefined) {
    try {
      dn = new Intl.DisplayNames([lang], { type: 'region' });
    } catch {
      dn = null;
    }
    names.set(key, dn);
  }
  try {
    return dn?.of(code) || code;
  } catch {
    return code;
  }
}

/** Every country, sorted by its name in `lang`. */
export const countriesByName = (lang = 'en') =>
  COUNTRIES.map((code) => ({ code, name: countryName(code, lang) })).sort((a, b) => a.name.localeCompare(b.name, lang));
