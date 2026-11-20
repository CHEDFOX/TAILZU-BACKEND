/**
 * THE PLACES WE HAVE WRITTEN OURSELVES. Not every place: only ones with something to do at an hour that matters, or a
 * history with a date on it. A town with neither is answered by the bot in words and never becomes a card (bar.ts).
 *
 * Rows, like the city list in src/places/cities.ts, so a place is one line to read and one line to add. Carried over
 * from the Firo catalogue with its coordinates, months and editorial scores unchanged.
 *
 *   CURATED            every card we have written
 *   curatedBySlug(s)   one of them
 *
 * Photographs are filled in by whoever writes the card; a card with none still shows, with its hook and its words.
 */
import type { Advisory, Card } from "./types.js";
import { seasonFrom, type Budget, type Tag } from "./taxonomy.js";
import { PHOTOS } from "./photos-catalog.js";

type Row = [
  slug: string,
  title: string,
  where: string,
  country: string,
  lat: number,
  lon: number,
  hook: string,
  moment: string,
  dated: string | null,
  tags: Tag[],
  months: number[],
  budget: Budget,
  effort: number,
  wow: number,
  rarity: number,
  story: string,
  /** Omitted on all but the few places under a standing Do Not Travel warning (types.ts, bar.ts). */
  advisory?: Advisory,
];

