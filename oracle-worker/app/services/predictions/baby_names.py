"""
JYOTISH ENGINE - BABY NAME GENERATOR
Based on Moon nakshatra pada → starting syllable → name suggestions.
Every Indian parent needs this.
"""

from typing import Dict

PADA_SOUNDS = {
    ('Ashwini', 1): 'Chu', ('Ashwini', 2): 'Che', ('Ashwini', 3): 'Cho', ('Ashwini', 4): 'La',
    ('Bharani', 1): 'Li', ('Bharani', 2): 'Lu', ('Bharani', 3): 'Le', ('Bharani', 4): 'Lo',
    ('Krittika', 1): 'A', ('Krittika', 2): 'Ee', ('Krittika', 3): 'U', ('Krittika', 4): 'Ea',
    ('Rohini', 1): 'O', ('Rohini', 2): 'Va', ('Rohini', 3): 'Vi', ('Rohini', 4): 'Vu',
    ('Mrigashira', 1): 'Ve', ('Mrigashira', 2): 'Vo', ('Mrigashira', 3): 'Ka', ('Mrigashira', 4): 'Ki',
    ('Ardra', 1): 'Ku', ('Ardra', 2): 'Gha', ('Ardra', 3): 'Ng', ('Ardra', 4): 'Na',
    ('Punarvasu', 1): 'Ke', ('Punarvasu', 2): 'Ko', ('Punarvasu', 3): 'Ha', ('Punarvasu', 4): 'Hi',
    ('Pushya', 1): 'Hu', ('Pushya', 2): 'He', ('Pushya', 3): 'Ho', ('Pushya', 4): 'Da',
    ('Ashlesha', 1): 'Di', ('Ashlesha', 2): 'Du', ('Ashlesha', 3): 'De', ('Ashlesha', 4): 'Do',
    ('Magha', 1): 'Ma', ('Magha', 2): 'Mi', ('Magha', 3): 'Mu', ('Magha', 4): 'Me',
    ('Purva Phalguni', 1): 'Mo', ('Purva Phalguni', 2): 'Ta', ('Purva Phalguni', 3): 'Ti', ('Purva Phalguni', 4): 'Tu',
    ('Uttara Phalguni', 1): 'Te', ('Uttara Phalguni', 2): 'To', ('Uttara Phalguni', 3): 'Pa', ('Uttara Phalguni', 4): 'Pi',
    ('Hasta', 1): 'Pu', ('Hasta', 2): 'Sha', ('Hasta', 3): 'Na', ('Hasta', 4): 'Tha',
    ('Chitra', 1): 'Pe', ('Chitra', 2): 'Po', ('Chitra', 3): 'Ra', ('Chitra', 4): 'Ri',
    ('Swati', 1): 'Ru', ('Swati', 2): 'Re', ('Swati', 3): 'Ro', ('Swati', 4): 'Ta',
    ('Vishakha', 1): 'Ti', ('Vishakha', 2): 'Tu', ('Vishakha', 3): 'Te', ('Vishakha', 4): 'To',
    ('Anuradha', 1): 'Na', ('Anuradha', 2): 'Ni', ('Anuradha', 3): 'Nu', ('Anuradha', 4): 'Ne',
    ('Jyeshtha', 1): 'No', ('Jyeshtha', 2): 'Ya', ('Jyeshtha', 3): 'Yi', ('Jyeshtha', 4): 'Yu',
    ('Mula', 1): 'Ye', ('Mula', 2): 'Yo', ('Mula', 3): 'Bha', ('Mula', 4): 'Bhi',
    ('Purva Ashadha', 1): 'Bhu', ('Purva Ashadha', 2): 'Dha', ('Purva Ashadha', 3): 'Pha', ('Purva Ashadha', 4): 'Dha',
    ('Uttara Ashadha', 1): 'Bhe', ('Uttara Ashadha', 2): 'Bho', ('Uttara Ashadha', 3): 'Ja', ('Uttara Ashadha', 4): 'Ji',
    ('Shravana', 1): 'Khi', ('Shravana', 2): 'Khu', ('Shravana', 3): 'Khe', ('Shravana', 4): 'Kho',
    ('Dhanishta', 1): 'Ga', ('Dhanishta', 2): 'Gi', ('Dhanishta', 3): 'Gu', ('Dhanishta', 4): 'Ge',
    ('Shatabhisha', 1): 'Go', ('Shatabhisha', 2): 'Sa', ('Shatabhisha', 3): 'Si', ('Shatabhisha', 4): 'Su',
    ('Purva Bhadrapada', 1): 'Se', ('Purva Bhadrapada', 2): 'So', ('Purva Bhadrapada', 3): 'Da', ('Purva Bhadrapada', 4): 'Di',
    ('Uttara Bhadrapada', 1): 'Du', ('Uttara Bhadrapada', 2): 'Tha', ('Uttara Bhadrapada', 3): 'Jha', ('Uttara Bhadrapada', 4): 'Da',
    ('Revati', 1): 'De', ('Revati', 2): 'Do', ('Revati', 3): 'Cha', ('Revati', 4): 'Chi',
}

