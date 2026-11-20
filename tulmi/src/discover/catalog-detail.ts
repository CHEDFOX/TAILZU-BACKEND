/**
 * WHAT A PERSON ACTUALLY NEEDS TO KNOW BEFORE THEY GO.
 *
 * Kept beside the catalogue rather than in it (PHOTOS does the same) so a row stays one line to read and one line
 * to add, and so this can be filled in over time without touching the rows.
 *
 * Three questions, and only three, because they are the ones that decide whether somebody can really do a thing:
 *
 *   takes    how long it costs them — a morning, four days underground, twenty-five days with no road out
 *   getting  how they physically reach it, in one line
 *   need     the thing that can stop them: a permit, a cap, a lead time, a boat that sails nine times a year
 *
 * A FIELD IS LEFT OUT RATHER THAN GUESSED. Every one of these is shown to somebody deciding how to spend a week
 * and a lot of money, so a line that is only probably right is worse than no line. Prices and quotas move; where
 * one is given it is dated by the card's own wording, not stated as current.
 */

export interface Detail {
  /** "four days underground", "a morning", "twenty-five days". */
  takes?: string;
  /** One line on physically reaching it. */
  getting?: string;
  /** The permit, cap, lead time or condition that decides whether it happens at all. */
  need?: string;
}

