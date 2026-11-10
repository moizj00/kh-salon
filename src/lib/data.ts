export type Salon = {
  id: string;
  name: string;
  area: string;
  address: string;
  phone: string;
  contact_person: string;
  stage: "prospect" | "trial" | "regular" | "vip";
  outstanding_balance: number;
  credit_limit: number;
  last_visited_at: string | null;
  notes_count: number;
  open_cards_count: number;
};

export type RouteStop = {
  id: string;
  salon_id: string;
  salon_name: string;
  area: string;
  stop_number: number;
  due_reason: "weekly_cycle" | "low_stock" | "payment_due" | "order_delivery";
  status: "pending" | "visited" | "skipped";
  balance: number;
};

export type SKU = {
  id: string;
  sku_code: string;
  name: string;
  category: "Treatment" | "Styling" | "Color" | "Shampoo";
  price: number;
  bag_qty: number;
  unit: string;
};

export type DeliveryOrder = {
  id: string;
  order_number: string;
  salon_id: string;
  salon_name: string;
  items: Array<{ sku_name: string; qty: number; price: number }>;
  total_amount: number;
  status: "pending_delivery" | "delivered";
  delivered_at: string | null;
};

export const INITIAL_SALONS: Salon[] = [
  {
    id: "sal-clifton-01",
    name: "Toni&Guy Clifton Branch",
    area: "Clifton Block 4, Karachi",
    address: "Plot 12-C, 7th Zamzama Commercial Lane",
    phone: "0300-8234190",
    contact_person: "Rashid Ali (Master Stylist)",
    stage: "vip",
    outstanding_balance: 45000,
    credit_limit: 150000,
    last_visited_at: "2026-11-08T09:30:00Z",
    notes_count: 4,
    open_cards_count: 1,
  },
  {
    id: "sal-dha-02",
    name: "Peng's Hair Studio DHA",
    area: "DHA Phase 5, Karachi",
    address: "14-C Khayaban-e-Seher, Badar Commercial",
    phone: "0321-9876543",
    contact_person: "Peng Sun / Madam Farida",
    stage: "regular",
    outstanding_balance: 28500,
    credit_limit: 80000,
    last_visited_at: "2026-11-07T11:15:00Z",
    notes_count: 2,
    open_cards_count: 0,
  },
  {
    id: "sal-saddar-03",
    name: "Karachi Looks Beauty Lounge",
    area: "Saddar, Karachi",
    address: "Shop 14, Rainbow Centre, Preedy Street",
    phone: "0333-2145698",
    contact_person: "Babar Hussain",
    stage: "regular",
    outstanding_balance: 14000,
    credit_limit: 50000,
    last_visited_at: "2026-11-05T14:40:00Z",
    notes_count: 1,
    open_cards_count: 1,
  },
  {
    id: "sal-gulshan-04",
    name: "Saba's Herbal & Hair Care",
    area: "Gulshan-e-Iqbal Block 6",
    address: "B-21, Main University Road near Disco Bakery",
    phone: "0312-4455667",
    contact_person: "Saba Tariq",
    stage: "trial",
    outstanding_balance: 0,
    credit_limit: 30000,
    last_visited_at: "2026-11-09T10:00:00Z",
    notes_count: 3,
    open_cards_count: 0,
  },
  {
    id: "sal-tariq-05",
    name: "Glamour Zone Tariq Road",
    area: "PECHS Block 2, Tariq Road",
    address: "Mezzanine Floor, Dolmen Centre",
    phone: "0301-7788990",
    contact_person: "Zeeshan Khan",
    stage: "prospect",
    outstanding_balance: 0,
    credit_limit: 20000,
    last_visited_at: null,
    notes_count: 0,
    open_cards_count: 0,
  },
];

export const INITIAL_SKUS: SKU[] = [
  {
    id: "sku-krt-500",
    sku_code: "KRN-KRT-500",
    name: "Kiran Brazilian Keratin Complex 500ml",
    category: "Treatment",
    price: 6800,
    bag_qty: 8,
    unit: "Bottle",
  },
  {
    id: "sku-arg-100",
    sku_code: "KRN-ARG-100",
    name: "Moroccan Argan Elixir Serum 100ml",
    category: "Styling",
    price: 2450,
    bag_qty: 12,
    unit: "Dropper",
  },
  {
    id: "sku-shm-1000",
    sku_code: "KRN-SHM-1L",
    name: "Post-Chemical Clarifying Shampoo 1L",
    category: "Shampoo",
    price: 3200,
    bag_qty: 6,
    unit: "Dispenser",
  },
  {
    id: "sku-clr-06",
    sku_code: "KRN-CLR-06",
    name: "Salon Professional Hair Color Tube 60ml (Ash Brown 6.1)",
    category: "Color",
    price: 850,
    bag_qty: 24,
    unit: "Tube",
  },
  {
    id: "sku-msk-500",
    sku_code: "KRN-MSK-500",
    name: "Collagen & Biotin Intense Hair Mask 500g",
    category: "Treatment",
    price: 3800,
    bag_qty: 5,
    unit: "Jar",
  },
];

export const INITIAL_ROUTE: RouteStop[] = [
  {
    id: "stop-01",
    salon_id: "sal-clifton-01",
    salon_name: "Toni&Guy Clifton Branch",
    area: "Clifton Block 4",
    stop_number: 1,
    due_reason: "order_delivery",
    status: "pending",
    balance: 45000,
  },
  {
    id: "stop-02",
    salon_id: "sal-dha-02",
    salon_name: "Peng's Hair Studio DHA",
    area: "DHA Phase 5",
    stop_number: 2,
    due_reason: "payment_due",
    status: "pending",
    balance: 28500,
  },
  {
    id: "stop-03",
    salon_id: "sal-tariq-05",
    salon_name: "Glamour Zone Tariq Road",
    area: "Tariq Road PECHS",
    stop_number: 3,
    due_reason: "weekly_cycle",
    status: "pending",
    balance: 0,
  },
];

export const INITIAL_ORDERS: DeliveryOrder[] = [
  {
    id: "ord-8801",
    order_number: "ORD-KRN-2026-8801",
    salon_id: "sal-clifton-01",
    salon_name: "Toni&Guy Clifton Branch",
    items: [
      { sku_name: "Kiran Brazilian Keratin Complex 500ml", qty: 2, price: 6800 },
      { sku_name: "Moroccan Argan Elixir Serum 100ml", qty: 4, price: 2450 },
    ],
    total_amount: 23400,
    status: "pending_delivery",
    delivered_at: null,
  },
  {
    id: "ord-8802",
    order_number: "ORD-KRN-2026-8802",
    salon_id: "sal-dha-02",
    salon_name: "Peng's Hair Studio DHA",
    items: [
      { sku_name: "Post-Chemical Clarifying Shampoo 1L", qty: 3, price: 3200 },
    ],
    total_amount: 9600,
    status: "pending_delivery",
    delivered_at: null,
  },
];
