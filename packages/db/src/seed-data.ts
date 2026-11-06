/**
 * Sample data copied from the prototype's Admin board (docs/prototype/project/Admin.dc.html).
 * For local, staging and demos only; never loaded in production.
 */

/** Money and limit defaults (DECISIONS.md, 2026-11-06). Every one is a setting. */
export const DEFAULT_SETTINGS: Record<string, unknown> = {
  'plan.starter.monthly_fee_birr': 1600,
  'plan.starter.branches_included': 1,
  'plan.full.monthly_fee_birr': 2100,
  'plan.full.branches_included': 2,
  'plan.extra_branch.monthly_fee_birr': 420,
  'plan.trial_days': 15,
  'agent.commission_percent.starter': 16,
  'agent.commission_percent.full': 20,
  'agent.commission_percent.extra_branch': 20,
  'government.share_percent_of_commission': 30,
  'auth.max_failed_attempts': 5,
  'auth.lock_minutes': 15,
  'auth.admin_idle_signout_minutes': 30,
  'pin.default_expiry_days': 90,
  'qr.rotate_seconds': 60,
  'safety.kill_switch': { on: false, owner_message: '' },
};

// [prototype ref, name, phone, area, status]
export const AGENTS: Array<[string, string, string, string, 'active' | 'inactive']> = [
  ['a1', 'Mekdes Tadesse', '+251915550142', 'Bole', 'active'],
  ['a2', 'Yonatan Bekele', '+251925550177', 'Piassa and Arada', 'active'],
  ['a3', 'Hiwot Girma', '+251935550119', 'Kazanchis', 'active'],
  ['a4', 'Samuel Demissie', '+251945550163', 'Adama', 'active'],
  ['a5', 'Rahel Assefa', '+251955550138', 'Hawassa', 'active'],
  ['a6', 'Dagim Fikre', '+251965550104', 'Bahir Dar', 'inactive'],
];

export interface SampleBusiness {
  ref: string;
  name: string;
  category: string;
  city: string;
  status: 'pending' | 'trial' | 'active' | 'paused' | 'closed';
  /** Prototype names: Standard, Multi-branch, Pilot. */
  plan: 'Standard' | 'Multi-branch' | 'Pilot';
  agent: string;
  joined: string;
  branches: number;
  owner: string;
  phone: string;
}

const CAT: Record<string, string> = {
  'Café': 'cafe', Salon: 'salon', Spa: 'spa', 'Car wash': 'car_wash', Restaurant: 'restaurant', Barber: 'barber', Bakery: 'bakery',
};

type Row = [string, string, string, string, SampleBusiness['status'], SampleBusiness['plan'], string, string, number, string, string];

