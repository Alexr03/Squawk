// How destinations are said on the radio: the city (or the airport where a city has several), never the ICAO code.
// Anything not listed falls back to its country from the ICAO prefix: "cleared to Greece" beats "Lima Golf five five".

const CITY: Record<string, string> = {
  // UK and Ireland
  EGLL: 'Heathrow', EGKK: 'Gatwick', EGSS: 'Stansted', EGGW: 'Luton', EGLC: 'London City', EGMC: 'Southend', EGLF: 'Farnborough', EGTF: 'Fairoaks',
  EGPH: 'Edinburgh', EGPF: 'Glasgow', EGPD: 'Aberdeen', EGPE: 'Inverness', EGPN: 'Dundee', EGPJ: 'Fife', EGAA: 'Belfast', EGAC: 'Belfast City',
  EGAE: 'Londonderry', EGAD: 'Newtownards', EGCC: 'Manchester', EGNT: 'Newcastle', EGNS: 'Isle of Man', EGNX: 'East Midlands', EGNM: 'Leeds Bradford',
  EGBB: 'Birmingham', EGGP: 'Liverpool', EGGD: 'Bristol', EGFF: 'Cardiff', EGHQ: 'Newquay', EGTE: 'Exeter', EGJJ: 'Jersey', EGJB: 'Guernsey',
  EGQB: 'Ballykelly', EGQL: 'Leuchars', EGQK: 'Kinloss', EGVN: 'Brize Norton', EGVO: 'Odiham', EGWU: 'Northolt', EGLM: 'White Waltham',
  EIDW: 'Dublin', EICK: 'Cork', EINN: 'Shannon', EIKN: 'Knock', EIKY: 'Kerry',
  // Western Europe
  EHAM: 'Amsterdam', EHRD: 'Rotterdam', EHEH: 'Eindhoven', EBBR: 'Brussels', EBMB: 'Melsbroek', EBLG: 'Liège', ELLX: 'Luxembourg',
  LFPG: 'Paris', LFPO: 'Paris Orly', LFPB: 'Le Bourget', LFMN: 'Nice', LFLL: 'Lyon', LFML: 'Marseille', LFBO: 'Toulouse', LFBD: 'Bordeaux',
  LFRS: 'Nantes', LFMT: 'Montpellier', LFRN: 'Rennes', LFSB: 'Basel', LFST: 'Strasbourg', LFLS: 'Grenoble', LFMD: 'Cannes', LFBT: 'Lourdes',
  LFBZ: 'Biarritz', LFRB: 'Brest', LFKJ: 'Ajaccio', LFRG: 'Deauville', LFMU: 'Béziers', LFMP: 'Perpignan', LFKB: 'Bastia',
  EDDF: 'Frankfurt', EDDM: 'Munich', EDDB: 'Berlin', EDDL: 'Düsseldorf', EDDH: 'Hamburg', EDDS: 'Stuttgart', EDDK: 'Cologne', EDDV: 'Hanover',
  EDDP: 'Leipzig', EDDN: 'Nuremberg', EDDW: 'Bremen', EDDG: 'Münster', EDFH: 'Hahn', EDLW: 'Dortmund', EDHL: 'Lübeck', EDPI: 'Ingolstadt', EDSB: 'Karlsruhe',
  EDMD: 'Dachau', EDHI: 'Hamburg Finkenwerder',
  LSZH: 'Zurich', LSGG: 'Geneva', LSZM: 'Basel', LSGP: 'La Côte', LOWW: 'Vienna', LOWS: 'Salzburg', LOWI: 'Innsbruck', LOWG: 'Graz', LOWL: 'Linz',
  // Iberia and the islands
  LEMD: 'Madrid', LEBL: 'Barcelona', LEMG: 'Malaga', LEPA: 'Palma', LEAL: 'Alicante', LEIB: 'Ibiza', LEZL: 'Seville', LEVC: 'Valencia', LEMH: 'Menorca',
  LEST: 'Santiago', LEBB: 'Bilbao', LEGE: 'Girona', LEAM: 'Almería', LESB: 'Son Bonet', LEMP: 'Mallorca', LEJR: 'Jerez', LEIG: 'Ibiza', LECO: 'A Coruña',
  LEAS: 'Asturias', LERS: 'Reus', LEDS: 'Seville', LELH: 'Huesca', LEOC: 'Ocaña', LEMR: 'Murcia', LEZG: 'Zaragoza', LESL: 'San Luis',
  GCRR: 'Lanzarote', GCFV: 'Fuerteventura', GCLP: 'Gran Canaria', GCTS: 'Tenerife', GCLB: 'La Gomera',
  LPPT: 'Lisbon', LPFR: 'Faro', LPPR: 'Porto', LPMA: 'Madeira', LPAR: 'Alverca', LPCS: 'Cascais', LPMT: 'Montijo', LPIN: 'Espinho',
  // Italy, Malta, Greece, Cyprus
  LIRF: 'Rome', LIRA: 'Rome Ciampino', LIML: 'Milan Linate', LIMC: 'Milan Malpensa', LIME: 'Bergamo', LIPZ: 'Venice', LIRP: 'Pisa', LIRQ: 'Florence',
  LIPE: 'Bologna', LIPX: 'Verona', LIMF: 'Turin', LIRN: 'Naples', LICC: 'Catania', LICJ: 'Palermo', LIEO: 'Olbia', LIEE: 'Cagliari', LIBD: 'Bari',
  LIBR: 'Brindisi', LIPQ: 'Trieste', LIMJ: 'Genoa', LIPR: 'Rimini', LIPB: 'Bolzano', LIQL: 'Lucca', LIBP: 'Pescara', LICA: 'Lamezia', LIRZ: 'Perugia',
  LIDT: 'Trento', LICZ: 'Sigonella', LIPY: 'Ancona', LIRM: 'Grazzanise', LILI: 'Vercelli',
  LMML: 'Malta', LCLK: 'Larnaca', LCPH: 'Paphos', LCEN: 'Ercan',
  LGAV: 'Athens', LGTS: 'Thessaloniki', LGRP: 'Rhodes', LGKO: 'Kos', LGSA: 'Chania', LGIR: 'Heraklion', LGZA: 'Zakynthos', LGMK: 'Mykonos', LGKF: 'Kefalonia',
  LGSK: 'Skiathos', LGPZ: 'Preveza', LGKN: 'Kalamata', LGKV: 'Kavala', LGMT: 'Mytilene', LGLM: 'Lemnos', LGRD: 'Rhodes Maritsa',
  // Nordics and Baltics
  EKCH: 'Copenhagen', EKBI: 'Billund', EKAH: 'Aarhus', ESSA: 'Stockholm', ESSB: 'Stockholm Bromma', ESGG: 'Gothenburg', ESOW: 'Västerås', ESGJ: 'Jönköping', ESGI: 'Gothenburg',
  ENGM: 'Oslo', ENBR: 'Bergen', ENZV: 'Stavanger', ENVA: 'Trondheim', ENTO: 'Sandefjord', EFHK: 'Helsinki', EFET: 'Enontekiö', BIKF: 'Keflavik',
  EVRA: 'Riga', EYVI: 'Vilnius', EYKA: 'Kaunas', EYPA: 'Palanga', EETN: 'Tallinn',
  // Central and Eastern Europe, Turkey
  EPWA: 'Warsaw', EPKK: 'Krakow', EPGD: 'Gdansk', EPKT: 'Katowice', EPWR: 'Wroclaw', EPPO: 'Poznan', EPSC: 'Szczecin', EPLL: 'Lodz', EPMO: 'Modlin', EPRZ: 'Rzeszow',
  EPBY: 'Bydgoszcz', EPKW: 'Bielsko-Biała', EPSW: 'Świdnik', EPRJ: 'Radom', LKPR: 'Prague', LKVO: 'Vodochody', LKTB: 'Brno', LZIB: 'Bratislava', LZKZ: 'Košice',
  LHBP: 'Budapest', LHDC: 'Debrecen', LROP: 'Bucharest', LRCL: 'Cluj', LRSM: 'Satu Mare', LRTR: 'Timișoara', LRAR: 'Arad', LRBC: 'Bacău',
  LBSF: 'Sofia', LBBG: 'Burgas', LBWV: 'Varna', LBSB: 'Sofia', LBLS: 'Lesnovo', LJLJ: 'Ljubljana', LDZA: 'Zagreb', LDDU: 'Dubrovnik', LDSP: 'Split', LDPL: 'Pula',
  LDZL: 'Lučko', LDZE: 'Zemunik', LDPM: 'Medulin', LDRI: 'Rijeka', LYBE: 'Belgrade', LWSK: 'Skopje', LATI: 'Tirana', UGTB: 'Tbilisi',
  LTFM: 'Istanbul', LTFJ: 'Istanbul Sabiha', LTBA: 'Istanbul Atatürk', LTAI: 'Antalya', LTBS: 'Dalaman', LTFE: 'Bodrum', LTBW: 'Istanbul Hezarfen', LTBK: 'Gaziemir', LTXE: 'Karaman',
  LLBG: 'Tel Aviv', OLBA: 'Beirut', OJAI: 'Amman',
  // Middle East, Africa, Asia, Oceania
  OMDB: 'Dubai', OMDW: 'Dubai World Central', OMAA: 'Abu Dhabi', OMSJ: 'Sharjah', OMAM: 'Al Dhafra', OMAF: 'Fujairah', OTHH: 'Doha', OTBD: 'Doha', OBBI: 'Bahrain',
  OERT: 'Ras Tanura', OEJN: 'Jeddah', OERK: 'Riyadh', OEDF: 'Dammam', OEDR: 'Dhahran', OEJF: 'Jeddah', OKBK: 'Kuwait', OPLA: 'Lahore',
  HECA: 'Cairo', HEEM: 'El Alamein', HEAZ: 'Almaza', HKJK: 'Nairobi', HKNW: 'Nairobi Wilson', FAOR: 'Johannesburg', FACT: 'Cape Town', FABB: 'Brakpan',
  FATA: 'Tedderfield', FAGM: 'Rand', GMMN: 'Casablanca', GMME: 'Rabat', GMMX: 'Marrakesh', GMTT: 'Tangier', DTNH: 'Enfidha', GBYD: 'Banjul', GOBD: 'Dakar',
  VIDP: 'Delhi', VABB: 'Mumbai', VOBL: 'Bangalore', VOMM: 'Chennai', VOHS: 'Hyderabad', VAJJ: 'Juhu', VOYK: 'Yelahanka', VTBS: 'Bangkok', WSSS: 'Singapore',
  WSAC: 'Changi East', WSAP: 'Paya Lebar', WMKK: 'Kuala Lumpur', WIDD: 'Batam', VHHH: 'Hong Kong', VMMC: 'Macau', RCTP: 'Taipei', RPLL: 'Manila',
  RJTT: 'Tokyo Haneda', RJAA: 'Tokyo Narita', RKSI: 'Seoul', ZBAA: 'Beijing', ZBTJ: 'Tianjin', ZGSZ: 'Shenzhen', ZGGG: 'Guangzhou', ZSPD: 'Shanghai',
  YSSY: 'Sydney', YPPH: 'Perth', YPAD: 'Adelaide', YMML: 'Melbourne', NZAA: 'Auckland',
  // The Americas
  KJFK: 'Kennedy', KEWR: 'Newark', KLGA: 'LaGuardia', KBOS: 'Boston', KIAD: 'Washington Dulles', KBWI: 'Baltimore', KPHL: 'Philadelphia', KORD: 'Chicago',
  KATL: 'Atlanta', KMIA: 'Miami', KMCO: 'Orlando', KTPA: 'Tampa', KDFW: 'Dallas', KIAH: 'Houston', KAUS: 'Austin', KDEN: 'Denver', KLAX: 'Los Angeles',
  KSFO: 'San Francisco', KSEA: 'Seattle', KLAS: 'Las Vegas', KPHX: 'Phoenix', KSAN: 'San Diego', KCLT: 'Charlotte', KMSP: 'Minneapolis', KDTW: 'Detroit',
  KBNA: 'Nashville', KRDU: 'Raleigh-Durham', KPIT: 'Pittsburgh', KCVG: 'Cincinnati', KSLC: 'Salt Lake City', KPDX: 'Portland', KMSY: 'New Orleans',
  KSTL: 'St Louis', KMEM: 'Memphis', KSDF: 'Louisville', KBDL: 'Hartford', KHPN: 'White Plains', KVNY: 'Van Nuys', KTTD: 'Troutdale', KMLB: 'Melbourne Florida',
  KOWD: 'Norwood', CYYZ: 'Toronto', CYUL: 'Montreal', CYVR: 'Vancouver', CYYC: 'Calgary', CYOW: 'Ottawa', CYHZ: 'Halifax', MMMX: 'Mexico City', MMUN: 'Cancún',
  TBPB: 'Barbados', TXKF: 'Bermuda', SBGR: 'São Paulo', SBGL: 'Rio de Janeiro', SBFZ: 'Fortaleza', SKBO: 'Bogotá', SCEL: 'Santiago de Chile',
};

