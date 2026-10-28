/**
 * TOWNS AND CITIES PEOPLE TRAVEL TO, WITH WHERE THEY ARE: enough to find a trip's weather with no geocoder at all ("Pune", "Goa",
 * "Bangalore"). City centres to two decimals (about a kilometre), from public records; India first, then the places Indians fly to most.
 * Only a name that IS one of these (after "trip to", case and punctuation) is matched: "Koregaon Park, Pune" is a geocoder's job.
 */
import type { Place } from "./types.js";

type Row = [names: string, lat: number, lon: number, country?: string];

// The first name is the label; the rest are what people also call it.
const ROWS: Row[] = [
  ["Mumbai|Bombay", 19.08, 72.88], ["Delhi|New Delhi|NCR", 28.61, 77.21], ["Bengaluru|Bangalore|Blr", 12.97, 77.59], ["Hyderabad|Hyd", 17.39, 78.49],
  ["Chennai|Madras", 13.08, 80.27], ["Kolkata|Calcutta", 22.57, 88.36], ["Pune|Poona", 18.52, 73.86], ["Ahmedabad|Amdavad", 23.02, 72.57],
  ["Jaipur", 26.91, 75.79], ["Goa|Panaji|Panjim", 15.49, 73.83], ["North Goa|Calangute|Baga", 15.54, 73.76], ["South Goa|Margao|Madgaon", 15.27, 73.96],
  ["Udaipur", 24.59, 73.71], ["Jodhpur", 26.24, 73.02], ["Jaisalmer", 26.92, 70.91], ["Pushkar", 26.49, 74.55], ["Ajmer", 26.45, 74.64],
  ["Mount Abu", 24.59, 72.71], ["Agra", 27.18, 78.01], ["Varanasi|Banaras|Benares|Kashi", 25.32, 82.97], ["Lucknow", 26.85, 80.95],
  ["Rishikesh", 30.09, 78.27], ["Haridwar", 29.95, 78.16], ["Dehradun", 30.32, 78.03], ["Mussoorie", 30.46, 78.06], ["Nainital", 29.38, 79.46],
  ["Shimla", 31.10, 77.17], ["Manali", 32.24, 77.19], ["Kasol", 32.01, 77.31], ["Dharamshala|McLeod Ganj|Mcleodganj", 32.22, 76.32],
  ["Leh|Ladakh", 34.15, 77.58], ["Srinagar", 34.08, 74.80], ["Gulmarg", 34.05, 74.38], ["Amritsar", 31.63, 74.87], ["Chandigarh", 30.73, 76.78],
  ["Gurugram|Gurgaon", 28.46, 77.03], ["Noida", 28.54, 77.39], ["Mysuru|Mysore", 12.30, 76.64], ["Coorg|Kodagu|Madikeri", 12.42, 75.74],
  ["Chikmagalur|Chikkamagaluru", 13.32, 75.77], ["Hampi", 15.34, 76.46], ["Gokarna", 14.55, 74.32], ["Mangaluru|Mangalore", 12.91, 74.86],
  ["Ooty|Udhagamandalam", 11.41, 76.70], ["Kodaikanal", 10.24, 77.49], ["Coimbatore", 11.02, 76.96], ["Madurai", 9.93, 78.12],
  ["Puducherry|Pondicherry|Pondy", 11.94, 79.81], ["Mahabalipuram|Mamallapuram", 12.62, 80.19], ["Tirupati", 13.63, 79.42],
  ["Kochi|Cochin", 9.93, 76.27], ["Munnar", 10.09, 77.06], ["Alappuzha|Alleppey", 9.50, 76.34], ["Thiruvananthapuram|Trivandrum", 8.52, 76.94],
  ["Varkala", 8.73, 76.72], ["Wayanad|Kalpetta", 11.61, 76.08], ["Visakhapatnam|Vizag", 17.69, 83.22], ["Bhubaneswar", 20.30, 85.82],
  ["Puri", 19.81, 85.83], ["Darjeeling", 27.04, 88.27], ["Gangtok", 27.34, 88.61], ["Shillong", 25.58, 91.89], ["Guwahati", 26.14, 91.74],
  ["Kaziranga", 26.58, 93.17], ["Indore", 22.72, 75.86], ["Bhopal", 23.26, 77.41], ["Khajuraho", 24.83, 79.92], ["Nagpur", 21.15, 79.09],
  ["Nashik", 20.00, 73.79], ["Lonavala|Khandala", 18.75, 73.41], ["Mahabaleshwar", 17.92, 73.66], ["Alibaug|Alibag", 18.64, 72.87],
  ["Thane", 19.22, 72.98], ["Navi Mumbai", 19.03, 73.03], ["Surat", 21.17, 72.83], ["Vadodara|Baroda", 22.31, 73.18], ["Kutch|Bhuj", 23.24, 69.67],
  ["Kanpur", 26.45, 80.33], ["Patna", 25.59, 85.14], ["Ranchi", 23.34, 85.31], ["Raipur", 21.25, 81.63], ["Shirdi", 19.77, 74.48],
  ["Mathura", 27.49, 77.67], ["Vrindavan", 27.58, 77.70], ["Port Blair|Andaman", 11.62, 92.73], ["Havelock|Swaraj Dweep", 11.97, 93.00],
  ["Dubai", 25.20, 55.27, "ae"], ["Abu Dhabi", 24.45, 54.38, "ae"], ["Singapore", 1.35, 103.82, "sg"], ["Bangkok", 13.76, 100.50, "th"],
  ["Phuket", 7.88, 98.39, "th"], ["Bali|Denpasar", -8.65, 115.22, "id"], ["Kuala Lumpur|KL", 3.14, 101.69, "my"], ["Kathmandu", 27.72, 85.32, "np"],
  ["Pokhara", 28.21, 83.99, "np"], ["Colombo", 6.93, 79.86, "lk"], ["Maldives|Male", 4.18, 73.51, "mv"], ["Thimphu|Bhutan", 27.47, 89.64, "bt"],
  ["London", 51.51, -0.13, "gb"], ["Paris", 48.86, 2.35, "fr"], ["New York|NYC", 40.71, -74.01, "us"], ["Tokyo", 35.68, 139.69, "jp"],
];

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();

const BY_NAME = new Map<string, Place>();
for (const [names, lat, lon, country] of ROWS) {
  const all = names.split("|");
  const place: Place = { lat, lon, label: all[0]!, country: country ?? "in" };
  for (const n of all) BY_NAME.set(norm(n), place);
}

/** The city these words name, or null. "Trip to Pune", "pune.", "Bangalore" match; "Koregaon Park, Pune" does not. */
export function cityNamed(words: string): Place | null {
  const n = norm(words).replace(/^(a )?(trip|travel|holiday|vacation|weekend|visit|going|flight|train)( to| in)? /, "").replace(/ (trip|city|town)$/, "");
  return BY_NAME.get(n) ?? null;
}

/** The country a person probably is in from their offset: India at +5:30. Only used as a hint to a geocoder. */
export function countryForOffset(tzMinutes: number): string | undefined {
  return tzMinutes === 330 ? "in" : undefined;
}