const ROWS: Row[] = [
  [
    "lofoten-blue-hour", "Lofoten in the blue hour", "Lofoten, Norway", "no", 67.9333, 13.0894,
    "Red cabins, black water, and a sky that refuses to go fully dark.",
    "the long blue twilight either side of midwinter", null,
    ["cold", "mountains", "photography", "solitude", "nature", "water"], [1, 2, 3, 9, 10, 11, 12], "premium", 2, 0.94, 0.45,
    "For a few weeks either side of midwinter the Lofoten islands sit in a long blue twilight. The peaks turn to silhouettes, the fjord goes to glass, and the whole archipelago feels like somewhere the world forgot to switch the lights on.",
  ],
  [
    "hamnoy-bridge-dawn", "Dawn from the Hamnøy bridge", "Lofoten, Norway", "no", 67.9503, 13.1372,
    "The most photographed view in the Arctic — and still worth standing in the cold for.",
    "dawn, standing on the bridge in the cold", null,
    ["cold", "photography", "mountains", "water", "solitude"], [1, 2, 3, 10, 11, 12], "moderate", 1, 0.88, 0.3,
    "",
  ],
  [
    "vestrahorn-black-sand", "Vestrahorn on black sand", "South Iceland", "is", 64.2494, -14.9819,
    "A jagged mountain rising straight out of a mirror of volcanic beach.",
    "when the tide pulls back and the sand mirrors the peaks", null,
    ["cold", "mountains", "photography", "nature", "solitude", "beach"], [1, 2, 3, 9, 10, 11, 12], "moderate", 2, 0.91, 0.55,
    "Stokksnes is a rare place where a serious mountain meets a black sand beach with nothing in between. When the tide pulls back the sand mirrors the peaks, and in winter the northern lights sometimes finish the picture.",
  ],
  [
    "tre-cime-circuit", "The Tre Cime circuit", "Dolomites, Italy", "it", 46.6183, 12.3053,
    "Three impossible towers of rock, and a trail that keeps showing them to you.",
    "early, walking it before the car park fills", "its towers were a front line from 1915 to 1917",
    ["hiking", "mountains", "adventure", "nature", "photography"], [6, 7, 8, 9], "moderate", 3, 0.9, 0.28,
    "The loop around the Tre Cime is one of the great half-day walks in Europe: about ten kilometres, never technical, and the mountains rearrange themselves into a new composition at every bend.",
  ],
  [
    "erg-chebbi-silence", "The silence of Erg Chebbi", "Sahara, Morocco", "ma", 31.1497, -3.9764,
    "Dunes the height of buildings, and a quiet so complete it feels physical.",
    "six in the evening, when the wind drops", null,
    ["desert", "warm", "solitude", "adventure", "camping", "minimalism"], [1, 2, 3, 10, 11, 12], "budget", 3, 0.91, 0.62,
    "",
  ],
  [
    "machu-picchu-first-light", "Machu Picchu at first light", "Cusco, Peru", "pe", -13.1631, -72.545,
    "Cloud pouring through the saddle while the terraces come out of the dark.",
    "first light, as cloud pours through the saddle", "built in the 1450s and left a century later",
    ["history", "culture", "mountains", "hiking", "adventure", "architecture"], [4, 5, 6, 7, 8, 9], "premium", 3, 0.95, 0.15,
    "",
  ],
  [
    "wanaka-roys-peak", "Roy's Peak before sunrise", "Otago, New Zealand", "nz", -44.7, 169.15,
    "A brutal climb in the dark that pays out over a lake the colour of mercury.",
    "the climb in the dark, to be up for sunrise", null,
    ["hiking", "mountains", "adventure", "nature", "water", "photography"], [11, 12, 1, 2, 3], "moderate", 4, 0.89, 0.4,
    "",
  ],
  [
    "angkor-wat", "Angkor Wat before the gates open", "Siem Reap, Cambodia", "kh", 13.4125, 103.8666,
    "Five towers come out of the dark one at a time, upside down in the pond first.",
    "first light, from the north reflecting pool", "raised in the 1110s for Suryavarman II, and never wholly abandoned since",
    ["architecture", "history", "culture", "photography"], [11, 12, 1, 2], "moderate", 2, 0.93, 0.1,
    "It is the largest religious building ever put up, and it was a city before it was a ruin. Most of the crowd faces the west gate; the north pool gives you the same towers with nobody in the frame.",
  ],
  [
    "bagan-temple-plain", "The temple plain at first light", "Bagan, Myanmar", "mm", 21.1317, 94.8624,
    "Brick stupas to the horizon, mist in the hollows between them, and no plan to any of it.",
    "first light, from an unnamed terrace rather than the famous one", "some two thousand temples left of the ten thousand raised in the 11th to 13th centuries",
    ["architecture", "history", "solitude", "photography"], [11, 12, 1, 2], "budget", 2, 0.9, 0.35,
    "The Pagan kings built on this bend of the Irrawaddy for two hundred years and then stopped. Earthquakes have taken many since, the last in 2016.",
  ],
  [
    "petra-siq-dawn", "Through the Siq at first light", "Petra, Jordan", "jo", 30.3498, 35.3765,
    "A kilometre of slot canyon, then the Treasury arrives all at once through a crack.",
    "first light, walking the Siq before the horses start", "a Nabataean capital cut from the rock in the 1st century BCE, lost to Europe until 1812",
    ["architecture", "history", "adventure", "desert"], [3, 4, 5, 9, 10, 11], "premium", 3, 0.95, 0.15,
    "The approach is the point and it cannot be hurried: high walls, cold air, a slice of sky. Go in the hour after opening and you will hear your own footsteps.",
  ],
  [
    "borobudur-mist", "Borobudur above the morning mist", "Java, Indonesia", "id", -7.608, 110.2038,
    "Stone galleries climbing out of fog, with two volcanoes on the skyline behind.",
    "first light, when the valley fog has not yet burned off", "built in the 9th century, buried under ash and forest, and uncovered again in 1814",
    ["architecture", "history", "culture", "mountains"], [5, 6, 7, 8, 9], "moderate", 2, 0.89, 0.3,
    "Nine stacked platforms carrying two thousand relief panels, meant to be walked clockwise from the bottom. The fog burns off by eight and takes the mystery with it.",
  ],
  [
    "hampi-boulders", "Boulders at dawn, over the Tungabhadra", "Hampi, Karnataka", "in", 15.3358, 76.461,
    "Granite the size of houses, stacked by nothing but time, and a river that moated a capital.",
    "first light from Matanga Hill, before the coaches from Hospet", "a capital of perhaps half a million people until it was sacked in 1565",
    ["history", "solitude", "architecture", "warm"], [11, 12, 1, 2], "budget", 2, 0.88, 0.5,
    "Vijayanagara ran for miles along this river and emptied in a season. What is left is temples among boulders, and at six in the morning you share it with langurs.",
  ],
  [
    "taj-first-light", "The Taj when the marble turns", "Agra, India", "in", 27.175, 78.0421,
    "White at noon, but pink at six and gold ten minutes later. The stone is doing it, not the light.",
    "the first hour after the gates open, before the heat and the queues", "finished about 1653, for one grave",
    ["architecture", "culture", "history", "photography"], [10, 11, 12, 1, 2, 3], "moderate", 1, 0.92, 0.05,
    "Everybody has seen the photograph and almost nobody has seen the inlay: flowers cut from carnelian and jasper, close enough to touch.",
  ],
  [
    "jiankou-wild-wall", "The wall nobody rebuilt", "Jiankou, Beijing", "cn", 40.493, 116.2354,
    "Ming brickwork with trees growing out of it, running along a ridge in both directions.",
    "early morning, before the haze settles on the ridge", "built along this line through the 15th and 16th centuries and left alone ever since",
    ["hiking", "history", "mountains", "solitude"], [5, 6, 9, 10], "budget", 4, 0.91, 0.65,
    "The restored sections have handrails and a cable car. This one has loose brick, steep scrambles and nobody on it, which is the version worth the bruises.",
  ],
  [
    "ajanta-lamplight", "Lamplight on the Ajanta ceilings", "Maharashtra, India", "in", 20.5524, 75.6994,
    "Thirty caves cut into a horseshoe cliff, with paint still on the walls after fifteen centuries.",
    "when the caves open, before the midday groups", "cut between the 2nd century BCE and about 480 CE, then forgotten until 1819",
    ["culture", "history", "architecture", "minimalism"], [11, 12, 1, 2], "budget", 2, 0.86, 0.74,
    "A hunting party stumbled on them in 1819 behind the forest. The murals are the oldest surviving painting of their kind anywhere, and the light inside is still deliberately low.",
  ],
  [
    "meteora-monasteries", "Monasteries above the cloud", "Meteora, Greece", "gr", 39.7095, 21.6356,
    "Sandstone pillars three hundred metres up, each with a monastery balanced on top of it.",
    "early morning, when cloud sits in the valley and the pillars stand clear of it", "monks began building up here in the 14th century, hauling everything by rope and net",
    ["architecture", "mountains", "culture", "photography"], [4, 5, 6, 9, 10], "moderate", 3, 0.9, 0.35,
    "Six of the twenty-four are still lived in. The rope ladders are gone and there are steps now, which the monks will tell you was a mixed blessing.",
  ],
  [
    "gobekli-tepe", "The oldest thing anyone built", "Sanliurfa, Turkey", "tr", 37.2239, 38.9221,
    "Carved stone circles raised before farming, before pottery, before the wheel.",
    "the first hour, when the light rakes across the carvings", "put up around 9500 BCE, some seven thousand years before Stonehenge",
    ["history", "minimalism", "culture", "desert"], [4, 5, 6, 9, 10], "budget", 1, 0.84, 0.82,
    "Hunter-gatherers quarried, carved and raised these pillars, then deliberately buried them. It is not much to look at next to a cathedral, and it rearranges what you thought people were doing that early.",
  ],
  [
    "lalibela-bete-giyorgis", "Before dawn at Bete Giyorgis", "Lalibela, Ethiopia", "et", 12.0316, 39.0411,
    "A cross cut down into bedrock, not built up out of it, and a liturgy going on inside at four.",
    "before dawn, when the chanting starts and white shawls fill the trench", "eleven churches hewn out of the rock in the 12th and 13th centuries, in use every day since",
    ["history", "culture", "architecture", "solitude"], [10, 11, 12, 1, 2, 3], "moderate", 3, 0.93, 0.7,
    "They were carved downward and inward from single pieces of volcanic rock. This is not a ruin anybody tours: it is a working church, and you keep to its hours.",
  ],
  [
    "great-zimbabwe", "Dry stone, no mortar, eight hundred years", "Masvingo, Zimbabwe", "zw", -20.2709, 30.9332,
    "A curved wall eleven metres high, every block cut to sit on the last without a drop of mortar.",
    "late afternoon, when the granite goes orange and the tour buses have gone", "the capital of a kingdom that traded to the Indian Ocean from the 11th to the 15th century",
    ["history", "architecture", "solitude", "nature"], [4, 5, 6, 7, 8, 9, 10], "budget", 2, 0.85, 0.75,
    "The country took its name from here. Colonial authorities spent decades insisting somebody else must have built it; the archaeology was never in doubt.",
  ],
  [
    "karnak-hypostyle", "The hypostyle hall at opening", "Luxor, Egypt", "eg", 25.7167, 32.6558,
    "A hundred and thirty-four columns, the tall ones twenty metres up, still carrying their paint near the top.",
    "the first hour after opening, when light comes in sideways through the clerestory", "added to for some two thousand years, the great hall raised in the 13th century BCE",
    ["architecture", "history", "culture", "desert"], [10, 11, 12, 1, 2, 3, 4], "moderate", 1, 0.9, 0.2,
    "Not one temple but a site enlarged by pharaoh after pharaoh until it stopped making sense as a single plan. Go at opening: by nine the hall is full and you cannot hear it.",
  ],
  [
    "tikal-temple-four", "Howler monkeys from Temple IV", "Peten, Guatemala", "gt", 17.191, -89.6149,
    "You come up above the canopy at dawn and the noise underneath you is not birds.",
    "first light from the top of Temple IV, with mist still on the forest", "a Maya city that ran from before 400 BCE and was left to the forest by the 10th century",
    ["history", "wildlife", "nature", "adventure"], [12, 1, 2, 3, 4], "moderate", 3, 0.92, 0.4,
    "Temple IV comes up out of the trees high enough to see three other temples breaking the canopy. The howlers start before the light does, and they sound considerably larger than they are.",
  ],
  [
    "teotihuacan-dawn", "The Avenue of the Dead at dawn", "Teotihuacan, Mexico", "mx", 19.6903, -98.8449,
    "Two kilometres of straight road between pyramids, built by people whose name for it is lost.",
    "the first hour, walking north up the avenue before the heat", "built between the 1st and 7th centuries, and already an abandoned wonder when the Aztecs named it",
    ["history", "architecture", "culture", "photography"], [11, 12, 1, 2, 3, 4], "budget", 2, 0.88, 0.25,
    "At its height perhaps a hundred thousand people lived here, in a grid, with apartment blocks and painted walls. We do not know what they called themselves.",
  ],
  [
    "rapa-nui-tongariki", "Fifteen moai facing the sunrise", "Easter Island, Chile", "cl", -27.1257, -109.2769,
    "The sun comes up behind you and lights fifteen backs of stone, with the sea breaking below.",
    "sunrise at Ahu Tongariki, which is the only hour they are lit from the front", "carved between about 1250 and 1500, toppled, and raised again in the 1990s after a tsunami scattered them",
    ["history", "island", "culture", "water"], [10, 11, 12, 1, 2, 3], "premium", 2, 0.94, 0.45,
    "The statues face inland, toward the people they were raised for, which is why dawn is the hour: the light comes over the Pacific and hits them full on.",
  ],
  [
    "uyuni-mirror", "The salt flat when it floods", "Salar de Uyuni, Bolivia", "bo", -20.2043, -67.515,
    "A few centimetres of water over ten thousand square kilometres of salt, and then there is no horizon.",
    "the wet months, late in the day, when the water goes still and the sky doubles", null,
    ["desert", "photography", "minimalism", "solitude"], [1, 2, 3], "moderate", 2, 0.93, 0.4,
    "In the dry season it is a white plain cracked into hexagons, which is its own thing. Flooded, it stops being ground at all and you lose which way is up.",
  ],
  [
    "uluru-sunrise", "Uluru changing colour at sunrise", "Northern Territory, Australia", "au", -25.3449, 131.0325,
    "Grey, then brown, then a red you will not believe is real, over about twenty minutes.",
    "sunrise, from the dune walk, with the rock turning as the light arrives", "Anangu country for tens of thousands of years; the climb was closed for good in 2019",
    ["desert", "culture", "nature", "solitude"], [5, 6, 7, 8, 9], "premium", 2, 0.91, 0.2,
    "The base walk is ten kilometres and tells you more than the summit ever did. Signs ask you not to photograph certain faces; that request is the point, not an inconvenience.",
  ],
  [
    "alhambra-nasrid", "The Nasrid palaces on the first ticket", "Granada, Spain", "es", 37.1761, -3.5881,
    "Plaster cut into honeycomb, water kept dead flat on purpose, and the Sierra Nevada through every arch.",
    "the first Nasrid entry slot of the day, before the courtyards fill", "built by the Nasrid emirs through the 13th and 14th centuries, and taken in 1492",
    ["architecture", "history", "culture", "water"], [4, 5, 6, 9, 10], "moderate", 1, 0.9, 0.15,
    "The palaces are timed-entry and the early slot is the only quiet one. The still pools are engineering, not decoration: they are there to hold the reflection.",
  ],

  // ---------------------------------------------------------------------------------------------------------------
  // THE EXCEPTIONAL LIST. Forty entries that clear a harder bar than the catalogue above: something that happens on
  // certain days, somewhere you have to work to reach, or a thing you can do nowhere else. Twenty-four are seasonal,
  // which is the point — a card with eleven days left in its window is why somebody opens the app this week.
  //
  // `advisory` marks a card whose country or region carries a government Do Not Travel warning. It is written here
  // and kept out of the feed by the bar (bar.ts), so the card survives a change in the advisory without being
  // rewritten, and cannot surface while the warning stands.
  // ---------------------------------------------------------------------------------------------------------------
  [
    "luxor-eclipse", "Totality over the Valley of the Kings", "Luxor, Egypt", "eg", 25.6872, 32.6396,
    "Six minutes and twenty-three seconds of night, at midday, over four thousand years of temples.",
    "the morning of 2 August 2027, as the shadow crosses the Nile", "temples raised here from about 1400 BCE",
    ["history", "desert", "photography", "culture"], [8], "moderate", 2, 0.98, 0.93,
    "The longest total solar eclipse visible from land until 2114 passes directly over Upper Egypt. Luxor sits almost exactly on the centre line, and August gives it the clearest sky on the whole track.\n\nTotality lasts six minutes twenty-three seconds. Most people who chase eclipses never see one over two.",
  ],
  [
    "sardine-run", "Inside the bait ball on the Wild Coast", "Eastern Cape, South Africa", "za", -31.6287, 29.5447,
    "A billion sardines moving north, and everything that eats them arriving at once.",
    "winter mornings, when the shoal shows on the sounder", null,
    ["wildlife", "water", "adventure"], [6, 7], "premium", 4, 0.97, 0.78,
    "Cold water pushes a shoal of sardines north along the Wild Coast and the ocean organises itself around them: common dolphin herding from below, bronze whalers through the middle, gannets hitting the surface like gunfire.\n\nIt fails some years entirely. Nobody can promise you it will happen, which is the honest part of booking it.",
  ],
  [
    "monarch-michoacan", "The morning the butterflies lift", "Michoacán, Mexico", "mx", 19.5861, -100.2819,
    "Fir branches bending under the weight of them, and a sound like rain when they fly.",
    "late morning, when the sun first warms the grove", null,
    ["wildlife", "nature", "hiking"], [11, 12, 1, 2, 3], "budget", 3, 0.96, 0.72,
    "Monarchs arrive from Canada and cover the oyamel firs so densely the branches bend. They stay still and grey-brown while it is cold.\n\nThen the sun reaches the grove and twenty million of them open at once. People go quiet when it happens.",
  ],
  [
    "smokies-fireflies", "The two weeks the forest flashes together", "Tennessee, United States", "us", 35.6531, -83.5806,
    "Thousands of fireflies, blinking in unison, for about ten days a year.",
    "full dark, on a humid night in early June", null,
    ["wildlife", "camping", "nature", "photography"], [5, 6], "budget", 2, 0.88, 0.91,
    "Photinus carolinus is one of very few species on earth that synchronises. The whole hillside goes dark, then every insect on it flashes at once, six times, then dark again.\n\nThe window is about two weeks and nobody can tell you the dates until a few weeks out. Access is by lottery for a parking pass.",
  ],
  [
    "christmas-island-crabs", "The week the island closes its roads", "Christmas Island, Australia", "cx", -10.4475, 105.6904,
    "A hundred million red crabs crossing an island, and bridges built so they can.",
    "the first rains of the wet, on the last quarter moon", null,
    ["wildlife", "island", "nature"], [10, 11, 12], "premium", 3, 0.96, 0.94,
    "The crabs live in the forest and spawn in the sea, so once a year they walk there — all of them, together, keyed to the first rain and the turn of the moon. Roads close. Underpasses and a five-metre bridge exist purely for them.\n\nNumbers are well down since the yellow crazy ant arrived, which makes seeing it now a different kind of urgent.",
  ],
  [
    "mara-balloon", "Dawn over a river crossing", "Masai Mara, Kenya", "ke", -1.4061, 35.0078,
    "The burner goes quiet and you can hear two hundred thousand animals moving below.",
    "lift-off before sunrise, while the herd is still on the move", null,
    ["wildlife", "adventure", "luxury", "photography"], [7, 8, 9, 10], "luxury", 2, 0.95, 0.52,
    "A balloon goes up before first light and drifts over the migration at a few hundred feet. From up there the herd reads as a single dark line across the whole plain.\n\nThe crossings themselves are unscheduled — the animals mass at the bank for hours and then go, or don't. People stay a week for it.",
  ],
  [
    "snow-hill-emperors", "Standing in an emperor colony", "Weddell Sea, Antarctica", "aq", -64.4667, -57.3833,
    "Ten thousand emperor penguins, and a helicopter the only way in.",
    "late spring, while the fast ice still holds", null,
    ["wildlife", "cold", "adventure", "luxury"], [10, 11], "luxury", 5, 0.99, 0.96,
    "A handful of icebreakers reach the Weddell Sea each spring and fly guests by helicopter to the fast ice beside Snow Hill Island, where emperors raise chicks through the coldest winter on earth.\n\nSome seasons the ice is wrong and nobody lands at all. A few hundred people a year see this.",
  ],
  [
    "skjervoy-orca", "Orca in four hours of blue light", "Troms, Norway", "no", 70.0333, 20.9667,
    "Herring fill the fjord, the whales follow, and the sun never quite rises.",
    "the short blue twilight of an arctic midwinter day", null,
    ["wildlife", "cold", "water", "photography"], [11, 12, 1], "premium", 4, 0.95, 0.74,
    "Each winter the herring move into the fjords around Skjervøy and orca and humpback come in behind them, working the shoal in water you can reach from a small boat.\n\nAt seventy degrees north in December there are about four usable hours of light, all of it blue. The aurora often starts before the whales have finished.",
  ],
  [
    "san-ignacio-greys", "When the whale brings her calf to you", "Baja California Sur, Mexico", "mx", 26.7500, -113.2000,
    "A grey whale decides to be touched, and pushes her calf alongside the boat.",
    "mid-morning, when the lagoon goes glassy", null,
    ["wildlife", "water", "warm", "solitude"], [1, 2, 3], "premium", 2, 0.96, 0.81,
    "Grey whales come to three Baja lagoons to calve. In San Ignacio something unusual happens: the mothers approach the skiffs on their own and hold station beside them, and bring the calves.\n\nNobody makes them. The behaviour has held for forty years and it exists almost nowhere else.",
  ],
  [
    "silfra", "Two continents, one arm's length apart", "Þingvellir, Iceland", "is", 64.2558, -21.1180,
    "Water filtered through lava for fifty years, and visibility past a hundred metres.",
    "midday, when the light reaches the bottom of the fissure", null,
    ["adventure", "water", "cold", "nature"], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], "moderate", 3, 0.9, 0.73,
    "Silfra is a flooded crack between the North American and Eurasian plates, fed by glacial meltwater that has spent half a century percolating through porous rock.\n\nThe result is some of the clearest water on the planet, at two degrees. In places you can put a hand on each continent.",
  ],
  [
    "dominica-sperm-whales", "Hearing a sperm whale through your chest", "Dominica", "dm", 15.3092, -61.3794,
    "The only country on earth that permits you to swim with them.",
    "winter mornings on the leeward side", null,
    ["wildlife", "water", "island", "warm"], [11, 12, 1, 2, 3], "luxury", 3, 0.98, 0.9,
    "A resident family of sperm whales lives off Dominica's west coast year-round, and Dominica is the only nation that issues permits to enter the water with them.\n\nYou hear them long before you see anything. The clicks are loud enough to feel in your sternum.",
  ],
  [
    "tonga-humpbacks", "Swimming beside a humpback calf", "Vava'u, Tonga", "to", -18.6500, -173.9833,
    "She came here to give birth, and she will stay for three months.",
    "calm mornings through the southern winter", null,
    ["wildlife", "island", "water", "warm"], [7, 8, 9, 10], "luxury", 3, 0.97, 0.84,
    "Humpbacks migrate from Antarctica to the warm shallows of Vava'u to calve, and Tonga is one of a handful of places where licensed in-water encounters are legal.\n\nFour swimmers, one guide, and a forty-tonne animal that decides how close this goes.",
  ],
  [
    "ningaloo-whale-sharks", "Dropping in ahead of the biggest fish alive", "Western Australia", "au", -21.9333, 114.1283,
    "A reef you can swim to from the sand, and an eighteen-metre shark beyond it.",
    "autumn mornings, after the coral spawn", null,
    ["wildlife", "beach", "water", "warm"], [3, 4, 5, 6, 7], "premium", 2, 0.92, 0.6,
    "Ningaloo is a fringing reef — four hundred kilometres of it, reachable by wading off the beach. After the March coral spawn the whale sharks arrive to feed.\n\nA spotter plane finds one, the boat puts you in ahead of its line, and you swim until it outpaces you, which it will.",
  ],
  [
    "raja-ampat", "The richest reef on earth", "West Papua, Indonesia", "id", -0.5000, 130.5000,
    "More coral species in one bay than in the entire Caribbean.",
    "slack water on the morning tide, before the current builds", null,
    ["water", "wildlife", "island", "warm"], [10, 11, 12, 1, 2, 3, 4], "luxury", 3, 0.97, 0.79,
    "Raja Ampat sits at the centre of the Coral Triangle and holds the highest recorded marine biodiversity anywhere: three quarters of all known coral species, in an archipelago of limestone islands.\n\nThe currents that feed it are also what makes it serious diving. A liveaboard is the only sane way to see it.",
  ],
  [
    "kona-mantas", "Lying on the seabed under feeding mantas", "Hawai'i, United States", "us", 19.6400, -155.9969,
    "Lights pull the plankton, plankton pulls the mantas, and they roll inches above you.",
    "after full dark, with the lights down on the sand", null,
    ["wildlife", "water", "warm", "island"], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], "moderate", 2, 0.89, 0.55,
    "Dive lights are set on the sand in twelve metres of water, plankton gathers in the beams, and the mantas come to feed.\n\nYou hold the bottom and stay still while four-metre animals barrel-roll past your mask for an hour.",
  ],
  [
    "son-doong", "Four days inside the largest cave on earth", "Quảng Bình, Vietnam", "vn", 17.5467, 106.2878,
    "Big enough for its own weather, its own jungle, and its own clouds.",
    "camping on the cave floor, under the first doline", null,
    ["adventure", "camping", "hiking", "nature"], [1, 2, 3, 4, 5, 6, 7, 8], "luxury", 5, 0.99, 0.95,
    "Son Doong's main passage is five kilometres long, two hundred metres high, and holds a jungle where the roof collapsed and let the light in. Cloud forms inside it.\n\nAbout a thousand permits are issued a year, through one operator, and the waiting list runs well over a year.",
  ],
  [
    "deadvlei", "Sunrise on trees dead nine hundred years", "Namib-Naukluft, Namibia", "na", -24.7592, 15.2922,
    "Black skeletons on white clay, against the biggest dune you have ever stood under.",
    "first light, before the contrast burns out", "the trees died when the river was cut off, around 1100",
    ["desert", "minimalism", "photography", "solitude"], [5, 6, 7, 8, 9], "premium", 3, 0.97, 0.66,
    "A river once fed this pan. When the dunes cut it off, the camelthorns died — and it is too dry here for them to rot, so they are still standing, black and intact, on bone-white clay.\n\nGo at sunrise. An hour later the sun is overhead and the whole composition flattens out.",
  ],
  [
    "lencois", "A desert that fills with lagoons", "Maranhão, Brazil", "br", -2.4858, -43.1281,
    "Rain on dunes with nowhere to drain, and a thousand pools you can swim in.",
    "midday, when the lagoons go turquoise", null,
    ["desert", "water", "nature", "solitude"], [6, 7, 8, 9], "moderate", 3, 0.96, 0.87,
    "Fifteen hundred square kilometres of white dunes sit on impermeable rock. The rains fill the valleys between the crests, and for a few months there are freshwater lagoons strung across a desert.\n\nThen they evaporate. The window is roughly June to September and it moves with the rain.",
  ],
  [
    "tsingy-bemaraha", "Crossing a forest of stone knives", "Melaky, Madagascar", "mg", -18.7333, 44.7167,
    "Limestone eroded into blades that will cut through a boot sole.",
    "early, on the via ferrata before the rock heats up", null,
    ["adventure", "hiking", "wildlife", "nature"], [4, 5, 6, 7, 8, 9, 10, 11], "premium", 5, 0.96, 0.92,
    "Tsingy means where one cannot walk barefoot. Rain has cut the limestone into a field of vertical needles, crossed on fixed cables and rope bridges hundreds of feet up.\n\nLemurs move through it faster than you will. The whole park closes in the rains.",
  ],
  [
    "ijen-blue-fire", "The crater that burns blue at one in the morning", "East Java, Indonesia", "id", -8.0583, 114.2419,
    "Sulphuric gas igniting as it escapes, visible only in the dark.",
    "between one and four in the morning, before the sky greys", null,
    ["adventure", "hiking", "nature", "photography"], [4, 5, 6, 7, 8, 9, 10], "budget", 4, 0.95, 0.76,
    "Gas vents at six hundred degrees and catches fire as it meets the air, burning electric blue down the crater wall. Daylight erases it completely, so you climb at one in the morning.\n\nMiners pass you on the way down carrying ninety kilos of sulphur each, twice a night, which rearranges how you feel about the hike.",
  ],
  [
    "mt-yasur", "Standing on the rim of a volcano that never stops", "Tanna, Vanuatu", "vu", -19.5200, 169.4472,
    "A ten-minute walk to a crater that has been erupting continuously for eight hundred years.",
    "dusk, when the glow starts to beat the daylight", "continuously active since at least the 1770s",
    ["adventure", "nature", "island", "photography"], [4, 5, 6, 7, 8, 9, 10], "premium", 2, 0.97, 0.89,
    "Yasur is probably the most accessible active vent on earth: a truck to the ash plain, then ten minutes on foot to a rim where lava is thrown above head height every few minutes.\n\nHow close you get depends on the activity level that day, which is posted and is not negotiable.",
  ],
  [
    "kolmanskop", "A ballroom filled to the waist with sand", "Karas, Namibia", "na", -26.7036, 15.2297,
    "A diamond town abandoned in 1956, and the desert has been coming in ever since.",
    "sunrise, on the photographer's permit, before the tours", "abandoned in 1956 when the diamonds ran out",
    ["desert", "history", "architecture", "photography"], [5, 6, 7, 8, 9], "budget", 1, 0.9, 0.8,
    "Kolmanskop had a hospital, a theatre and the first X-ray machine in the southern hemisphere. When the richer fields opened to the south, everyone left.\n\nSand has come through the windows for seventy years. Some rooms are filled past the door handles.",
  ],
  [
    "svalbard-polar-night", "Four months without a sunrise", "Svalbard, Norway", "sj", 78.2232, 15.6267,
    "Not darkness — weeks of deep blue, with aurora at lunchtime.",
    "the blue hours of midwinter, which last all day", null,
    ["cold", "solitude", "minimalism", "wildlife"], [11, 12, 1, 2], "premium", 3, 0.95, 0.85,
    "At seventy-eight degrees north the sun does not clear the horizon between late October and mid-February. What you get instead is months of blue twilight, and aurora in the middle of the working day.\n\nYou are required to carry a rifle outside the settlement, because of the bears.",
  ],
  [
    "vatnajokull-ice-cave", "Inside a glacier, for one winter only", "Southeast Iceland", "is", 64.0167, -16.9667,
    "Meltwater carves them each summer; they are only safe to enter in the cold.",
    "deep winter, once the glacier has frozen hard", null,
    ["adventure", "cold", "nature", "photography"], [11, 12, 1, 2, 3], "premium", 3, 0.94, 0.62,
    "Summer meltwater cuts tunnels through Vatnajökull, and when the glacier refreezes they become walkable — translucent blue, ribbed, striped with black volcanic ash.\n\nNone of them survives a second year. The cave you walk into this winter will not be there next winter.",
  ],
  [
    "chugach-heliski", "First tracks on a face nobody has touched", "Alaska, United States", "us", 61.1308, -146.3483,
    "The deepest maritime snowpack on earth, stuck to walls that should not hold it.",
    "spring mornings, once the pack has set up", null,
    ["adventure", "cold", "mountains", "luxury"], [3, 4], "luxury", 5, 0.96, 0.77,
    "The Chugach gets enormous, heavy, coastal snow that bonds to faces far steeper than snow has any right to sit on. Helicopters put one group on one spine at a time.\n\nYou pay for the week whether or not it flies, and some weeks it does not fly at all.",
  ],
  [
    "haute-route", "Six days on skis from Chamonix to Zermatt", "Valais, Switzerland", "ch", 45.9237, 6.8694,
    "Hut to hut across the spine of the Alps, finishing under the Matterhorn.",
    "climbing on skins at first light, out of a hut", "first skied as a spring traverse in 1911",
    ["mountains", "adventure", "hiking", "cold"], [3, 4], "premium", 5, 0.92, 0.5,
    "The classic high-level route: six days of glacier travel, sleeping in huts, skinning up at dawn and skiing down in the afternoon, with the Matterhorn in front of you for the last two days.\n\nIt is a ski tour, not a trek. You have to be able to ski a glacier in bad snow with a pack on.",
  ],
  [
    "snowman-trek", "Twenty-five days over eleven passes", "Gasa and Bumthang, Bhutan", "bt", 27.9833, 89.7000,
    "No road out once you start, and fewer than half who begin it finish.",
    "autumn, in the window between monsoon and snow", null,
    ["mountains", "hiking", "adventure", "cold"], [9, 10], "luxury", 5, 0.97, 0.94,
    "The Snowman crosses eleven passes above 4,500 metres along the Tibetan border, and for most of its length there is no way off it but forward.\n\nWeather closes the route most years. Completion rates sit under fifty percent, and that is among people fit enough to be allowed to start.",
  ],
  [
    "naadam", "Horse racing across open steppe", "Mongolia", "mn", 47.9186, 106.9176,
    "Children riding thirty kilometres flat out, on grass, with no track.",
    "the three days of midsummer, at a provincial festival", "held in some form since the 1200s",
    ["culture", "social", "adventure", "history"], [7], "moderate", 3, 0.91, 0.75,
    "Naadam is wrestling, archery and horse racing, and it has been going for eight centuries. The races are run by children over twenty to thirty kilometres of open ground.\n\nGo to a provincial one rather than the stadium in Ulaanbaatar. The countryside version is still mostly for Mongolians.",
  ],
  [
    "oaxaca-muertos", "Sitting up all night in the cemetery", "Oaxaca, Mexico", "mx", 17.0732, -96.7266,
    "Marigolds, candles, a brass band, and families staying until dawn.",
    "the night of the first of November, in a village panteón", null,
    ["culture", "food", "social", "history"], [10, 11], "budget", 2, 0.89, 0.46,
    "Día de Muertos in Oaxaca is not a parade. Families clean the graves, build an arch of marigolds, bring food and mezcal, and spend the night there.\n\nThe villages outside the city — Xoxocotlán, Atzompa — are where it stays what it is.",
  ],
  [
    "yi-peng", "Ten thousand lanterns leaving at once", "Chiang Mai, Thailand", "th", 18.7883, 98.9853,
    "The sky fills while the river fills, on the same full moon.",
    "the full moon of the twelfth lunar month, after dark", null,
    ["culture", "photography", "social", "warm"], [11], "budget", 2, 0.93, 0.44,
    "Yi Peng sends lanterns into the sky and Loy Krathong floats them down the river, and they fall on the same night.\n\nThe ticketed mass releases are a recent, separate thing. The temple ceremonies around the old city are the older one.",
  ],
  [
    "hornbill-nagaland", "Sixteen tribes, ten days, one hillside", "Nagaland, India", "in", 25.6000, 94.1000,
    "Peoples who had almost no contact with outsiders two generations ago.",
    "the first ten days of December, at Kisama", null,
    ["culture", "social", "history", "food"], [12], "moderate", 3, 0.9, 0.88,
    "The Hornbill Festival gathers the Naga tribes at a purpose-built heritage village below Kohima: log drums, morung longhouses, woven textiles and a great deal of rice beer.\n\nNagaland still requires a protected-area permit. Two generations ago much of this was closed to outsiders entirely.",
  ],
  [
    "up-helly-aa", "Burning a longship in the dark of January", "Shetland, Scotland", "gb", 60.1546, -1.1494,
    "A thousand torches, six hours of daylight, and the whole town off work tomorrow.",
    "the last Tuesday of January, after dark", "in its present form since the 1880s",
    ["culture", "cold", "social", "history"], [1], "moderate", 2, 0.91, 0.86,
    "A galley is built over the winter, dragged through Lerwick by a squad carrying a thousand burning torches, and then set alight and left to go.\n\nShetland in late January gets about six hours of light. The whole island takes the next day off, formally.",
  ],
  [
    "kumano-kodo", "A pilgrims' road between hot springs", "Wakayama, Japan", "jp", 33.8403, 135.7739,
    "Stone steps worn into curves by a thousand years of feet.",
    "early morning, walking out of a sleeping onsen town", "walked by emperors from the 900s onward",
    ["hiking", "culture", "history", "nature"], [3, 4, 5, 10, 11], "moderate", 3, 0.89, 0.71,
    "One of only two pilgrimage routes on the World Heritage list — the other is the Camino. Cedar forest, moss, small shrines, and a different onsen town at the end of each day.\n\nYou can have your bag moved ahead of you, which means walking all day with nothing and getting into hot water at the end of it.",
  ],
  [
    "gorilla-trek", "One hour with a gorilla family", "Volcanoes National Park, Rwanda", "rw", -1.4667, 29.4833,
    "Eight people, sixty minutes, and then you leave. That cap is why they are still here.",
    "mid-morning, after the trackers radio a position", null,
    ["wildlife", "hiking", "nature", "adventure"], [6, 7, 8, 9, 12, 1, 2], "luxury", 4, 0.98, 0.83,
    "Permits are capped and deliberately expensive — around $1,500 in Rwanda, $800 in Uganda — and the money is what funds the protection. Mountain gorilla numbers have risen for thirty years because of it.\n\nYou walk until the trackers find them, then you have one hour. Nobody gets longer.",
  ],
  [
    "socotra", "Trees that grow nowhere else on earth", "Socotra, Yemen", "ye", 12.4634, 53.8233,
    "A third of the plant life here exists on this island and no other.",
    "the dry months, before the monsoon winds shut the sea", null,
    ["island", "nature", "solitude", "adventure"], [10, 11, 12, 1, 2, 3, 4], "luxury", 5, 0.98, 0.97,
    "Socotra separated from the mainland so long ago that its flora went its own way: dragon's blood trees shaped like umbrellas, bottle trees growing straight out of bare limestone, cucumber trees.\n\nAccess is a weekly flight from Jeddah through a licensed operator. Yemen carries a Do Not Travel advisory and this card stays out of the feed while it stands.",
    "do_not_travel",
  ],
  [
    "tristan-da-cunha", "Six days by boat to the last island", "Tristan da Cunha, South Atlantic", "sh", -37.1052, -12.2777,
    "Two hundred and fifty people, no airstrip, and nine sailings a year.",
    "the southern summer, when the swell lets a boat land", "settled in 1816",
    ["island", "solitude", "water", "adventure"], [9, 10, 11, 12, 1, 2, 3, 4], "luxury", 5, 0.96, 0.98,
    "The most remote inhabited island on earth: 2,800 kilometres from South Africa, 3,300 from South America, and reachable only by a fishing vessel out of Cape Town.\n\nYou need permission from the island council before you sail, and once you are there you stay until the next boat.",
  ],
  [
    "pamir-highway", "Driving the roof of the world", "Gorno-Badakhshan, Tajikistan", "tj", 38.1667, 73.9667,
    "Twelve hundred kilometres of Soviet military road, with Afghanistan across the river.",
    "summer, in the brief window the passes are open", "built as a military road through the 1930s",
    ["road_trip", "mountains", "solitude", "adventure"], [6, 7, 8, 9], "moderate", 4, 0.94, 0.86,
    "The M41 runs from Osh to Dushanbe over passes above 4,600 metres, through the Wakhan corridor where the Panj river is the only thing between the road and Afghanistan.\n\nYou need a GBAO permit, and there are stretches with no fuel for two hundred kilometres.",
  ],
  [
    "atacama-sky", "The clearest sky on the planet", "Antofagasta, Chile", "cl", -22.9087, -68.1997,
    "Three hundred cloudless nights a year, which is why the observatories are here.",
    "moonless nights, once your eyes have adjusted", null,
    ["desert", "photography", "solitude", "minimalism"], [4, 5, 6, 7, 8, 9], "moderate", 2, 0.92, 0.48,
    "The driest non-polar desert on earth, at 2,400 metres, with almost no humidity and almost no light. ALMA and the VLT are here for exactly that reason.\n\nOn a good night the galactic core is bright enough to cast a shadow on the salt.",
  ],
];