const COUNTRY: [string, string][] = [
  ['EG', 'the United Kingdom'], ['EI', 'Ireland'], ['EH', 'the Netherlands'], ['EB', 'Belgium'], ['EL', 'Luxembourg'], ['LF', 'France'], ['ED', 'Germany'], ['ET', 'Germany'],
  ['LS', 'Switzerland'], ['LO', 'Austria'], ['LE', 'Spain'], ['GC', 'the Canaries'], ['LP', 'Portugal'], ['LI', 'Italy'], ['LM', 'Malta'], ['LG', 'Greece'], ['LC', 'Cyprus'],
  ['EK', 'Denmark'], ['ES', 'Sweden'], ['EN', 'Norway'], ['EF', 'Finland'], ['BI', 'Iceland'], ['EV', 'Latvia'], ['EY', 'Lithuania'], ['EE', 'Estonia'],
  ['EP', 'Poland'], ['LK', 'the Czech Republic'], ['LZ', 'Slovakia'], ['LH', 'Hungary'], ['LR', 'Romania'], ['LB', 'Bulgaria'], ['LJ', 'Slovenia'], ['LD', 'Croatia'],
  ['LY', 'Serbia'], ['LW', 'North Macedonia'], ['LA', 'Albania'], ['LQ', 'Bosnia'], ['UG', 'Georgia'], ['UK', 'Ukraine'], ['LT', 'Turkey'], ['LL', 'Israel'],
  ['OL', 'Lebanon'], ['OJ', 'Jordan'], ['OM', 'the Emirates'], ['OT', 'Qatar'], ['OB', 'Bahrain'], ['OE', 'Saudi Arabia'], ['OK', 'Kuwait'], ['OO', 'Oman'], ['OP', 'Pakistan'],
  ['HE', 'Egypt'], ['HK', 'Kenya'], ['FA', 'South Africa'], ['GM', 'Morocco'], ['DT', 'Tunisia'], ['DA', 'Algeria'], ['GB', 'the Gambia'], ['GO', 'Senegal'], ['DN', 'Nigeria'], ['DG', 'Ghana'],
  ['VI', 'India'], ['VA', 'India'], ['VO', 'India'], ['VE', 'India'], ['VT', 'Thailand'], ['WS', 'Singapore'], ['WM', 'Malaysia'], ['WI', 'Indonesia'], ['VH', 'Hong Kong'], ['VM', 'Macau'],
  ['RC', 'Taiwan'], ['RP', 'the Philippines'], ['RJ', 'Japan'], ['RK', 'Korea'], ['Z', 'China'], ['Y', 'Australia'], ['NZ', 'New Zealand'],
  ['K', 'the United States'], ['C', 'Canada'], ['MM', 'Mexico'], ['TB', 'Barbados'], ['TX', 'Bermuda'], ['SB', 'Brazil'], ['SK', 'Colombia'], ['SC', 'Chile'],
];

/** Radio name for a destination airport, or null when even the country is unknown. */
export function placeName(icao: string): string | null {
  if (CITY[icao]) return CITY[icao];
  if (!/^[A-Z]{2}/.test(icao) || icao === 'ZZZZ') return null;
  const c = COUNTRY.find(([p]) => icao.startsWith(p));
  return c ? c[1] : null;
}
