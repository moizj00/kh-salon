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
  lat?: number;
  lng?: number;
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
  brand?: string;
  product_type?: string;
  volume_size?: string;
  recommended_use?: string;
  image_key?: string;
  product_id?: string;
  product_group_id?: string;
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
  notes?: string | null;
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
    lat: 24.8138,
    lng: 67.0299,
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
    lat: 24.7937,
    lng: 67.0644,
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
    lat: 24.8556,
    lng: 67.0261,
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
    lat: 24.9204,
    lng: 67.0942,
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
    lat: 24.8716,
    lng: 67.0598,
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
    brand: "Kiran Professional",
    product_type: "Keratin Smoothing Treatment",
    volume_size: "500ml",
    recommended_use: "Full keratin straightening service on pre-clarified hair; blow-dry 100% and flat-iron seal at 230°C.",
    image_key: "kiran-keratin",
  },
  {
    id: "sku-arg-100",
    sku_code: "KRN-ARG-100",
    name: "Moroccan Argan Elixir Serum 100ml",
    category: "Styling",
    price: 2450,
    bag_qty: 12,
    unit: "Dropper",
    brand: "Kiran Professional",
    product_type: "Gloss & Heat Shield Elixir",
    volume_size: "100ml",
    recommended_use: "Apply 2–3 drops on damp lengths prior to blow-dry or finish dry ends for frizz-free salon shine.",
    image_key: "mocheqi-serum",
  },
  {
    id: "sku-shm-1000",
    sku_code: "KRN-SHM-1L",
    name: "Post-Chemical Clarifying Shampoo 1L",
    category: "Shampoo",
    price: 3200,
    bag_qty: 6,
    unit: "Dispenser",
    brand: "Kemon",
    product_type: "Color-Safe Clarifying Shampoo",
    volume_size: "1000ml",
    recommended_use: "Backwash cleansing for color-treated and post-keratin clients; gently removes residue without stripping tone.",
    image_key: "kemon-shampoo",
  },
  {
    id: "sku-clr-06",
    sku_code: "KRN-CLR-06",
    name: "Salon Professional Hair Color Tube 60ml (Ash Brown 6.1)",
    category: "Color",
    price: 850,
    bag_qty: 24,
    unit: "Tube",
    brand: "Mocheqi Musk",
    product_type: "Permanent Hair Color Cream",
    volume_size: "60ml",
    recommended_use: "Mix 1:1.5 with 20Vol or 30Vol developer for 100% grey coverage and cool ash-brown reflection.",
    image_key: "musk-color",
  },
  {
    id: "sku-msk-500",
    sku_code: "KRN-MSK-500",
    name: "Collagen & Biotin Intense Hair Mask 500g",
    category: "Treatment",
    price: 3800,
    bag_qty: 5,
    unit: "Jar",
    brand: "Kiran Professional",
    product_type: "Deep Repair Conditioning Mask",
    volume_size: "500g",
    recommended_use: "Backwash reconstruction treatment after bleaching or perming; process 10 min under warm steam.",
    image_key: "mocheqi-mask",
  },
  {
    id: "sku-msk-shampoo-318",
    sku_code: "MSK-SHM-318",
    name: "Mocheqi Musk Nourishing Anti-Grease Shampoo 318ml",
    category: "Shampoo",
    price: 2400,
    bag_qty: 10,
    unit: "Bottle",
    brand: "Mocheqi Musk",
    product_type: "Anti-Grease Balancing Shampoo",
    volume_size: "318ml",
    recommended_use: "Daily salon and retail scalp wash to balance excess sebum while soothing dry, sensitized mid-lengths.",
    image_key: "mocheqi-shampoo",
  },
  {
    id: "sku-msk-mask-500",
    sku_code: "MSK-TRT-500",
    name: "Mocheqi Musk Nutrient Moisturizing Hair Mask 500ml",
    category: "Treatment",
    price: 3600,
    bag_qty: 7,
    unit: "Tub",
    brand: "Mocheqi Musk",
    product_type: "Nutrient Moisturizing Hair Mask",
    volume_size: "500ml",
    recommended_use: "Rich keratin & argan backwash mask for brittle or color-processed hair; leave 12 min before cool rinse.",
    image_key: "mocheqi-mask",
  },
  {
    id: "sku-msk-serum-150",
    sku_code: "MSK-SRM-150",
    name: "Mocheqi Musk Argan Frizz-Free Hair Serum 150ml",
    category: "Styling",
    price: 2650,
    bag_qty: 12,
    unit: "Pump",
    brand: "Mocheqi Musk",
    product_type: "Frizz-Control Argan Serum",
    volume_size: "150ml",
    recommended_use: "Smooth 2 pumps across damp hair before blow-drying or flat-ironing to seal cuticles and tame humidity.",
    image_key: "mocheqi-serum",
  },
  {
    id: "sku-msk-oil-60",
    sku_code: "MSK-OIL-060",
    name: "Mocheqi Musk Macadamia & Keratin Repair Oil 60ml",
    category: "Treatment",
    price: 1950,
    bag_qty: 4,
    unit: "Bottle",
    brand: "Mocheqi Musk",
    product_type: "Concentrated Repair Treatment Oil",
    volume_size: "60ml",
    recommended_use: "Add 3–5 drops into hair color mixtures for cuticle protection or massage onto split ends post-styling.",
    image_key: "mocheqi-serum",
  },
  {
    id: "sku-lmx-clarify-1000",
    sku_code: "LMX-CLF-1L",
    name: "Lumex Clarifying Pre-Keratin Shampoo 1000ml",
    category: "Shampoo",
    price: 4100,
    bag_qty: 6,
    unit: "Dispenser",
    brand: "Lumex",
    product_type: "Pre-Treatment Clarifying Shampoo",
    volume_size: "1000ml",
    recommended_use: "Double-wash prior to keratin or hair botox application to strip styling buildup and gently open hair cuticles.",
    image_key: "lumex-clarifying",
  },
  {
    id: "sku-lmx-botox-500",
    sku_code: "LMX-BTX-500",
    name: "Lumex Botox & Keratin Restructuring Complex 500ml",
    category: "Treatment",
    price: 7200,
    bag_qty: 5,
    unit: "Bottle",
    brand: "Lumex",
    product_type: "Keratin & Hair Botox Complex",
    volume_size: "500ml",
    recommended_use: "Apply evenly on 80% dried clarified hair; process 30 min, blow-dry sleek, and flat-iron seal in thin passes.",
    image_key: "lumex-keratin",
  },
  {
    id: "sku-lmx-toner-300",
    sku_code: "LMX-TON-300",
    name: "Lumex Ice Blonde Toning Shampoo 300ml",
    category: "Color",
    price: 2900,
    bag_qty: 3,
    unit: "Bottle",
    brand: "Lumex",
    product_type: "Violet Anti-Brass Toning Shampoo",
    volume_size: "300ml",
    recommended_use: "Emulsify at the backwash on pre-lightened blonde or balayage hair for 3–5 min to neutralize yellow brass.",
    image_key: "lumex-toning",
  },
  {
    id: "sku-lmx-gloss-120",
    sku_code: "LMX-GLS-120",
    name: "Lumex Silk Gloss Thermal Shield Serum 120ml",
    category: "Styling",
    price: 2300,
    bag_qty: 9,
    unit: "Pump",
    brand: "Lumex",
    product_type: "Thermal Protection Finishing Serum",
    volume_size: "120ml",
    recommended_use: "Apply a pea-sized dose to mid-lengths and ends before thermal styling for 230°C heat protection and gloss.",
    image_key: "mocheqi-serum",
  },
  {
    id: "sku-lnx-bleach-500",
    sku_code: "LNX-BLC-500",
    name: "Lunex Ultra Decolor Lightening Powder 500g",
    category: "Color",
    price: 4200,
    bag_qty: 6,
    unit: "Tub",
    brand: "Lunex",
    product_type: "Dust-Free Lightening Powder",
    volume_size: "500g",
    recommended_use: "Mix 1:2 in a non-metallic bowl with developer (20Vol/30Vol) for foil highlights and clean up-to-7-level lift.",
    image_key: "lunex-bleach",
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