function cardOf(row: Row): Card {
  const [slug, title, where, country, lat, lon, hook, moment, dated, tags, months, budget, effort, wow, rarity, story, advisory] = row;
  return {
    id: `crd_${slug.replace(/-/g, "_")}`,
    slug,
    title,
    where,
    country,
    at: { lat, lon },
    hook,
    moment,
    dated,
    story,
    tags: [...tags],
    season: seasonFrom(months),
    budget,
    effort,
    rarity,
    wow,
    // One picture a place, shipped in the image and served at /photos/ (routes/app/staticFiles.ts). The url is
    // root-relative here; the route makes it absolute, so the catalogue stays a data file with no config in it.
    photos: PHOTOS[slug] ? [PHOTOS[slug]!] : [],
    origin: "ours",
    sources: [],
    forUserId: null,
    advisory: advisory ?? null,
  };
}

export const CURATED: readonly Card[] = ROWS.map(cardOf);

const BY_SLUG = new Map(CURATED.map((c) => [c.slug, c]));

export const curatedBySlug = (slug: string): Card | undefined => BY_SLUG.get(slug.trim().toLowerCase());

/** The countries we have written anything in, for "3 of 8 countries kept" and for telling a person where we are thin. */
export const curatedCountries = (): string[] => [...new Set(CURATED.map((c) => c.country))].sort();