# Name database by starting sound (common Indian names)
NAME_DB = {
    'Chu': {'male': ['Chunmay', 'Chudamani'], 'female': ['Chunni', 'Chulbuli']},
    'Che': {'male': ['Chetan', 'Chandra'], 'female': ['Chetna', 'Cheshta']},
    'Cho': {'male': ['Chokha'], 'female': ['Choti']},
    'La': {'male': ['Lakshman', 'Lalit', 'Lavan'], 'female': ['Lakshmi', 'Lalita', 'Lavanya', 'Lata']},
    'A': {'male': ['Arjun', 'Aditya', 'Aarav', 'Ansh', 'Abhinav'], 'female': ['Ananya', 'Aisha', 'Aditi', 'Aarohi', 'Akshara']},
    'Ee': {'male': ['Ishan', 'Ishaan'], 'female': ['Isha', 'Ishita', 'Ira']},
    'U': {'male': ['Uday', 'Ujjwal', 'Utkarsh'], 'female': ['Uma', 'Urvi', 'Unnati']},
    'O': {'male': ['Om', 'Omkar', 'Onkar'], 'female': ['Omisha']},
    'Va': {'male': ['Varun', 'Vashisht', 'Vaibhav', 'Vansh'], 'female': ['Vanya', 'Varsha', 'Vaani']},
    'Vi': {'male': ['Vivaan', 'Vikas', 'Vishnu', 'Vihaan', 'Vinay'], 'female': ['Vidya', 'Visha', 'Vinita']},
    'Ku': {'male': ['Kumar', 'Kunal', 'Kushagra', 'Kush'], 'female': ['Kumari', 'Kuhu', 'Kushali']},
    'Ke': {'male': ['Keshav', 'Kedar', 'Keyur'], 'female': ['Keya', 'Ketki']},
    'Ko': {'male': ['Komal', 'Kovid'], 'female': ['Komal', 'Kriti']},
    'Ha': {'male': ['Harsh', 'Harshit', 'Hardik', 'Hari'], 'female': ['Harsha', 'Harini', 'Hansa']},
    'Ma': {'male': ['Manish', 'Madhav', 'Mayank', 'Manan'], 'female': ['Mansi', 'Madhuri', 'Maya', 'Mahi']},
    'Na': {'male': ['Nakul', 'Naman', 'Naveen', 'Narayan'], 'female': ['Namita', 'Navya', 'Naina', 'Nalini']},
    'Ra': {'male': ['Rahul', 'Raj', 'Ravi', 'Rohan', 'Rakesh'], 'female': ['Radha', 'Riya', 'Rani', 'Radhika']},
    'Ri': {'male': ['Rishabh', 'Ritik', 'Rishi'], 'female': ['Ritu', 'Riddhi', 'Riya']},
    'Ru': {'male': ['Rudra', 'Ruchir'], 'female': ['Ruchi', 'Rupali']},
    'Sa': {'male': ['Samarth', 'Sahil', 'Sagar', 'Satvik'], 'female': ['Sakshi', 'Sanya', 'Saanvi', 'Sahana']},
    'Sha': {'male': ['Shaurya', 'Shashank', 'Shankar'], 'female': ['Shakti', 'Shanti', 'Shikha']},
    'Da': {'male': ['Daksh', 'Darsh', 'Darpan'], 'female': ['Daksha', 'Damini', 'Diya']},
    'Ga': {'male': ['Gaurav', 'Ganesh', 'Gautam'], 'female': ['Gauri', 'Garima', 'Gayatri']},
    'Pa': {'male': ['Parth', 'Pawan', 'Pranav'], 'female': ['Pallavi', 'Priya', 'Pooja']},
    'Pu': {'male': ['Punit', 'Pushkar'], 'female': ['Purnima', 'Pushpa']},
    'Ta': {'male': ['Tanmay', 'Tarun', 'Tushar'], 'female': ['Tanvi', 'Tanya', 'Tara']},
    'Ti': {'male': ['Tilak', 'Tirtha'], 'female': ['Tithi', 'Tishya']},
    'Ya': {'male': ['Yash', 'Yashwant'], 'female': ['Yamini', 'Yashika']},
    'Jo': {'male': ['Joshi'], 'female': ['Jyoti', 'Joshna']},
    'Ja': {'male': ['Jay', 'Jai', 'Jayant'], 'female': ['Jaya', 'Janaki']},
    'Go': {'male': ['Govind', 'Gopal'], 'female': ['Gomati']},
    'Su': {'male': ['Suraj', 'Surya', 'Sunil', 'Sumit'], 'female': ['Sunita', 'Suman', 'Suhani', 'Supriya']},
    'Se': {'male': ['Sethupathi'], 'female': ['Seema', 'Seja']},
    'De': {'male': ['Dev', 'Devesh', 'Deepak'], 'female': ['Devi', 'Deepa', 'Devika']},
    'Do': {'male': ['Doshant'], 'female': ['Dolly']},
    'Mo': {'male': ['Mohit', 'Mohan', 'Moksh'], 'female': ['Mohini', 'Monica']},
    'Pe': {'male': ['Peshwa'], 'female': ['Petal']},
    'Po': {'male': ['Poshak'], 'female': ['Poornima']},
    'No': {'male': ['Noman'], 'female': ['Noor']},
    'Ni': {'male': ['Nikhil', 'Nitin', 'Nilesh'], 'female': ['Nisha', 'Nidhi', 'Nikita']},
    'Nu': {'male': ['Nupoor'], 'female': ['Nutan']},
    'Ne': {'male': ['Neeraj', 'Neel'], 'female': ['Neha', 'Neeta', 'Neerja']},
    'Ye': {'male': ['Yeshwant'], 'female': ['Yesha']},
    'Yo': {'male': ['Yogesh', 'Yogi'], 'female': ['Yogita', 'Yoshita']},
}


