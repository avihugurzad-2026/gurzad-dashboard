export type Rec = { id: string; created_at?: string; [k: string]: any };

export type FieldType = 'text' | 'textarea' | 'money' | 'number' | 'date' | 'time' | 'month' | 'member' | 'select' | 'bool' | 'email' | 'tel' | 'url';

export type FieldDef = {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  required?: boolean;
  placeholder?: string;
  half?: boolean;
  hint?: string;
  default?: any | (() => any);
};

export type Role = 'owner' | 'editor' | 'viewer';
export type Area = 'home' | 'business' | 'invest';
export type Permission = Area | 'chat' | 'meta_campaigns' | 'status';

export type Member = {
  id: string;
  email: string;
  name: string;
  role: Role;
  areas: Permission[];
  status: 'active' | 'invited';
  invited_at?: string;
};

export type Collection =
  | 'home_tasks' | 'shopping' | 'transactions' | 'budgets' | 'bills' | 'maintenance' | 'documents'
  | 'businesses' | 'invoices' | 'clients' | 'biz_expenses' | 'biz_tasks' | 'integrations'
  | 'properties' | 'tenants' | 'leases' | 'rent_payments' | 'prop_tasks' | 'photos' | 'alert_rules'
  | 'monitors' | 'wa_messages' | 'members' | 'parameters' | 'events' | 'settings';
