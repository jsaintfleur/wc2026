export interface Venue {
  common: string;
  fifa: string;
  city: string;
  country: string;
  cap: number;
}

export interface GroupStageMatch {
  no: number;
  iso: string;
  local: string;
  et: string;
  g: string;
  t1: string;
  t2: string;
  v: string;
  ts: number;
  dbStatus?: string;
  dbElapsed?: number | null;
  dbGh?: number | null;
  dbGa?: number | null;
  dbEvents?: MatchEvent[];
  dbStats?: MatchStats;
  dbLineups?: TeamLineup[];
  dbPlayers?: PlayerMatchStat[];
  dbReferee?: string | null;
  dbFixtureId?: number | null;
}

export interface KnockoutMatch {
  round: string;
  mr: string;
  iso: string;
  local: string;
  et: string;
  v: string;
  ts: number;
}

export interface TournamentData {
  venues: Record<string, Venue>;
  groups: Record<string, string[]>;
  hosts: string[];
  gs: GroupStageMatch[];
  ko: KnockoutMatch[];
  flags: Record<string, string>;
  gcolor: Record<string, string>;
  starts: number[];
}

export const DATA: TournamentData = {"venues": {"AZT": {"common": "Estadio Azteca", "fifa": "Mexico City Stadium", "city": "Mexico City", "country": "Mexico", "cap": 83000}, "AKR": {"common": "Estadio Akron", "fifa": "Estadio Guadalajara", "city": "Guadalajara", "country": "Mexico", "cap": 48000}, "BBVA": {"common": "Estadio BBVA", "fifa": "Estadio Monterrey", "city": "Monterrey", "country": "Mexico", "cap": 53500}, "BMO": {"common": "BMO Field", "fifa": "Toronto Stadium", "city": "Toronto", "country": "Canada", "cap": 45000}, "BCP": {"common": "BC Place", "fifa": "BC Place Vancouver", "city": "Vancouver", "country": "Canada", "cap": 54000}, "SOFI": {"common": "SoFi Stadium", "fifa": "Los Angeles Stadium", "city": "Los Angeles", "country": "USA", "cap": 70000}, "LEVI": {"common": "Levi's Stadium", "fifa": "San Francisco Bay Area Stadium", "city": "SF Bay Area", "country": "USA", "cap": 71000}, "LUMEN": {"common": "Lumen Field", "fifa": "Seattle Stadium", "city": "Seattle", "country": "USA", "cap": 69000}, "METLIFE": {"common": "MetLife Stadium", "fifa": "New York New Jersey Stadium", "city": "New York / New Jersey", "country": "USA", "cap": 82500}, "GILLETTE": {"common": "Gillette Stadium", "fifa": "Boston Stadium", "city": "Boston", "country": "USA", "cap": 65000}, "LINC": {"common": "Lincoln Financial Field", "fifa": "Philadelphia Stadium", "city": "Philadelphia", "country": "USA", "cap": 69000}, "MBS": {"common": "Mercedes-Benz Stadium", "fifa": "Atlanta Stadium", "city": "Atlanta", "country": "USA", "cap": 75000}, "HARDROCK": {"common": "Hard Rock Stadium", "fifa": "Miami Stadium", "city": "Miami", "country": "USA", "cap": 65000}, "ATT": {"common": "AT&T Stadium", "fifa": "Dallas Stadium", "city": "Dallas", "country": "USA", "cap": 94000}, "NRG": {"common": "NRG Stadium", "fifa": "Houston Stadium", "city": "Houston", "country": "USA", "cap": 72000}, "ARROW": {"common": "Arrowhead Stadium", "fifa": "Kansas City Stadium", "city": "Kansas City", "country": "USA", "cap": 73000}}, "groups": {"A": ["Mexico", "South Africa", "South Korea", "Czechia"], "B": ["Canada", "Bosnia & Herzegovina", "Qatar", "Switzerland"], "C": ["Brazil", "Morocco", "Haiti", "Scotland"], "D": ["United States", "Paraguay", "Australia", "Türkiye"], "E": ["Germany", "Curaçao", "Ivory Coast", "Ecuador"], "F": ["Netherlands", "Japan", "Sweden", "Tunisia"], "G": ["Belgium", "Egypt", "Iran", "New Zealand"], "H": ["Spain", "Cape Verde", "Saudi Arabia", "Uruguay"], "I": ["France", "Senegal", "Iraq", "Norway"], "J": ["Argentina", "Algeria", "Austria", "Jordan"], "K": ["Portugal", "DR Congo", "Uzbekistan", "Colombia"], "L": ["England", "Croatia", "Ghana", "Panama"]}, "hosts": ["Canada", "Mexico", "United States"], "gs": [{"no": 1, "iso": "2026-06-11", "local": "1:00 PM CST", "et": "3:00 PM ET", "g": "A", "t1": "Mexico", "t2": "South Africa", "v": "AZT", "ts": 1781204400000}, {"no": 2, "iso": "2026-06-11", "local": "8:00 PM CST", "et": "10:00 PM ET", "g": "A", "t1": "South Korea", "t2": "Czechia", "v": "AKR", "ts": 1781229600000}, {"no": 3, "iso": "2026-06-12", "local": "3:00 PM ET", "et": "3:00 PM ET", "g": "B", "t1": "Canada", "t2": "Bosnia & Herzegovina", "v": "BMO", "ts": 1781290800000}, {"no": 4, "iso": "2026-06-12", "local": "6:00 PM PT", "et": "9:00 PM ET", "g": "D", "t1": "United States", "t2": "Paraguay", "v": "SOFI", "ts": 1781312400000}, {"no": 5, "iso": "2026-06-13", "local": "12:00 PM PT", "et": "3:00 PM ET", "g": "B", "t1": "Qatar", "t2": "Switzerland", "v": "LEVI", "ts": 1781377200000}, {"no": 6, "iso": "2026-06-13", "local": "6:00 PM ET", "et": "6:00 PM ET", "g": "C", "t1": "Brazil", "t2": "Morocco", "v": "METLIFE", "ts": 1781388000000}, {"no": 7, "iso": "2026-06-13", "local": "9:00 PM ET", "et": "9:00 PM ET", "g": "C", "t1": "Haiti", "t2": "Scotland", "v": "GILLETTE", "ts": 1781398800000}, {"no": 8, "iso": "2026-06-13", "local": "9:00 PM PT", "et": "12:00 AM ET", "g": "D", "t1": "Australia", "t2": "Türkiye", "v": "BCP", "ts": 1781409600000}, {"no": 9, "iso": "2026-06-14", "local": "12:00 PM CDT", "et": "1:00 PM ET", "g": "E", "t1": "Germany", "t2": "Curaçao", "v": "NRG", "ts": 1781456400000}, {"no": 10, "iso": "2026-06-14", "local": "3:00 PM CDT", "et": "4:00 PM ET", "g": "F", "t1": "Netherlands", "t2": "Japan", "v": "ATT", "ts": 1781467200000}, {"no": 11, "iso": "2026-06-14", "local": "7:00 PM ET", "et": "7:00 PM ET", "g": "E", "t1": "Ivory Coast", "t2": "Ecuador", "v": "LINC", "ts": 1781478000000}, {"no": 12, "iso": "2026-06-14", "local": "8:00 PM CST", "et": "10:00 PM ET", "g": "F", "t1": "Sweden", "t2": "Tunisia", "v": "BBVA", "ts": 1781488800000}, {"no": 13, "iso": "2026-06-15", "local": "12:00 PM ET", "et": "12:00 PM ET", "g": "H", "t1": "Spain", "t2": "Cape Verde", "v": "MBS", "ts": 1781539200000}, {"no": 14, "iso": "2026-06-15", "local": "12:00 PM PT", "et": "3:00 PM ET", "g": "G", "t1": "Belgium", "t2": "Egypt", "v": "LUMEN", "ts": 1781550000000}, {"no": 15, "iso": "2026-06-15", "local": "6:00 PM ET", "et": "6:00 PM ET", "g": "H", "t1": "Saudi Arabia", "t2": "Uruguay", "v": "HARDROCK", "ts": 1781560800000}, {"no": 16, "iso": "2026-06-15", "local": "6:00 PM PT", "et": "9:00 PM ET", "g": "G", "t1": "Iran", "t2": "New Zealand", "v": "SOFI", "ts": 1781571600000}, {"no": 17, "iso": "2026-06-16", "local": "3:00 PM ET", "et": "3:00 PM ET", "g": "I", "t1": "France", "t2": "Senegal", "v": "METLIFE", "ts": 1781636400000}, {"no": 18, "iso": "2026-06-16", "local": "6:00 PM ET", "et": "6:00 PM ET", "g": "I", "t1": "Iraq", "t2": "Norway", "v": "GILLETTE", "ts": 1781647200000}, {"no": 19, "iso": "2026-06-16", "local": "8:00 PM CDT", "et": "9:00 PM ET", "g": "J", "t1": "Argentina", "t2": "Algeria", "v": "ARROW", "ts": 1781658000000}, {"no": 20, "iso": "2026-06-16", "local": "9:00 PM PT", "et": "12:00 AM ET", "g": "J", "t1": "Austria", "t2": "Jordan", "v": "LEVI", "ts": 1781668800000}, {"no": 21, "iso": "2026-06-17", "local": "12:00 PM CDT", "et": "1:00 PM ET", "g": "K", "t1": "Portugal", "t2": "DR Congo", "v": "NRG", "ts": 1781715600000}, {"no": 22, "iso": "2026-06-17", "local": "3:00 PM CDT", "et": "4:00 PM ET", "g": "L", "t1": "England", "t2": "Croatia", "v": "ATT", "ts": 1781726400000}, {"no": 23, "iso": "2026-06-17", "local": "7:00 PM ET", "et": "7:00 PM ET", "g": "L", "t1": "Ghana", "t2": "Panama", "v": "BMO", "ts": 1781737200000}, {"no": 24, "iso": "2026-06-17", "local": "8:00 PM CST", "et": "10:00 PM ET", "g": "K", "t1": "Uzbekistan", "t2": "Colombia", "v": "AZT", "ts": 1781748000000}, {"no": 25, "iso": "2026-06-18", "local": "12:00 PM ET", "et": "12:00 PM ET", "g": "A", "t1": "Czechia", "t2": "South Africa", "v": "MBS", "ts": 1781798400000}, {"no": 26, "iso": "2026-06-18", "local": "12:00 PM PT", "et": "3:00 PM ET", "g": "B", "t1": "Switzerland", "t2": "Bosnia & Herzegovina", "v": "SOFI", "ts": 1781809200000}, {"no": 27, "iso": "2026-06-18", "local": "3:00 PM PT", "et": "6:00 PM ET", "g": "B", "t1": "Canada", "t2": "Qatar", "v": "BCP", "ts": 1781820000000}, {"no": 28, "iso": "2026-06-18", "local": "7:00 PM CST", "et": "9:00 PM ET", "g": "A", "t1": "Mexico", "t2": "South Korea", "v": "AKR", "ts": 1781830800000}, {"no": 29, "iso": "2026-06-19", "local": "12:00 PM PT", "et": "3:00 PM ET", "g": "D", "t1": "United States", "t2": "Australia", "v": "LUMEN", "ts": 1781895600000}, {"no": 30, "iso": "2026-06-19", "local": "6:00 PM ET", "et": "6:00 PM ET", "g": "C", "t1": "Scotland", "t2": "Morocco", "v": "GILLETTE", "ts": 1781906400000}, {"no": 31, "iso": "2026-06-19", "local": "8:30 PM ET", "et": "8:30 PM ET", "g": "C", "t1": "Brazil", "t2": "Haiti", "v": "LINC", "ts": 1781915400000}, {"no": 32, "iso": "2026-06-19", "local": "9:00 PM PT", "et": "12:00 AM ET", "g": "D", "t1": "Türkiye", "t2": "Paraguay", "v": "LEVI", "ts": 1781928000000}, {"no": 33, "iso": "2026-06-20", "local": "12:00 PM CDT", "et": "1:00 PM ET", "g": "F", "t1": "Netherlands", "t2": "Sweden", "v": "NRG", "ts": 1781974800000}, {"no": 34, "iso": "2026-06-20", "local": "4:00 PM ET", "et": "4:00 PM ET", "g": "E", "t1": "Germany", "t2": "Ivory Coast", "v": "BMO", "ts": 1781985600000}, {"no": 35, "iso": "2026-06-20", "local": "7:00 PM CDT", "et": "8:00 PM ET", "g": "E", "t1": "Ecuador", "t2": "Curaçao", "v": "ARROW", "ts": 1782000000000}, {"no": 36, "iso": "2026-06-20", "local": "10:00 PM CST", "et": "12:00 AM ET", "g": "F", "t1": "Tunisia", "t2": "Japan", "v": "BBVA", "ts": 1782014400000}, {"no": 37, "iso": "2026-06-21", "local": "12:00 PM ET", "et": "12:00 PM ET", "g": "H", "t1": "Spain", "t2": "Saudi Arabia", "v": "MBS", "ts": 1782057600000}, {"no": 38, "iso": "2026-06-21", "local": "12:00 PM PT", "et": "3:00 PM ET", "g": "G", "t1": "Belgium", "t2": "Iran", "v": "SOFI", "ts": 1782068400000}, {"no": 39, "iso": "2026-06-21", "local": "6:00 PM ET", "et": "6:00 PM ET", "g": "H", "t1": "Uruguay", "t2": "Cape Verde", "v": "HARDROCK", "ts": 1782079200000}, {"no": 40, "iso": "2026-06-21", "local": "6:00 PM PT", "et": "9:00 PM ET", "g": "G", "t1": "New Zealand", "t2": "Egypt", "v": "BCP", "ts": 1782090000000}, {"no": 41, "iso": "2026-06-22", "local": "12:00 PM CDT", "et": "1:00 PM ET", "g": "J", "t1": "Argentina", "t2": "Austria", "v": "ATT", "ts": 1782147600000}, {"no": 42, "iso": "2026-06-22", "local": "5:00 PM ET", "et": "5:00 PM ET", "g": "I", "t1": "France", "t2": "Iraq", "v": "LINC", "ts": 1782162000000}, {"no": 43, "iso": "2026-06-22", "local": "8:00 PM ET", "et": "8:00 PM ET", "g": "I", "t1": "Norway", "t2": "Senegal", "v": "METLIFE", "ts": 1782172800000}, {"no": 44, "iso": "2026-06-22", "local": "8:00 PM PT", "et": "11:00 PM ET", "g": "J", "t1": "Jordan", "t2": "Algeria", "v": "LEVI", "ts": 1782183600000}, {"no": 45, "iso": "2026-06-23", "local": "12:00 PM CDT", "et": "1:00 PM ET", "g": "K", "t1": "Portugal", "t2": "Uzbekistan", "v": "NRG", "ts": 1782234000000}, {"no": 46, "iso": "2026-06-23", "local": "4:00 PM ET", "et": "4:00 PM ET", "g": "L", "t1": "England", "t2": "Ghana", "v": "GILLETTE", "ts": 1782244800000}, {"no": 47, "iso": "2026-06-23", "local": "7:00 PM ET", "et": "7:00 PM ET", "g": "L", "t1": "Panama", "t2": "Croatia", "v": "BMO", "ts": 1782255600000}, {"no": 48, "iso": "2026-06-23", "local": "8:00 PM CST", "et": "10:00 PM ET", "g": "K", "t1": "Colombia", "t2": "DR Congo", "v": "AKR", "ts": 1782266400000}, {"no": 49, "iso": "2026-06-24", "local": "12:00 PM PT", "et": "3:00 PM ET", "g": "B", "t1": "Switzerland", "t2": "Canada", "v": "BCP", "ts": 1782327600000}, {"no": 50, "iso": "2026-06-24", "local": "12:00 PM PT", "et": "3:00 PM ET", "g": "B", "t1": "Bosnia & Herzegovina", "t2": "Qatar", "v": "LUMEN", "ts": 1782327600000}, {"no": 51, "iso": "2026-06-24", "local": "6:00 PM ET", "et": "6:00 PM ET", "g": "C", "t1": "Scotland", "t2": "Brazil", "v": "HARDROCK", "ts": 1782338400000}, {"no": 52, "iso": "2026-06-24", "local": "6:00 PM ET", "et": "6:00 PM ET", "g": "C", "t1": "Morocco", "t2": "Haiti", "v": "MBS", "ts": 1782338400000}, {"no": 53, "iso": "2026-06-24", "local": "7:00 PM CST", "et": "9:00 PM ET", "g": "A", "t1": "Czechia", "t2": "Mexico", "v": "AZT", "ts": 1782349200000}, {"no": 54, "iso": "2026-06-24", "local": "7:00 PM CST", "et": "9:00 PM ET", "g": "A", "t1": "South Africa", "t2": "South Korea", "v": "BBVA", "ts": 1782349200000}, {"no": 55, "iso": "2026-06-25", "local": "4:00 PM ET", "et": "4:00 PM ET", "g": "E", "t1": "Ecuador", "t2": "Germany", "v": "METLIFE", "ts": 1782417600000}, {"no": 56, "iso": "2026-06-25", "local": "4:00 PM ET", "et": "4:00 PM ET", "g": "E", "t1": "Curaçao", "t2": "Ivory Coast", "v": "LINC", "ts": 1782417600000}, {"no": 57, "iso": "2026-06-25", "local": "6:00 PM CDT", "et": "7:00 PM ET", "g": "F", "t1": "Japan", "t2": "Sweden", "v": "ATT", "ts": 1782428400000}, {"no": 58, "iso": "2026-06-25", "local": "6:00 PM CDT", "et": "7:00 PM ET", "g": "F", "t1": "Tunisia", "t2": "Netherlands", "v": "ARROW", "ts": 1782428400000}, {"no": 59, "iso": "2026-06-25", "local": "7:00 PM PT", "et": "10:00 PM ET", "g": "D", "t1": "Türkiye", "t2": "United States", "v": "SOFI", "ts": 1782439200000}, {"no": 60, "iso": "2026-06-25", "local": "7:00 PM PT", "et": "10:00 PM ET", "g": "D", "t1": "Paraguay", "t2": "Australia", "v": "LEVI", "ts": 1782439200000}, {"no": 61, "iso": "2026-06-26", "local": "3:00 PM ET", "et": "3:00 PM ET", "g": "I", "t1": "Norway", "t2": "France", "v": "GILLETTE", "ts": 1782500400000}, {"no": 62, "iso": "2026-06-26", "local": "3:00 PM ET", "et": "3:00 PM ET", "g": "I", "t1": "Senegal", "t2": "Iraq", "v": "BMO", "ts": 1782500400000}, {"no": 63, "iso": "2026-06-26", "local": "7:00 PM CDT", "et": "8:00 PM ET", "g": "H", "t1": "Cape Verde", "t2": "Saudi Arabia", "v": "NRG", "ts": 1782518400000}, {"no": 64, "iso": "2026-06-26", "local": "6:00 PM CST", "et": "8:00 PM ET", "g": "H", "t1": "Uruguay", "t2": "Spain", "v": "AKR", "ts": 1782518400000}, {"no": 65, "iso": "2026-06-26", "local": "8:00 PM PT", "et": "11:00 PM ET", "g": "G", "t1": "Egypt", "t2": "Iran", "v": "LUMEN", "ts": 1782529200000}, {"no": 66, "iso": "2026-06-26", "local": "8:00 PM PT", "et": "11:00 PM ET", "g": "G", "t1": "New Zealand", "t2": "Belgium", "v": "BCP", "ts": 1782529200000}, {"no": 67, "iso": "2026-06-27", "local": "5:00 PM ET", "et": "5:00 PM ET", "g": "L", "t1": "Panama", "t2": "England", "v": "METLIFE", "ts": 1782594000000}, {"no": 68, "iso": "2026-06-27", "local": "5:00 PM ET", "et": "5:00 PM ET", "g": "L", "t1": "Croatia", "t2": "Ghana", "v": "LINC", "ts": 1782594000000}, {"no": 69, "iso": "2026-06-27", "local": "7:30 PM ET", "et": "7:30 PM ET", "g": "K", "t1": "Colombia", "t2": "Portugal", "v": "HARDROCK", "ts": 1782603000000}, {"no": 70, "iso": "2026-06-27", "local": "7:30 PM ET", "et": "7:30 PM ET", "g": "K", "t1": "DR Congo", "t2": "Uzbekistan", "v": "MBS", "ts": 1782603000000}, {"no": 71, "iso": "2026-06-27", "local": "9:00 PM CDT", "et": "10:00 PM ET", "g": "J", "t1": "Algeria", "t2": "Austria", "v": "ARROW", "ts": 1782612000000}, {"no": 72, "iso": "2026-06-27", "local": "9:00 PM CDT", "et": "10:00 PM ET", "g": "J", "t1": "Jordan", "t2": "Argentina", "v": "ATT", "ts": 1782612000000}], "ko": [{"round": "Round of 32", "mr": "73–88", "iso": "2026-06-28", "local": "12:00 PM PT", "et": "3:00 PM ET", "v": "SOFI", "ts": 1782673200000}, {"round": "Round of 32", "mr": "73–88", "iso": "2026-06-29", "local": "12:00 PM CDT", "et": "1:00 PM ET", "v": "NRG", "ts": 1782752400000}, {"round": "Round of 32", "mr": "73–88", "iso": "2026-06-29", "local": "4:30 PM ET", "et": "4:30 PM ET", "v": "GILLETTE", "ts": 1782765000000}, {"round": "Round of 32", "mr": "73–88", "iso": "2026-06-29", "local": "7:00 PM CST", "et": "9:00 PM ET", "v": "BBVA", "ts": 1782781200000}, {"round": "Round of 32", "mr": "73–88", "iso": "2026-06-30", "local": "12:00 PM CDT", "et": "1:00 PM ET", "v": "ATT", "ts": 1782838800000}, {"round": "Round of 32", "mr": "73–88", "iso": "2026-06-30", "local": "5:00 PM ET", "et": "5:00 PM ET", "v": "METLIFE", "ts": 1782853200000}, {"round": "Round of 32", "mr": "73–88", "iso": "2026-06-30", "local": "7:00 PM CST", "et": "9:00 PM ET", "v": "AZT", "ts": 1782867600000}, {"round": "Round of 32", "mr": "73–88", "iso": "2026-07-01", "local": "12:00 PM ET", "et": "12:00 PM ET", "v": "MBS", "ts": 1782921600000}, {"round": "Round of 32", "mr": "73–88", "iso": "2026-07-01", "local": "1:00 PM PT", "et": "4:00 PM ET", "v": "LUMEN", "ts": 1782936000000}, {"round": "Round of 32", "mr": "73–88", "iso": "2026-07-01", "local": "5:00 PM PT", "et": "8:00 PM ET", "v": "LEVI", "ts": 1782950400000}, {"round": "Round of 32", "mr": "73–88", "iso": "2026-07-02", "local": "12:00 PM PT", "et": "3:00 PM ET", "v": "SOFI", "ts": 1783018800000}, {"round": "Round of 32", "mr": "73–88", "iso": "2026-07-02", "local": "7:00 PM ET", "et": "7:00 PM ET", "v": "BMO", "ts": 1783033200000}, {"round": "Round of 32", "mr": "73–88", "iso": "2026-07-02", "local": "8:00 PM PT", "et": "11:00 PM ET", "v": "BCP", "ts": 1783047600000}, {"round": "Round of 32", "mr": "73–88", "iso": "2026-07-03", "local": "1:00 PM CDT", "et": "2:00 PM ET", "v": "ATT", "ts": 1783101600000}, {"round": "Round of 32", "mr": "73–88", "iso": "2026-07-03", "local": "6:00 PM ET", "et": "6:00 PM ET", "v": "HARDROCK", "ts": 1783116000000}, {"round": "Round of 32", "mr": "73–88", "iso": "2026-07-03", "local": "8:30 PM CDT", "et": "9:30 PM ET", "v": "ARROW", "ts": 1783128600000}, {"round": "Round of 16", "mr": "89–96", "iso": "2026-07-04", "local": "12:00 PM CDT", "et": "1:00 PM ET", "v": "NRG", "ts": 1783184400000}, {"round": "Round of 16", "mr": "89–96", "iso": "2026-07-04", "local": "5:00 PM ET", "et": "5:00 PM ET", "v": "LINC", "ts": 1783198800000}, {"round": "Round of 16", "mr": "89–96", "iso": "2026-07-05", "local": "4:00 PM ET", "et": "4:00 PM ET", "v": "METLIFE", "ts": 1783281600000}, {"round": "Round of 16", "mr": "89–96", "iso": "2026-07-05", "local": "6:00 PM CST", "et": "8:00 PM ET", "v": "AZT", "ts": 1783296000000}, {"round": "Round of 16", "mr": "89–96", "iso": "2026-07-06", "local": "2:00 PM CDT", "et": "3:00 PM ET", "v": "ATT", "ts": 1783364400000}, {"round": "Round of 16", "mr": "89–96", "iso": "2026-07-06", "local": "5:00 PM PT", "et": "8:00 PM ET", "v": "LUMEN", "ts": 1783382400000}, {"round": "Round of 16", "mr": "89–96", "iso": "2026-07-07", "local": "12:00 PM ET", "et": "12:00 PM ET", "v": "MBS", "ts": 1783440000000}, {"round": "Round of 16", "mr": "89–96", "iso": "2026-07-07", "local": "1:00 PM PT", "et": "4:00 PM ET", "v": "BCP", "ts": 1783454400000}, {"round": "Quarter-final", "mr": "97–100", "iso": "2026-07-09", "local": "4:00 PM ET", "et": "4:00 PM ET", "v": "GILLETTE", "ts": 1783627200000}, {"round": "Quarter-final", "mr": "97–100", "iso": "2026-07-10", "local": "12:00 PM PT", "et": "3:00 PM ET", "v": "SOFI", "ts": 1783710000000}, {"round": "Quarter-final", "mr": "97–100", "iso": "2026-07-11", "local": "5:00 PM ET", "et": "5:00 PM ET", "v": "HARDROCK", "ts": 1783803600000}, {"round": "Quarter-final", "mr": "97–100", "iso": "2026-07-11", "local": "8:00 PM CDT", "et": "9:00 PM ET", "v": "ARROW", "ts": 1783818000000}, {"round": "Semi-final", "mr": "101–102", "iso": "2026-07-14", "local": "2:00 PM CDT", "et": "3:00 PM ET", "v": "ATT", "ts": 1784055600000}, {"round": "Semi-final", "mr": "101–102", "iso": "2026-07-15", "local": "3:00 PM ET", "et": "3:00 PM ET", "v": "MBS", "ts": 1784142000000}, {"round": "Third-place play-off", "mr": "103", "iso": "2026-07-18", "local": "5:00 PM ET", "et": "5:00 PM ET", "v": "HARDROCK", "ts": 1784408400000}, {"round": "Final", "mr": "104", "iso": "2026-07-19", "local": "3:00 PM ET", "et": "3:00 PM ET", "v": "METLIFE", "ts": 1784487600000}], "flags": {"Mexico": "🇲🇽", "South Africa": "🇿🇦", "South Korea": "🇰🇷", "Czechia": "🇨🇿", "Canada": "🇨🇦", "Bosnia & Herzegovina": "🇧🇦", "Qatar": "🇶🇦", "Switzerland": "🇨🇭", "Brazil": "🇧🇷", "Morocco": "🇲🇦", "Haiti": "🇭🇹", "Scotland": "🏴󠁧󠁢󠁳󠁣󠁴󠁿", "United States": "🇺🇸", "Paraguay": "🇵🇾", "Australia": "🇦🇺", "Türkiye": "🇹🇷", "Germany": "🇩🇪", "Curaçao": "🇨🇼", "Ivory Coast": "🇨🇮", "Ecuador": "🇪🇨", "Netherlands": "🇳🇱", "Japan": "🇯🇵", "Sweden": "🇸🇪", "Tunisia": "🇹🇳", "Belgium": "🇧🇪", "Egypt": "🇪🇬", "Iran": "🇮🇷", "New Zealand": "🇳🇿", "Spain": "🇪🇸", "Cape Verde": "🇨🇻", "Saudi Arabia": "🇸🇦", "Uruguay": "🇺🇾", "France": "🇫🇷", "Senegal": "🇸🇳", "Iraq": "🇮🇶", "Norway": "🇳🇴", "Argentina": "🇦🇷", "Algeria": "🇩🇿", "Austria": "🇦🇹", "Jordan": "🇯🇴", "Portugal": "🇵🇹", "DR Congo": "🇨🇩", "Uzbekistan": "🇺🇿", "Colombia": "🇨🇴", "England": "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "Croatia": "🇭🇷", "Ghana": "🇬🇭", "Panama": "🇵🇦"}, "gcolor": {"A": "#0A5C3E", "B": "#1C6E8C", "C": "#C04A2B", "D": "#2D5BA8", "E": "#7A4FB5", "F": "#A8761F", "G": "#1F8A6B", "H": "#B23A6F", "I": "#3F6FB0", "J": "#C25E2A", "K": "#4F7A2E", "L": "#8A4B9C"}, "starts": [1781204400000, 1781229600000, 1781290800000, 1781312400000, 1781377200000, 1781388000000, 1781398800000, 1781409600000, 1781456400000, 1781467200000, 1781478000000, 1781488800000, 1781539200000, 1781550000000, 1781560800000, 1781571600000, 1781636400000, 1781647200000, 1781658000000, 1781668800000, 1781715600000, 1781726400000, 1781737200000, 1781748000000, 1781798400000, 1781809200000, 1781820000000, 1781830800000, 1781895600000, 1781906400000, 1781915400000, 1781928000000, 1781974800000, 1781985600000, 1782000000000, 1782014400000, 1782057600000, 1782068400000, 1782079200000, 1782090000000, 1782147600000, 1782162000000, 1782172800000, 1782183600000, 1782234000000, 1782244800000, 1782255600000, 1782266400000, 1782327600000, 1782338400000, 1782349200000, 1782417600000, 1782428400000, 1782439200000, 1782500400000, 1782518400000, 1782529200000, 1782594000000, 1782603000000, 1782612000000, 1782673200000, 1782752400000, 1782765000000, 1782781200000, 1782838800000, 1782853200000, 1782867600000, 1782921600000, 1782936000000, 1782950400000, 1783018800000, 1783033200000, 1783047600000, 1783101600000, 1783116000000, 1783128600000, 1783184400000, 1783198800000, 1783281600000, 1783296000000, 1783364400000, 1783382400000, 1783440000000, 1783454400000, 1783627200000, 1783710000000, 1783803600000, 1783818000000, 1784055600000, 1784142000000, 1784408400000, 1784487600000]};

export const MOCK_FIXTURES: LiveFixture[] = [
  {"ts": 1781204400000, "status": "FT", "elapsed": 90, "venue": "Estadio Azteca", "round": "Group Stage - 1", "home": "Mexico", "away": "South Africa", "gh": 2, "ga": 0,
    "events": [
      {"minute": 23, "extra": null, "type": "Goal", "detail": "Normal Goal", "player": "Santiago Giménez", "assist": "Hirving Lozano", "team": "Mexico"},
      {"minute": 45, "extra": 2, "type": "Card", "detail": "Yellow Card", "player": "Teboho Mokoena", "assist": null, "team": "South Africa"},
      {"minute": 71, "extra": null, "type": "Goal", "detail": "Normal Goal", "player": "Hirving Lozano", "assist": "Edson Álvarez", "team": "Mexico"},
      {"minute": 78, "extra": null, "type": "subst", "detail": "Substitution 1", "player": "Raúl Jiménez", "assist": "Santiago Giménez", "team": "Mexico"}
    ],
    "stats": {"home": {"Ball Possession": "58%", "Total Shots": 14, "Shots on Goal": 6, "Corner Kicks": 7, "Fouls": 12}, "away": {"Ball Possession": "42%", "Total Shots": 8, "Shots on Goal": 2, "Corner Kicks": 3, "Fouls": 15}}
  },
  {"ts": 1781229600000, "status": "2H", "elapsed": 67, "venue": "Estadio Akron", "round": "Group Stage - 1", "home": "Korea Republic", "away": "Czech Republic", "gh": 1, "ga": 1,
    "referee": "Daniele Orsato",
    "events": [
      {"minute": 12, "extra": null, "type": "Goal", "detail": "Normal Goal", "player": "Son Heung-min", "assist": "Lee Kang-in", "team": "Korea Republic"},
      {"minute": 34, "extra": null, "type": "Card", "detail": "Yellow Card", "player": "Kim Min-jae", "assist": null, "team": "Korea Republic"},
      {"minute": 55, "extra": null, "type": "Goal", "detail": "Normal Goal", "player": "Patrik Schick", "assist": "Adam Hložek", "team": "Czech Republic"}
    ],
    "stats": {"home": {"Ball Possession": "52%", "Total Shots": 11, "Shots on Goal": 4, "Corner Kicks": 5, "Fouls": 10, "Offsides": 2, "Passes accurate": "312 (84%)", "Total passes": 372}, "away": {"Ball Possession": "48%", "Total Shots": 9, "Shots on Goal": 3, "Corner Kicks": 4, "Fouls": 11, "Offsides": 1, "Passes accurate": "288 (81%)", "Total passes": 356}},
    "lineups": [
      {"team": "Korea Republic", "formation": "4-2-3-1", "startXI": [
        {"name": "Kim Seung-gyu", "number": 1, "pos": "G", "grid": "1:1"},
        {"name": "Kim Moon-hwan", "number": 2, "pos": "D", "grid": "2:4"},
        {"name": "Kim Min-jae", "number": 3, "pos": "D", "grid": "2:3"},
        {"name": "Kim Young-gwon", "number": 4, "pos": "D", "grid": "2:2"},
        {"name": "Kim Jin-su", "number": 6, "pos": "D", "grid": "2:1"},
        {"name": "Hwang In-beom", "number": 8, "pos": "M", "grid": "3:2"},
        {"name": "Jung Woo-young", "number": 5, "pos": "M", "grid": "3:1"},
        {"name": "Lee Kang-in", "number": 10, "pos": "M", "grid": "4:3"},
        {"name": "Hwang Hee-chan", "number": 11, "pos": "M", "grid": "4:1"},
        {"name": "Jeong Sang-bin", "number": 17, "pos": "M", "grid": "4:2"},
        {"name": "Son Heung-min", "number": 7, "pos": "F", "grid": "5:1"}
      ], "substitutes": [
        {"name": "Jo Hyeon-woo", "number": 21, "pos": "G", "grid": null},
        {"name": "Cho Gue-sung", "number": 9, "pos": "F", "grid": null},
        {"name": "Lee Jae-sung", "number": 14, "pos": "M", "grid": null}
      ]},
      {"team": "Czech Republic", "formation": "3-4-3", "startXI": [
        {"name": "Jindřich Staněk", "number": 1, "pos": "G", "grid": "1:1"},
        {"name": "Vladimír Coufal", "number": 5, "pos": "D", "grid": "2:3"},
        {"name": "Robin Hranáč", "number": 4, "pos": "D", "grid": "2:2"},
        {"name": "Ladislav Krejčí", "number": 3, "pos": "D", "grid": "2:1"},
        {"name": "David Jurásek", "number": 2, "pos": "M", "grid": "3:4"},
        {"name": "Tomáš Souček", "number": 6, "pos": "M", "grid": "3:3"},
        {"name": "Lukáš Provod", "number": 8, "pos": "M", "grid": "3:2"},
        {"name": "David Douděra", "number": 14, "pos": "M", "grid": "3:1"},
        {"name": "Patrik Schick", "number": 9, "pos": "F", "grid": "4:2"},
        {"name": "Adam Hložek", "number": 10, "pos": "F", "grid": "4:3"},
        {"name": "Mojmír Chytil", "number": 11, "pos": "F", "grid": "4:1"}
      ], "substitutes": [
        {"name": "Matěj Kovář", "number": 23, "pos": "G", "grid": null},
        {"name": "Pavel Šulc", "number": 16, "pos": "M", "grid": null},
        {"name": "Ondřej Lingr", "number": 18, "pos": "F", "grid": null}
      ]}
    ],
    "players": [
      {"name": "Son Heung-min", "number": 7, "team": "Korea Republic", "minutes": 67, "rating": "7.8", "goals": 1, "assists": 0, "shots": 3, "shotsOn": 2, "passes": 38, "passAccuracy": "86%", "tackles": 1, "duels": 8, "duelsWon": 5, "dribbles": 3, "dribblesSuccess": 2, "foulsDrawn": 2, "foulsCommitted": 0, "yellowCards": 0, "redCards": 0, "saves": 0},
      {"name": "Lee Kang-in", "number": 10, "team": "Korea Republic", "minutes": 67, "rating": "7.5", "goals": 0, "assists": 1, "shots": 2, "shotsOn": 1, "passes": 45, "passAccuracy": "88%", "tackles": 2, "duels": 6, "duelsWon": 3, "dribbles": 4, "dribblesSuccess": 3, "foulsDrawn": 1, "foulsCommitted": 1, "yellowCards": 0, "redCards": 0, "saves": 0},
      {"name": "Kim Min-jae", "number": 3, "team": "Korea Republic", "minutes": 67, "rating": "6.4", "goals": 0, "assists": 0, "shots": 0, "shotsOn": 0, "passes": 52, "passAccuracy": "91%", "tackles": 4, "duels": 10, "duelsWon": 7, "dribbles": 0, "dribblesSuccess": 0, "foulsDrawn": 0, "foulsCommitted": 2, "yellowCards": 1, "redCards": 0, "saves": 0},
      {"name": "Patrik Schick", "number": 9, "team": "Czech Republic", "minutes": 67, "rating": "7.6", "goals": 1, "assists": 0, "shots": 4, "shotsOn": 2, "passes": 18, "passAccuracy": "78%", "tackles": 0, "duels": 7, "duelsWon": 3, "dribbles": 1, "dribblesSuccess": 0, "foulsDrawn": 2, "foulsCommitted": 1, "yellowCards": 0, "redCards": 0, "saves": 0},
      {"name": "Adam Hložek", "number": 10, "team": "Czech Republic", "minutes": 67, "rating": "7.3", "goals": 0, "assists": 1, "shots": 2, "shotsOn": 1, "passes": 24, "passAccuracy": "83%", "tackles": 1, "duels": 9, "duelsWon": 4, "dribbles": 3, "dribblesSuccess": 2, "foulsDrawn": 1, "foulsCommitted": 0, "yellowCards": 0, "redCards": 0, "saves": 0},
      {"name": "Tomáš Souček", "number": 6, "team": "Czech Republic", "minutes": 67, "rating": "7.0", "goals": 0, "assists": 0, "shots": 1, "shotsOn": 0, "passes": 42, "passAccuracy": "85%", "tackles": 5, "duels": 12, "duelsWon": 8, "dribbles": 0, "dribblesSuccess": 0, "foulsDrawn": 1, "foulsCommitted": 2, "yellowCards": 0, "redCards": 0, "saves": 0}
    ]
  },
  {"ts": 1781798400000, "status": "FT", "elapsed": 90, "venue": "Mercedes-Benz Stadium", "round": "Group Stage - 2", "home": "Czech Republic", "away": "South Africa", "gh": 3, "ga": 1,
    "events": [
      {"minute": 8, "extra": null, "type": "Goal", "detail": "Normal Goal", "player": "Patrik Schick", "assist": null, "team": "Czech Republic"},
      {"minute": 29, "extra": null, "type": "Goal", "detail": "Normal Goal", "player": "Adam Hložek", "assist": "Patrik Schick", "team": "Czech Republic"},
      {"minute": 52, "extra": null, "type": "Goal", "detail": "Penalty", "player": "Percy Tau", "assist": null, "team": "South Africa"},
      {"minute": 88, "extra": null, "type": "Goal", "detail": "Normal Goal", "player": "Mojmír Chytil", "assist": "Tomáš Souček", "team": "Czech Republic"}
    ],
    "stats": {"home": {"Ball Possession": "55%", "Total Shots": 16, "Shots on Goal": 7, "Corner Kicks": 6, "Fouls": 9}, "away": {"Ball Possession": "45%", "Total Shots": 7, "Shots on Goal": 3, "Corner Kicks": 2, "Fouls": 14}}
  },
  {"ts": 1781830800000, "status": "FT", "elapsed": 90, "venue": "Estadio Akron", "round": "Group Stage - 2", "home": "Mexico", "away": "Korea Republic", "gh": 1, "ga": 1,
    "events": [
      {"minute": 38, "extra": null, "type": "Goal", "detail": "Normal Goal", "player": "Santiago Giménez", "assist": null, "team": "Mexico"},
      {"minute": 63, "extra": null, "type": "Goal", "detail": "Normal Goal", "player": "Son Heung-min", "assist": "Hwang Hee-chan", "team": "Korea Republic"},
      {"minute": 72, "extra": null, "type": "Card", "detail": "Yellow Card", "player": "Edson Álvarez", "assist": null, "team": "Mexico"}
    ],
    "stats": {"home": {"Ball Possession": "54%", "Total Shots": 12, "Shots on Goal": 5, "Corner Kicks": 6, "Fouls": 13}, "away": {"Ball Possession": "46%", "Total Shots": 10, "Shots on Goal": 4, "Corner Kicks": 3, "Fouls": 11}}
  },
  {"ts": 1782673200000, "status": "NS", "elapsed": null, "venue": "SoFi Stadium", "round": "Round of 32", "home": "Argentina", "away": "Croatia", "gh": null, "ga": null}
];

export interface MatchEvent {
  minute: number;
  extra: number | null;
  type: "Goal" | "Card" | "subst" | "Var";
  detail: string;
  player: string;
  assist: string | null;
  team: string;
}

export interface MatchStats {
  home: Record<string, string | number | null>;
  away: Record<string, string | number | null>;
}

export interface LineupPlayer {
  name: string;
  number: number;
  pos: string;
  grid: string | null;
}

export interface TeamLineup {
  team: string;
  formation: string;
  startXI: LineupPlayer[];
  substitutes: LineupPlayer[];
}

export interface PlayerMatchStat {
  name: string;
  number: number;
  team: string;
  minutes: number | null;
  rating: string | null;
  goals: number;
  assists: number;
  shots: number;
  shotsOn: number;
  passes: number;
  passAccuracy: string | null;
  tackles: number;
  duels: number;
  duelsWon: number;
  dribbles: number;
  dribblesSuccess: number;
  foulsDrawn: number;
  foulsCommitted: number;
  yellowCards: number;
  redCards: number;
  saves: number;
}

export interface LiveFixture {
  ts: number;
  status: string;
  elapsed: number | null;
  venue: string;
  round: string;
  home: string;
  away: string;
  gh: number | null;
  ga: number | null;
  events?: MatchEvent[];
  stats?: MatchStats;
  lineups?: TeamLineup[];
  players?: PlayerMatchStat[];
  referee?: string;
  fixtureId?: number;
}