class BabyNameGenerator:
    def __init__(self, moon_nakshatra: str, moon_pada: int):
        self.nakshatra = moon_nakshatra
        self.pada = moon_pada

    def generate(self, gender: str = 'both') -> Dict:
        sound = PADA_SOUNDS.get((self.nakshatra, self.pada), '')
        if not sound:
            return {'error': f'No sound mapping for {self.nakshatra} pada {self.pada}'}

        names = NAME_DB.get(sound, {'male': [], 'female': []})

        result = {
            'nakshatra': self.nakshatra,
            'pada': self.pada,
            'starting_sound': sound,
            'names': {},
        }

        if gender in ('male', 'both'):
            result['names']['male'] = names.get('male', [f'{sound}dev', f'{sound}esh', f'{sound}raj'])
        if gender in ('female', 'both'):
            result['names']['female'] = names.get('female', [f'{sound}devi', f'{sound}ja', f'{sound}ni'])

        # If no names in DB, generate phonetic suggestions
        if not result['names'].get('male') and gender in ('male', 'both'):
            result['names']['male'] = [f'{sound}dev', f'{sound}esh', f'{sound}van', f'{sound}raj', f'{sound}nath']
        if not result['names'].get('female') and gender in ('female', 'both'):
            result['names']['female'] = [f'{sound}devi', f'{sound}ja', f'{sound}ni', f'{sound}ka', f'{sound}ta']

        return result


def generate_baby_names(moon_nakshatra: str, moon_pada: int, gender: str = 'both') -> Dict:
    bg = BabyNameGenerator(moon_nakshatra, moon_pada)
    return bg.generate(gender)