const ROWS: Row[] = [
  ['b01', 'Moka House', 'Café', 'Addis Ababa · Piassa', 'active', 'Multi-branch', 'a2', '2026-09-14', 2, 'Tigist Alemu', '+251 91 200 5566'],
  ['b02', 'Sheba Salon', 'Salon', 'Addis Ababa · Bole', 'active', 'Standard', 'a1', '2026-09-20', 1, 'Selamawit Kebede', '+251 92 110 4421'],
  ['b03', 'Lalibela Spa', 'Spa', 'Addis Ababa · Kazanchis', 'trial', 'Standard', 'a3', '2026-10-12', 1, 'Hanna Mulugeta', '+251 93 220 8812'],
  ['b04', 'Abay Car Wash', 'Car wash', 'Bahir Dar', 'active', 'Standard', 'a6', '2026-09-28', 1, 'Getachew Alem', '+251 96 440 2290'],
  ['b05', 'Entoto Grill', 'Restaurant', 'Addis Ababa · Megenagna', 'active', 'Standard', 'a1', '2026-09-05', 1, 'Dawit Gebre', '+251 91 330 7710'],
  ['b06', 'Merkato Barber', 'Barber', 'Addis Ababa · Merkato', 'active', 'Pilot', 'a2', '2026-10-01', 1, 'Abebe Lemma', '+251 92 660 1384'],
  ['b07', 'Bole Bites', 'Café', 'Addis Ababa · Bole', 'active', 'Multi-branch', 'a1', '2026-08-30', 2, 'Rediet Haile', '+251 93 770 5518'],
  ['b08', 'Kazanchis Nails', 'Salon', 'Addis Ababa · Kazanchis', 'paused', 'Standard', 'a3', '2026-09-10', 1, 'Marta Desta', '+251 94 880 3307'],
  ['b09', 'Selam Café', 'Café', 'Adama', 'active', 'Standard', 'a4', '2026-09-22', 1, 'Bereket Negash', '+251 91 990 6642'],
  ['b10', 'Lakeside Bakery', 'Bakery', 'Hawassa', 'trial', 'Standard', 'a5', '2026-10-18', 1, 'Frehiwot Worku', '+251 95 120 8875'],
  ['b11', 'Zewditu Beauty', 'Salon', 'Addis Ababa · Bole', 'pending', 'Standard', 'a3', '2026-10-29', 1, 'Zewditu Tilahun', '+251 91 310 4408'],
  ['b12', 'Tana Coffee Corner', 'Café', 'Bahir Dar', 'pending', 'Standard', '', '2026-10-30', 1, 'Mulugeta Ayele', '+251 96 210 7733'],
  ['b13', 'Dire Pizza', 'Restaurant', 'Dire Dawa', 'pending', 'Standard', '', '2026-10-30', 1, 'Yared Tesfaye', '+251 91 450 9021'],
  ['b14', 'Gebeta Barbers', 'Barber', 'Addis Ababa · Arada', 'active', 'Standard', 'a2', '2026-09-26', 1, 'Nahom Berhanu', '+251 92 330 1175'],
  ['b15', 'Piassa Pastry', 'Bakery', 'Addis Ababa · Piassa', 'active', 'Standard', 'a2', '2026-08-12', 1, 'Almaz Tsegaye', '+251 93 440 2260'],
  ['b16', 'Wash and Go', 'Car wash', 'Addis Ababa · CMC', 'active', 'Standard', 'a1', '2026-09-18', 1, 'Henok Asfaw', '+251 94 550 7719'],
  ['b17', 'Sunrise Spa', 'Spa', 'Addis Ababa · Bole', 'active', 'Standard', 'a1', '2026-10-05', 1, 'Liya Mengistu', '+251 95 660 3304'],
  ['b18', 'Adama Roast', 'Café', 'Adama', 'trial', 'Standard', 'a4', '2026-10-20', 1, 'Kaleab Wondimu', '+251 91 770 2586'],
  ['b19', 'Piazza Cuts', 'Barber', 'Addis Ababa · Piassa', 'active', 'Pilot', 'a2', '2026-10-03', 1, 'Surafel Teshome', '+251 92 880 4491'],
  ['b20', 'Habesha Kitchen', 'Restaurant', 'Addis Ababa · Bole', 'active', 'Multi-branch', 'a1', '2026-09-02', 3, 'Meseret Alemayehu', '+251 93 990 1203'],
  ['b21', 'Hawassa Glow', 'Salon', 'Hawassa', 'active', 'Standard', 'a5', '2026-09-27', 1, 'Tsion Gebremedhin', '+251 94 110 6678'],
  ['b22', 'Old Town Wash', 'Car wash', 'Addis Ababa · Arada', 'closed', 'Standard', 'a2', '2026-08-25', 1, 'Yohannes Abera', '+251 95 220 3340'],
];

export const BUSINESSES: SampleBusiness[] = ROWS.map((r) => ({
  ref: r[0],
  name: r[1],
  category: CAT[r[2]] ?? 'other',
  city: r[3],
  status: r[4],
  plan: r[5],
  agent: r[6],
  joined: r[7],
  branches: r[8],
  owner: r[9],
  phone: r[10].replace(/\s+/g, ''),
}));

/** Prototype plan names to the build plan's (see DECISIONS.md, open item). */
export function planCode(plan: SampleBusiness['plan']): 'starter' | 'full' | 'pilot' {
  return plan === 'Multi-branch' ? 'full' : plan === 'Pilot' ? 'pilot' : 'starter';
}

/** Short code a customer can type instead of scanning: "MOKA01". */
export function shopCode(b: SampleBusiness): string {
  const letters = b.name.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4).padEnd(4, 'X');
  return letters + b.ref.slice(1);
}

/** Sample card rules for seeded shops; real shops set their own in the owner app. */
export const SAMPLE_LADDER = [
  { tier: 1, at: 5, reward: 'Small reward' },
  { tier: 2, at: 10, reward: 'Big reward' },
];
