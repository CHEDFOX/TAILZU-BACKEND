/**
 * THE PHOTOGRAPH EACH WRITTEN PLACE IS SHOWN WITH.
 *
 * Generated, not hand-written. Every file sits in tulmi/photos, is served at /photos/ (routes/app/staticFiles.ts),
 * and is credited on the card it appears on. Each was taken from Wikimedia Commons under a free licence and then
 * GRADED to one look — a sharp centre with the edges eased off, shadows pulled toward the bot's sea blue,
 * highlights warmed, saturation eased — so thirty strangers' photographs read as one publication rather than a
 * page of search results.
 *
 * THE GRADE MAKES EACH ONE A DERIVATIVE, so every credit names the photographer, names the licence, and says the
 * picture was altered. A CC BY-SA original keeps its licence here. tulmi/photos/CREDITS.md is the full list.
 *
 * Root-relative on purpose: catalog.ts is a data file and knows nothing about where the server lives; the route
 * makes these absolute (routes/bots/discover.ts).
 */
import type { Photo } from "./types.js";

export const PHOTOS: Readonly<Record<string, Photo>> = {
  "ajanta-lamplight": { url: "/photos/ajanta-lamplight.jpg", alt: "Cave 26, Ajanta", credit: "Wikimedia Commons · CC BY-SA 3.0 · Dey.sandip · altered", width: 1280, height: 831 },
  "alhambra-nasrid": { url: "/photos/alhambra-nasrid.jpg", alt: "Fountain patio de los Leones Alhambra Granada Spain", credit: "Wikimedia Commons · CC0 · Jebulon · altered", width: 1280, height: 907 },
  "angkor-wat": { url: "/photos/angkor-wat.jpg", alt: "Angkor Wat with its reflection (cropped)", credit: "Wikimedia Commons · CC BY-SA 4.0 · Satdeep Gill · altered", width: 1280, height: 645 },
  "arashiyama-bamboo-dawn": { url: "/photos/arashiyama-bamboo-dawn.jpg", alt: "Bamboo Forest, Arashiyama, Kyoto, Japan", credit: "Wikimedia Commons · CC BY-SA 4.0 · Basile Morin · altered", width: 1280, height: 853 },
  "bagan-temple-plain": { url: "/photos/bagan-temple-plain.jpg", alt: "Old Bagan, Myanmar, Landscape of ancient Bagan city", credit: "Wikimedia Commons · CC BY 4.0 · Vyacheslav Argenberg · altered", width: 1280, height: 719 },
  "benagil-sea-cave": { url: "/photos/benagil-sea-cave.jpg", alt: "Benagil Cave (3)", credit: "Wikimedia Commons · CC BY-SA 4.0 · Joseolgon · altered", width: 1280, height: 853 },
  "borobudur-mist": { url: "/photos/borobudur-mist.jpg", alt: "Borobudur-Temple-Park Indonesia Stupas-of-Borobudur-02", credit: "Wikimedia Commons · CC BY-SA 3.0 · CEphoto, Uwe Aranas · altered", width: 1280, height: 853 },
  "cappadocia-valleys": { url: "/photos/cappadocia-valleys.jpg", alt: "Göreme Valley in Cappadocia edit1", credit: "Wikimedia Commons · CC BY-SA 3.0 · Brocken Inaglory · altered", width: 1280, height: 798 },
  "erg-chebbi-silence": { url: "/photos/erg-chebbi-silence.jpg", alt: "Erg Chebbi sunset", credit: "Wikimedia Commons · CC BY-SA 4.0 · Thomas Fuhrmann · altered", width: 1280, height: 854 },
  "gion-lantern-night": { url: "/photos/gion-lantern-night.jpg", alt: "Gion in evening", credit: "Wikimedia Commons · CC BY 3.0 · Chi King · altered", width: 1280, height: 854 },
  "gobekli-tepe": { url: "/photos/gobekli-tepe.jpg", alt: "Gobekli Tepe Surroundings 2014 3114", credit: "Wikimedia Commons · CC BY-SA 4.0 · Dosseman · altered", width: 1280, height: 852 },
  "great-zimbabwe": { url: "/photos/great-zimbabwe.jpg", alt: "Great-zim-aerial-looking-West.JPG", credit: "Wikimedia Commons · CC BY-SA 4.0 · Janice Bell · altered", width: 1280, height: 850 },
  "hamnoy-bridge-dawn": { url: "/photos/hamnoy-bridge-dawn.jpg", alt: "Lofoten Hamnoy", credit: "Wikimedia Commons · CC BY-SA 3.0 · Photographer: Mg-k . · altered", width: 1280, height: 840 },
  "hampi-boulders": { url: "/photos/hampi-boulders.jpg", alt: "Hampi, India, Rocky landscape of Hampi, Granite rocks of Matanga Hill", credit: "Wikimedia Commons · CC BY 4.0 · Vyacheslav Argenberg · altered", width: 1280, height: 853 },
  "jiankou-wild-wall": { url: "/photos/jiankou-wild-wall.jpg", alt: "Jiankou Great Wall", credit: "Wikimedia Commons · CC BY-SA 4.0 · Ang Cheung · altered", width: 1280, height: 960 },
  "karnak-hypostyle": { url: "/photos/karnak-hypostyle.jpg", alt: "Luxor, Egypt, Karnak, Great Hypostyle Hall, Columns 2", credit: "Wikimedia Commons · CC BY 4.0 · Vyacheslav Argenberg · altered", width: 1280, height: 853 },
  "lalibela-bete-giyorgis": { url: "/photos/lalibela-bete-giyorgis.jpg", alt: "Bete Giyorgis 01", credit: "Wikimedia Commons · CC BY-SA 3.0 · Bernard Gagnon · altered", width: 1280, height: 903 },
  "lofoten-blue-hour": { url: "/photos/lofoten-blue-hour.jpg", alt: "Reine i Lofoten LC0148", credit: "Wikimedia Commons · CC BY-SA 2.0 de · Jörg Hempel · altered", width: 1280, height: 906 },
  "machu-picchu-first-light": { url: "/photos/machu-picchu-first-light.jpg", alt: "Machu Picchu, Perú, 2015-07-30, DD 47.JPG", credit: "Wikimedia Commons · CC BY-SA 4.0 · Diego Delso · altered", width: 1280, height: 851 },
  "meteora-monasteries": { url: "/photos/meteora-monasteries.jpg", alt: "DSC 0548 meteora monastery 2", credit: "Wikimedia Commons · CC BY 4.0 · Jolovema · altered", width: 1280, height: 853 },
  "petra-siq-dawn": { url: "/photos/petra-siq-dawn.jpg", alt: "Al-Khazneh (The Treasury) 2, Petra, Jordan", credit: "Wikimedia Commons · CC BY 4.0 · Vyacheslav Argenberg · altered", width: 1280, height: 853 },
  "rapa-nui-tongariki": { url: "/photos/rapa-nui-tongariki.jpg", alt: "Ahu Tongariki cropped", credit: "Wikimedia Commons · CC BY-SA 3.0 · Rivi · altered", width: 1280, height: 851 },
  "taj-first-light": { url: "/photos/taj-first-light.jpg", alt: "Taj Mahal, Agra, India edit2", credit: "Wikimedia Commons · CC BY-SA 4.0 · Yann ; edited by King of Hearts · altered", width: 1280, height: 841 },
  "teotihuacan-dawn": { url: "/photos/teotihuacan-dawn.jpg", alt: "Teotihuacan, Pyramid of the Sun and Avenue of the Dead (20686678965)", credit: "Wikimedia Commons · CC BY 2.0 · Arian Zwegers from Brussels, Belgium · altered", width: 1280, height: 853 },
  "tikal-temple-four": { url: "/photos/tikal-temple-four.jpg", alt: "Tikal Temple II", credit: "Wikimedia Commons · CC BY 2.0 · Mike Vondran derivative work: MrPanyGoff · altered", width: 1280, height: 1063 },
  "tre-cime-circuit": { url: "/photos/tre-cime-circuit.jpg", alt: "Drei Zinnen Tre Cime di Lavaredo Dolomites", credit: "Wikimedia Commons · CC BY-SA 3.0 · This Photo was taken by Wolfgang Moroder . Feel free to use my photos, but pleas · altered", width: 1280, height: 853 },
  "uluru-sunrise": { url: "/photos/uluru-sunrise.jpg", alt: "Petermann Ranges (AU), Uluru-Kata Tjuta National Park, Uluru, Kuniya Walk -- 2019 -- 3636", credit: "Wikimedia Commons · CC BY-SA 4.0 · Dietmar Rabich · altered", width: 1280, height: 853 },
  "uyuni-mirror": { url: "/photos/uyuni-mirror.jpg", alt: "Piles of Salt Salar de Uyuni Bolivia Luca Galuzzi 2006 a", credit: "Wikimedia Commons · CC BY-SA 2.5 · Luca Galuzzi ( Lucag ), edit by Trialsanderrors · altered", width: 1280, height: 845 },
  "vestrahorn-black-sand": { url: "/photos/vestrahorn-black-sand.jpg", alt: "Vestrahorn and Stokksnes beach in Iceland", credit: "Wikimedia Commons · CC BY 4.0 · Daniel Oberhaus · altered", width: 1280, height: 855 },
  "wanaka-roys-peak": { url: "/photos/wanaka-roys-peak.jpg", alt: "Wanaka, New Zealand, view 1", credit: "Wikimedia Commons · CC BY-SA 4.0 · Sky_xe · altered", width: 1280, height: 853 },
};
