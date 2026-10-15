export type Locale = 'IN' | 'ZW' | 'UK' | 'US';

export const NAMES: Record<Locale, { first: string[]; last: string[] }> = {
  IN: {
    first: ['Aarav', 'Ananya', 'Vihaan', 'Diya', 'Arjun', 'Isha', 'Rohan', 'Priya', 'Karan', 'Meera', 'Siddharth', 'Kavya', 'Rahul', 'Neha', 'Aditya', 'Sneha', 'Vikram', 'Pooja', 'Rajesh', 'Lakshmi', 'Imran', 'Fatima', 'Harpreet', 'Gurpreet'],
    last: ['Mehta', 'Sharma', 'Iyer', 'Reddy', 'Nair', 'Patel', 'Gupta', 'Banerjee', 'Kulkarni', 'Singh', 'Chopra', 'Desai', 'Menon', 'Joshi', 'Khan', 'Verma', 'Bose', 'Pillai', 'Rao', 'Shetty'],
  },
  ZW: {
    first: ['Tendai', 'Rudo', 'Tafara', 'Chipo', 'Farai', 'Nyasha', 'Tinashe', 'Thandiwe', 'Kudzai', 'Tapiwa', 'Nokuthula', 'Blessing', 'Simbarashe', 'Ruvimbo', 'Munyaradzi', 'Chenai', 'Nkosana', 'Vimbai'],
    last: ['Moyo', 'Ncube', 'Dube', 'Sibanda', 'Chikwanha', 'Mutasa', 'Mpofu', 'Chigumba', 'Makoni', 'Ndlovu', 'Mhlanga', 'Zhou', 'Mudzuri', 'Gumbo', 'Tshuma'],
  },
  UK: {
    first: ['Oliver', 'Amelia', 'George', 'Isla', 'Harry', 'Ava', 'Jack', 'Mia', 'Noah', 'Poppy', 'Charlie', 'Freya', 'Thomas', 'Zoë', 'Callum', 'Eilidh', 'Rhys', 'Seren', 'Søren', 'Niamh'],
    last: ['Smith', 'Jones', 'Taylor', 'Brown', 'Williams', 'Wilson', 'Evans', 'Thomas', 'Roberts', 'Walker', 'Wright', 'Robinson', 'Thompson', 'Hughes', 'Edwards', 'Green', 'MacDonald', "O'Brien", 'Müller', 'Łukasik'],
  },
  US: {
    first: ['Liam', 'Emma', 'Mason', 'Olivia', 'Ethan', 'Sophia', 'Logan', 'Harper', 'Lucas', 'Evelyn', 'Jackson', 'Abigail', 'Aiden', 'Ella', 'José', 'Camila', 'Dmitri', 'Hana', 'Tyrone', 'Keisha'],
    last: ['Johnson', 'Miller', 'Davis', 'Garcia', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Anderson', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Nguyen', 'Kowalski'],
  },
};

export const LOCALE_WEIGHTS: readonly (readonly [Locale, number])[] = [['IN', 40], ['UK', 25], ['US', 20], ['ZW', 15]];

export const CITIES: Record<Locale, string[]> = {
  IN: ['Mumbai', 'Bengaluru', 'Chennai', 'Pune', 'Hyderabad', 'Kolkata', 'Ahmedabad', 'Jaipur'],
  ZW: ['Harare', 'Bulawayo', 'Mutare', 'Gweru', 'Masvingo'],
  UK: ['London', 'Manchester', 'Leeds', 'Glasgow', 'Bristol', 'Cardiff', 'Belfast'],
  US: ['Austin', 'Columbus', 'Denver', 'Boston', 'Seattle', 'Atlanta', 'Phoenix'],
};

export const STREETS = ['Station Road', 'Church Lane', 'Park Avenue', 'Main Street', 'Victoria Road', 'Gandhi Marg', 'Samora Machel Avenue', 'Elm Street', 'High Street', 'MG Road', 'Jason Moyo Street', 'Maple Drive'];

export const EMAIL_DOMAINS: Record<Locale, string[]> = {
  IN: ['mailbox.in', 'inbox.co.in', 'example.in'],
  ZW: ['webmail.co.zw', 'example.co.zw'],
  UK: ['example.co.uk', 'mailhub.uk'],
  US: ['example.com', 'inbox.us'],
};

export const MERCHANTS: readonly (readonly [string, string])[] = [
  ['Fresh Basket Grocers', '5411'], ['Metro Fuel Stop', '5541'], ['Skyline Airways', '4511'], ['Corner Cafe', '5814'],
  ['BrightMart Online', '5964'], ['City Pharmacy', '5912'], ['Northwind Electronics', '5732'], ['Urban Ride Share', '4121'],
  ['Harbour Hotels', '7011'], ['StreamBox Subscriptions', '4899'], ['Daily Bread Bakery', '5462'], ['Apex Fitness Club', '7997'],
  ['Greenfield Utilities', '4900'], ['Quickfix Hardware', '5200'], ['Lumen Books', '5942'], ['Savannah Safari Tours', '4722'],
  ['Kaveri Sweets', '5441'], ['Tower Insurance', '6300'], ['Oakwood Dental', '8021'], ['Sunrise Supermarket', '5411'],
];

export const BRANCH_NAMES = ['Meridian Central', 'Meridian Harbour', 'Meridian Riverside', 'Meridian Northgate', 'Meridian Lakeside', 'Meridian Old Town', 'Meridian Airport', 'Meridian University'];
export const CAMPAIGNS = ['Summer Savings Drive', 'Home Loan Festival', 'Student Starter Pack', 'Festive Cashback', 'Salary Plus Upgrade', 'Green Mortgage Offer', 'Business Boost', 'Senior Care Saver'];
export const LEDGER_ACCOUNTS = ['Cash and Reserves', 'Customer Deposits', 'Loan Receivables', 'Interest Income', 'Fee Income', 'Card Settlement Clearing', 'Operating Expenses', 'Suspense Account'];
export const TICKET_SUBJECTS = ['Card declined at merchant', 'Statement not received', 'Update mobile number', 'Dispute a transaction', 'Reset online banking access', 'Loan EMI date change', 'Unrecognised debit', 'Close savings account', 'Increase card limit', 'Nominee update request'];
export const MESSAGE_BODIES = [
  'Thanks for contacting Meridian Savings Bank. We are looking into this for you.',
  'Please confirm the last four digits of the card you are asking about.',
  'The dispute has been logged and a provisional credit will follow within five working days.',
  'Customer called back; verified through security questions and updated the record.',
  'We have escalated this to the cards operations team for review.',
  'Customer asked to be contacted on the alternate channel after 6 pm.',
  'Issue resolved. Customer confirmed the new statement was received.',
  'Waiting for the customer to upload a signed form before we can proceed.',
];
export const AGENT_TEAMS = ['Cards', 'Lending', 'Deposits', 'Disputes', 'Digital Banking'];
export const CURRENCIES = ['INR', 'USD', 'GBP', 'ZWG', 'EUR'];
