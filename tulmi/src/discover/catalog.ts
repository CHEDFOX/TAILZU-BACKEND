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
import type { Card } from "./types.js";
import { seasonFrom, type Budget, type Tag } from "./taxonomy.js";

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
    "arashiyama-bamboo-dawn", "The bamboo grove before anyone wakes", "Kansai, Japan", "jp", 35.0094, 135.6668,
    "Get there at first light and the loudest thing is the creak of the stalks.",
    "first light, before the first coach", null,
    ["culture", "nature", "photography", "solitude", "minimalism"], [3, 4, 5, 10, 11, 12], "moderate", 1, 0.82, 0.2,
    "",
  ],
  [
    "gion-lantern-night", "Gion after the lanterns come on", "Kansai, Japan", "jp", 35.0037, 135.7788,
    "Wooden machiya, warm paper light, and the sound of geta on stone.",
    "after the lanterns come on", "a pleasure district laid out in the 1600s",
    ["culture", "city", "food", "architecture", "history", "social"], [3, 4, 5, 9, 10, 11], "premium", 1, 0.79, 0.25,
    "",
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
    ["desert", "warm", "solitude", "adventure", "camping", "minimalism"], [1, 2, 3, 10, 11, 12], "budget", 3, 0.87, 0.62,
    "",
  ],
  [
    "benagil-sea-cave", "Kayaking into the Benagil cave", "Algarve, Portugal", "pt", 37.0876, -8.4267,
    "A cathedral of golden stone with a hole in the roof and a beach on the floor.",
    "first light, kayaking in before the tour boats", null,
    ["water", "warm", "beach", "adventure", "social", "photography"], [5, 6, 7, 8, 9], "budget", 2, 0.81, 0.35,
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
    ["culture", "history", "architecture", "minimalism"], [11, 12, 1, 2], "budget", 2, 0.86, 0.55,
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
    ["history", "minimalism", "culture", "desert"], [4, 5, 6, 9, 10], "budget", 1, 0.84, 0.6,
    "Hunter-gatherers quarried, carved and raised these pillars, then deliberately buried them. It is not much to look at next to a cathedral, and it rearranges what you thought people were doing that early.",
  ],
  [
    "cappadocia-valleys", "Valleys cut out of soft rock", "Goreme, Cappadocia", "tr", 38.6386, 34.8455,
    "Volcanic tuff carved into churches, houses and dovecotes, soft enough to dig with a spoon.",
    "first light, walking the Rose Valley before the balloons go up", "monks cut and painted the churches here through the 10th to 12th centuries",
    ["history", "photography", "adventure", "warm"], [4, 5, 6, 9, 10], "moderate", 2, 0.87, 0.25,
    "The balloons are the photograph, and the valleys underneath are the reason. You can walk between whole underground villages before breakfast.",
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
];

function cardOf(row: Row): Card {
  const [slug, title, where, country, lat, lon, hook, moment, dated, tags, months, budget, effort, wow, rarity, story] = row;
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
    photos: [],
    origin: "ours",
    sources: [],
    forUserId: null,
  };
}

export const CURATED: readonly Card[] = ROWS.map(cardOf);

const BY_SLUG = new Map(CURATED.map((c) => [c.slug, c]));

export const curatedBySlug = (slug: string): Card | undefined => BY_SLUG.get(slug.trim().toLowerCase());

/** The countries we have written anything in, for "3 of 8 countries kept" and for telling a person where we are thin. */
export const curatedCountries = (): string[] => [...new Set(CURATED.map((c) => c.country))].sort();
