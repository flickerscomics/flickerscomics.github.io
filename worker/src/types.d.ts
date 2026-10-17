/* The shapes of the records the Worker keeps and passes around. Used only by `npm run typecheck`; nothing here exists at run time.
   If a field is added to an order or a payment, add it here too, and the checker will show every place that has to cope with it. */

export interface Payment {
  provider: "fleeca";
  state: "awaiting" | "paid" | "failed" | "cancelled" | "expired";
  mode: number | null;
  id?: string;
  status?: string;
  checkedAt?: number;
  claim?: string;
  claimAt?: number;
  flag?: string;
  sandbox?: boolean;
  payerName?: string;
  payerRouting?: string;
  paidAt?: string;
}

export interface OrderItem { id: string; title: string; qty: number; price: number }
export interface HistoryEntry { at: string; by: string; change: string }

export interface Order {
  id: string;
  placedAt: string;
  completedAt?: string;
  name: string;
  phone: string;
  method: "collect" | "post";
  collectDate?: string | null;
  address?: string | null;
  notes?: string;
  items: OrderItem[];
  subtotal: number;
  discount?: number;
  deal?: string;
  postage: number;
  total: number;
  paid: boolean;
  test: boolean;
  source?: "staff";
  enteredBy?: string;
  status?: "new" | "ready" | "done" | "cancelled";
  stock?: "held" | "released" | "manual" | "restore-failed";
  discord?: string;
  discordId?: string;
  lowAt?: [string, number, number][];
  payment?: Payment;
  history?: HistoryEntry[];
  overduePinged?: boolean;
}

export interface Product {
  id: string; cat: string; title: string; price: number; stock: number; blurb?: string;
  num?: string; vol?: string; subtitle?: string; variant?: string; collects?: string; pages?: number; grade?: string;
  publisher?: string; tagline?: string; badges?: string[]; staff?: string; image?: string; added?: string;
}

export interface SearchItem { words: string[]; blurb: string }