export const DETAIL: Readonly<Record<string, Detail>> = {
  // ---- the older catalogue -----------------------------------------------------------------------
  "lofoten-blue-hour": { takes: "Three or four days, to catch one clear one", getting: "Fly to Bodø or Evenes, then the E10 by car", need: "A car. The light happens where the buses do not go" },
  "hamnoy-bridge-dawn": { takes: "An hour, standing still in the cold", getting: "Reine, on the E10; the bridge itself is the viewpoint", need: "It is a working road — stand on the footway, not the carriageway" },
  "vestrahorn-black-sand": { takes: "A morning", getting: "Ring Road to Höfn, then the track out to Stokksnes", need: "A small landowner's fee at the café gate; the beach is private land" },
  "tre-cime-circuit": { takes: "Four to five hours on foot", getting: "The toll road up to Rifugio Auronzo, from Misurina", need: "The toll road shuts with the first snow and reopens around June" },
  "erg-chebbi-silence": { takes: "A night in the dunes", getting: "Merzouga, then camel or 4x4 into the erg", need: "A guide. The dunes move and there is nothing to navigate by" },
  "machu-picchu-first-light": { takes: "Half a day on the site", getting: "Train from Cusco to Aguas Calientes, then the shuttle bus", need: "A timed ticket on a named circuit, bought well ahead — they sell out" },
  "wanaka-roys-peak": { takes: "Five to six hours return", getting: "Twenty minutes from Wanaka on the Mount Aspiring road", need: "1,200m of climbing, and a start before four to have it to yourself" },
  "angkor-wat": { takes: "A full day, or three", getting: "Fly to Siem Reap; tuk-tuk to the moat", need: "A park pass — one, three or seven days, bought at the ticket office" },
  "bagan-temple-plain": { takes: "Two or three days", getting: "Overland or by air to Nyaung-U", need: "An archaeological zone fee. Climbing the temples is no longer allowed" },
  "petra-siq-dawn": { takes: "A long day, two to see it properly", getting: "Two and a half hours by road from Amman", need: "A ticket; the Jordan Pass is cheaper if you are flying in anyway" },
  "borobudur-mist": { takes: "A morning", getting: "An hour from Yogyakarta", need: "Numbers on the upper terraces are capped — book the slot, not just the gate" },
  "hampi-boulders": { takes: "Two days", getting: "Overnight train or bus from Bengaluru to Hospet, then 30 minutes", need: "A bicycle or a scooter; the ruins run for miles" },
  "taj-first-light": { takes: "Two hours, at opening", getting: "Agra, by the Gatimaan from Delhi in under two hours", need: "A ticket timed to sunrise, and Friday it is closed" },
  "jiankou-wild-wall": { takes: "A long day from Beijing", getting: "Two to three hours out to Xizhazi village", need: "This section is unrestored and genuinely dangerous in places" },
  "ajanta-lamplight": { takes: "Half a day", getting: "Two hours from Aurangabad by road", need: "Closed Mondays. Photography inside is restricted to protect the paint" },
  "meteora-monasteries": { takes: "A day, or two to walk between them", getting: "Train from Athens or Thessaloniki to Kalambaka", need: "Each monastery keeps its own closing day, and a dress code" },
  "gobekli-tepe": { takes: "Half a day", getting: "Forty minutes from Şanlıurfa", need: "Shade and water — the site is a roofed shelter on an open hill" },
  "lalibela-bete-giyorgis": { takes: "Two days for the eleven churches", getting: "Fly to Lalibela from Addis Ababa", need: "A site pass, a local guide, and shoes you can take off repeatedly" },
  "great-zimbabwe": { takes: "Half a day", getting: "Thirty minutes from Masvingo", need: "A guide is worth it; almost nothing on site is signposted" },
  "karnak-hypostyle": { takes: "Three hours", getting: "Luxor east bank, a short drive from the centre", need: "Go at opening. By ten the hall is full and the light is flat" },
  "tikal-temple-four": { takes: "A day, or stay inside the park", getting: "An hour from Flores, which has the nearest airport", need: "A sunrise ticket is sold separately and lets you in before dawn" },
  "teotihuacan-dawn": { takes: "A morning", getting: "An hour from Mexico City by bus from Terminal Norte", need: "The pyramids are no longer climbable; the view is from the Calzada" },
  "rapa-nui-tongariki": { takes: "Three days to see the island", getting: "Five hours by air from Santiago — the only route", need: "A national park ticket, and most sites may be visited only once on it" },
  "uyuni-mirror": { takes: "A day trip, or three days across the altiplano", getting: "Fly or overnight bus to Uyuni from La Paz", need: "The mirror needs rain. Operators will tell you honestly if there is none" },
  "uluru-sunrise": { takes: "Two days", getting: "Fly to Ayers Rock, or five hours from Alice Springs", need: "A park pass. Climbing has been closed since 2019 at the owners' request" },
  "alhambra-nasrid": { takes: "Half a day", getting: "Granada, walkable uphill from the city", need: "The Nasrid Palaces are timed to the half hour and sell out weeks ahead" },

  // ---- the exceptional list ----------------------------------------------------------------------
  "luxor-eclipse": { takes: "Six minutes twenty-three seconds, and a week around it", getting: "Fly to Luxor, or the sleeper from Cairo", need: "Accommodation on the centre line was going years ahead. Certified eclipse glasses" },
  "sardine-run": { takes: "Seven to ten days, to get two or three in the water", getting: "Fly to Durban or East London, then down to Port St Johns", need: "Open-water certification, a strong stomach for the launch, and the honesty to accept it may not happen" },
  "monarch-michoacan": { takes: "Half a day at the sanctuary", getting: "Three hours from Mexico City to Angangueo or Ocampo", need: "A guide is compulsory. The groves are at 3,000m and the walk up is steep" },
  "smokies-fireflies": { takes: "One evening", getting: "Gatlinburg, Tennessee, then the shuttle to Elkmont", need: "A parking pass by lottery, drawn weeks before the dates are even known" },
  "christmas-island-crabs": { takes: "A week, to be there when it starts", getting: "Fly from Perth — about four hours, a few flights a week", need: "The migration follows the first rain, so it cannot be booked to a date" },
  "mara-balloon": { takes: "An hour aloft, and three or four days for a crossing", getting: "Light aircraft from Nairobi Wilson to an airstrip in the reserve", need: "Balloons lift before dawn and cancel on wind. Crossings are unscheduled" },
  "snow-hill-emperors": { takes: "Ten to twelve days from Ushuaia", getting: "An icebreaker out of Ushuaia, then helicopter to the fast ice", need: "A handful of sailings a season, booked a year or two out, and they are cancelled outright when the ice is wrong" },
  "skjervoy-orca": { takes: "Four or five days, for the weather", getting: "Fly to Tromsø, then three hours north by road or the coastal boat", need: "A drysuit for in-water trips, and about four hours of usable light a day" },
  "san-ignacio-greys": { takes: "Three days at the lagoon", getting: "Fly to Loreto or Guerrero Negro, then hours of dirt road", need: "A permit held by the camps inside the biosphere reserve; numbers on the water are capped" },
  "silfra": { takes: "Two hours, including kitting up", getting: "Forty minutes from Reykjavík to Þingvellir", need: "A drysuit certification to dive it; snorkelling needs none" },
  "dominica-sperm-whales": { takes: "A week, for two or three encounters", getting: "Fly via Barbados, Antigua or Guadeloupe to Douglas-Charles", need: "One of a small number of government permits, held by licensed operators" },
  "tonga-humpbacks": { takes: "A week on the water", getting: "Fly to Tongatapu, then the hop to Vava'u", need: "A licensed swim operator; four swimmers at a time is the legal limit" },
  "ningaloo-whale-sharks": { takes: "A day on the boat", getting: "Fly to Exmouth or Learmonth from Perth", need: "A licensed tour, since spotter aircraft are how they are found at all" },
  "raja-ampat": { takes: "Ten days on a liveaboard", getting: "Fly to Sorong via Jakarta or Makassar, then the boat", need: "A marine park entry tag, and advanced certification for the current-swept sites" },
  "kona-mantas": { takes: "Two hours after dark", getting: "Kailua-Kona on the Big Island; the sites are minutes offshore", need: "Nothing but a wetsuit and the willingness to kneel still on the sand" },
  "son-doong": { takes: "Four days underground, six on the trip", getting: "Fly to Dong Hoi, then an hour to Phong Nha", need: "One of roughly a thousand permits a year, through the single licensed operator, with a waiting list over a year" },
  "deadvlei": { takes: "A morning, and a night nearby to be there at sunrise", getting: "Fly to Windhoek, then five hours to Sesriem; 4x4 for the last five kilometres", need: "A park permit, and staying inside the gate to be on the pan at first light" },
  "lencois": { takes: "Three days", getting: "Fly to São Luís, then four hours to Barreirinhas", need: "A 4x4 and a guide; there are no roads across the dunes" },
  "tsingy-bemaraha": { takes: "Three days, plus two to get there", getting: "Morondava, then eight hours of track and two river ferries", need: "A harness and a compulsory guide. The whole park closes in the rains" },
  "ijen-blue-fire": { takes: "One night, starting at one in the morning", getting: "Banyuwangi, East Java, reachable by overnight train from Surabaya", need: "A proper gas mask, not the cloth ones sold at the gate" },
  "mt-yasur": { takes: "An evening", getting: "Fly to Tanna from Port Vila, then an hour by 4x4", need: "The volcano has an activity level posted daily, and it closes the rim without notice" },
  "kolmanskop": { takes: "Two hours", getting: "Ten minutes from Lüderitz, in the restricted diamond area", need: "A permit, and a separate sunrise permit if you want it empty" },
  "svalbard-polar-night": { takes: "Four or five days", getting: "Direct flights to Longyearbyen from Oslo and Tromsø", need: "Outside the settlement you are required to carry a rifle, because of the bears" },
  "vatnajokull-ice-cave": { takes: "Three hours", getting: "Jökulsárlón on the Ring Road, five hours from Reykjavík", need: "A guided trip only. Which caves are safe is decided week by week" },
  "chugach-heliski": { takes: "A week, to fly three or four days of it", getting: "Fly to Anchorage, then Valdez or Girdwood", need: "You pay for the week whether it flies or not, and must ski steep terrain in variable snow" },
  "haute-route": { takes: "Six days hut to hut", getting: "Chamonix by train or bus from Geneva", need: "Glacier travel skills, crevasse rescue, and the fitness to skin 1,000m a day with a pack" },
  "snowman-trek": { takes: "Twenty-five days", getting: "Fly to Paro, then the road to Gasa", need: "A licensed Bhutanese operator and the daily levy. Weather closes the route most years" },
  "naadam": { takes: "Three days", getting: "Fly to Ulaanbaatar, then hours by road to a provincial festival", need: "Nothing but transport. The countryside festivals are free and still mostly local" },
  "oaxaca-muertos": { takes: "Three nights", getting: "Fly to Oaxaca direct from Mexico City", need: "Beds in the city are gone months ahead. The village cemeteries are where it stays real" },
  "yi-peng": { takes: "Two nights", getting: "Fly to Chiang Mai", need: "The date moves with the lunar calendar and is confirmed only a few months out" },
  "hornbill-nagaland": { takes: "Four days", getting: "Fly to Dimapur, then three hours up to Kohima", need: "An Inner Line Permit for Nagaland, arranged before you travel" },
  "up-helly-aa": { takes: "One very long night", getting: "Fly or overnight ferry to Lerwick from Aberdeen", need: "The whole island books out a year ahead for it" },
  "kumano-kodo": { takes: "Four to five days walking", getting: "Train to Kii-Tanabe from Osaka, then the bus to Takijiri", need: "Nothing but a booking in each onsen town; your bag is moved on for you" },
  "gorilla-trek": { takes: "One hour with them, a day on your feet", getting: "Two hours from Kigali to Musanze", need: "A permit — about $1,500 in Rwanda, $800 in Uganda — capped by design, and that cap is what keeps the gorillas" },
  "socotra": { takes: "Eight days, set by the flight", getting: "A weekly Yemenia flight from Jeddah, booked through an operator", need: "A permit and a licensed operator. Yemen carries a Do Not Travel advisory" },
  "tristan-da-cunha": { takes: "Three weeks at least, set by the boat", getting: "A fishing vessel from Cape Town — six days each way, about nine sailings a year", need: "Permission from the island council before you sail, and nowhere to stay but a resident's house" },
  "pamir-highway": { takes: "Eight to ten days driving", getting: "Start at Osh in Kyrgyzstan or Dushanbe in Tajikistan", need: "A GBAO permit on top of the visa, and fuel carried for 200km stretches" },
  "atacama-sky": { takes: "Two nights", getting: "Fly to Calama, then an hour to San Pedro", need: "A moonless week. Altitude is 2,400m and the nights are genuinely cold" },
};

export const detailOf = (slug: string): Detail => DETAIL[slug] ?? {};
