export type BusinessSegment =
  | 'assistencia'
  | 'varejo'
  | 'servicos';

export type PersonType =
  | 'PF'
  | 'PJ';

export type CustomerType =
  | 'varejo'
  | 'atacado';

export type CustomerGroup =
  | 'Varejo'
  | 'Atacado'
  | 'Premium';

export type DeliveryType =
  | 'balcao'
  | 'entrega'
  | 'retirada';

export type DeliveryStatus =
  | 'pendente'
  | 'em_rota'
  | 'entregue'
  | 'falhou';

export interface Product {
  id: number;
  name: string;
  subtitle: string;
  sku: string;
  brand: string;
  category: string;
  price: number;
  stock: number;
  image: string;
  badge?: string;
}

export interface CartItem extends Product {
  quantity: number;
}

export interface Category {
  label: string;
  icon: string;
  tone: string;
}

export type SalespersonRole =
  | 'administrador'
  | 'gerente'
  | 'caixa'
  | 'vendedor'
  | 'tecnico'
  | 'atendente'
  | 'logistica';

export type RmaStatus =
  | 'aguardando_troca'
  | 'retornou_fornecedor'
  | 'reintegrado_estoque'
  | 'credito_gerado';

export type ServiceOrderStatus =
  | 'aberta'
  | 'em_andamento'
  | 'aguardando_cliente'
  | 'finalizada'
  | 'em_analise'
  | 'aguardando_aprovacao'
  | 'aprovada'
  | 'em_reparo'
  | 'aguardando_peca'
  | 'pronta'
  | 'entregue'
  | 'cancelada';

export type ServiceOrderApprovalStatus =
  | 'aguardando_aprovacao'
  | 'aprovado'
  | 'reprovado';

export type PhotoType =
  | 'entry'
  | 'exit'
  | 'legacy';

export interface PartnerBranch {
  id: string;
  user_id: string;
  name: string;
  address: string | null;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

export interface PartnerCustomer {
  status?: string | null;
  id: string;
  user_id: string;
  name: string;
  trade_name?: string | null;
  document?: string | null;
  person_type?: PersonType | null;
  rg?: string | null;
  municipal_registration?: string | null;
  state_registration?: string | null;
  ie_isento?: boolean;
  suframa_id?: string | null;
  sex?: string | null;
  phone?: string | null;
  phone_commercial_1?: string | null;
  phone_commercial_2?: string | null;
  email?: string | null;
  birthday?: string | null;
  address?: string | null;
  address_number?: string | null;
  zip_code?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  complement?: string | null;
  reference_point?: string | null;
  country?: string | null;
  device_model?: string | null;
  salesperson_id?: string | null;
  customer_group?: CustomerGroup | null;
  price_table?: string | null;
  notes?: string | null;
  customer_type?: CustomerType;
  credit_limit?: number | null;
  allow_credit?: boolean;
  convenio?: boolean;
  simples_nacional?: boolean;
  reter_iss?: boolean;
  is_active?: boolean;
  is_store_admin?: boolean;
  photo_url?: string | null;
  branch_id?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface PartnerSupplier {
  branch_id?: string | null;
  status?: string | null;
  zip_code?: string | null;
  state?: string | null;
  id: string;
  user_id: string;
  name: string;
  document?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  notes?: string | null;
  payable_balance: number;
  created_at: string;
  updated_at?: string;
}

export interface PartnerCategory {
  branch_id?: string | null;
  id: string;
  user_id: string;
  name: string;
  created_at: string;
}

export interface PartnerProduct {
  premium_price?: number | null;
  supplier_id?: string | null;
  brand?: string | null;
  active?: boolean;
  price?: number;
  image?: string | null;
  description?: string | null;
  id: string;
  user_id: string;
  name: string;
  sku: string | null;
  barcode?: string | null;
  cost_price: number;
  sale_price: number;
  wholesale_price: number;
  stock: number;
  min_stock: number;
  image_url: string | null;
  category: string | null;
  is_service: boolean;
  branch_id: string | null;
  ncm?: string | null;
  cfop?: string | null;
  cst_csosn?: string | null;
  icms_rate?: number;
  pis_rate?: number;
  cofins_rate?: number;
  created_at: string;
  updated_at: string;
}

export interface PartnerSalesperson {
  /** Explicit sale-price authorization; never changes the product catalog. */
  can_edit_sale_price?: boolean;
  can_access_all_branches?: boolean;
  blocked_modules?: string[];
  id: string;
  user_id: string;
  auth_user_id?: string | null;
  name: string;
  role: SalespersonRole;
  commission_rate: number;
  phone: string | null;
  email: string | null;
  is_active: boolean;
  active?: boolean;

  /**
   * Campo transitório de formulário: novo PIN digitado pelo administrador
   * ao criar/editar o colaborador. É enviado somente como `p_new_pin` para
   * a RPC `execute_partner_salesperson_mutation`, que gera o `pin_hash` no
   * backend. NUNCA é lido de `partner_salespeople` nem persistido no estado.
   */
  new_pin?: string | null;

  /**
   * Indica apenas se existe PIN configurado (derivado de estado seguro).
   * Nunca carrega o PIN em texto puro nem o hash.
   */
  pin_configured?: boolean;
  branch_id?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface PartnerIdentity {
  authUserId: string;
  companyUserId: string;
  role: SalespersonRole;
  salespersonId: string | null;
  branchId: string | null;
}

export interface SaleItem {
  product_id: string;
  name: string;
  quantity: number;
  unit_price: number;
}

export interface SalePayment { method: 'dinheiro' | 'pix' | 'cartao' | 'credito_rma'; amount: number; }

export interface PartnerSale {
  /** Credit source retained in the immutable browser retry; allocations are stored in the RMA ledger. */
  rma_credit_id?: string | null;
  /** Browser-only provenance for clearing the exact confirmed checkout draft. */
  draft_scope?: string;
  draft_backup_id?: string; // Browser-only recovery metadata; never sent to sale RPCs.
  cash_session_id?: string | null;
  sale_number?: number;
  payment_splits?: SalePayment[];
  /** Frete recebido para repasse a terceiros; não compõe total/faturamento. */
  freight_fee?: number;
  /** Data de conclusão no modo local; no banco é obtida pela baixa vinculada. */
  completed_at?: string;
  id: string;
  user_id: string;
  customer_id: string | null;
  customer_name: string;
  items: SaleItem[];
  total: number;
  imei: string | null;
  serial_number: string | null;
  payment_method: string | null;
  salesperson_id: string | null;
  branch_id: string | null;
  customer_type: CustomerType;
  delivery_type: DeliveryType;
  cost_snapshot?: Record<string, number> | null;
  delivery_address?: string | null;
  delivery_contact?: string | null;
  delivery_details?: DeliveryDetails;
  delivery_history?: { status: DeliveryStatus; at: string; actor_id: string; details?: DeliveryDetails }[];
  delivery_status?: DeliveryStatus;
  delivery_driver_id?: string | null;
  delivery_revision?: number;
  status:
    | 'aberta'
    | 'concluida'
    | 'pre_venda'
    | 'cancelada'
    | 'devolucao';
  origin:
    | 'pdv'
    | 'b2b'
    | 'manual'
    | 'catalogo';
  online_payment: boolean;
  payment_status:
    | 'pago'
    | 'pendente'
    | 'cancelado';
  created_at: string;
  updated_at?: string;
}

export type DeliveryPatch = Partial<{ status: DeliveryStatus; driver_id: string | null; address: string; contact: string; scheduled_date: string; failure_reason: string; received_by: string; notes: string }>;
export type DeliveryOperation = { requestId: string; branchId: string; expectedRevision: number; patch: DeliveryPatch };

export interface StockMovement {
  id: string;
  user_id: string;
  product_id: string;
  product_name: string;
  branch_id?: string | null;
  type:
    | 'entrada'
    | 'saida';
  quantity: number;
  reason: string;
  created_at: string;
}

export interface ReceiptPreferences {
  paper_width: '58' | '80';
  font_size: 10 | 12 | 14 | 16;
  header_text: string;
  show_phone: boolean;
  show_address: boolean;
  show_document: boolean;
  show_salesperson: boolean;
}

export interface PanelPreferences {
  text_size: 'normal' | 'large' | 'extra-large';
  density: 'comfortable' | 'compact';
  corners: 'standard' | 'rounded' | 'square';
}

export interface CatalogPreferences {
  welcome_message: string;
  card_size: 'normal' | 'compact';
  banner_height: 160 | 220 | 300;
  show_stock: boolean;
  show_sku: boolean;
  whatsapp_phone: string;
  show_whatsapp: boolean;
}

export interface StorePersonalization {
  receipt?: Partial<ReceiptPreferences>;
  panel?: Partial<PanelPreferences>;
  catalog?: Partial<CatalogPreferences>;
  pdv?: {
    barcode_scanner_enabled?: boolean;
    camera_scanner_enabled?: boolean;
  };
}

export interface StoreSettings {
  personalization?: StorePersonalization;
  id: string;
  user_id: string;
  logo_url: string | null;
  banner_url: string | null;
  primary_color: string;
  nav_color: string;
  internal_notice: string;
  warranty_terms: string;
  service_warranty_terms?: string;
  receipt_footer_text: string;
  show_logo_on_receipt: boolean;
  show_cnpj_on_receipt: boolean;
  catalog_slug?: string | null;
  catalog_enabled?: boolean;
  catalog_oos_behavior?:
    | 'indisponivel'
    | 'ocultar';
  social_facebook?: string | null;
  social_instagram?: string | null;
  social_whatsapp?: string | null;
  business_hours?: string | null;
  updated_at: string;
}

export interface PartnerProfile {
  id: string;
  email: string;
  name: string;
  whatsapp: string | null;
  segment: BusinessSegment;
  account_name?: string | null;
  document?: string | null;
  subscription_plan?: string | null;
  subscription_status?:
    | 'ativa'
    | 'trial'
    | 'cancelada'
    | 'suspensa'
    | null;
  next_billing_date?: string | null;
  payment_method?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface DeliveryDetails { scheduled_date?: string; failure_reason?: string; received_by?: string; notes?: string; delivered_at?: string; }
export interface RmaAttachment { kind: 'before' | 'after' | 'defect'; name: string; path: string; }

export interface RmaRequest {
  refund_amount?: number;
  refund_request_id?: string | null;
  refund_method?: 'dinheiro' | 'pix' | 'cartao' | null;
  refund_reason?: string | null;
  refunded_at?: string | null;
  destination?: 'avaliacao' | 'avaria' | 'fornecedor' | 'estoque';
  attachments?: RmaAttachment[];
  id: string;
  user_id: string;
  branch_id: string | null;
  customer_name: string;
  sale_id?: string | null;
  sale_item_index?: number | null;
  product_id?: string | null;
  customer_id?: string | null;
  quantity?: number;
  stock_restored_at?: string | null;
  credit_amount?: number;
  credit_used_amount?: number | null;
  credited_at?: string | null;
  product_name: string;
  product_sku: string;
  batch_or_order: string;
  defect_description: string;
  media_url: string | null;
  status: RmaStatus;
  created_at: string;
  updated_at: string;
}

export type RmaPayload =
  Omit<
    RmaRequest,
    | 'id'
    | 'user_id'
    | 'created_at'
    | 'updated_at'
    | 'status'
    | 'stock_restored_at'
    | 'credit_amount'
    | 'credit_used_amount'
    | 'credited_at'
    | 'refund_amount'
    | 'refund_request_id'
    | 'refund_method'
    | 'refund_reason'
    | 'refunded_at'
    | 'branch_id'
    | 'customer_name'
  > & {
    request_id?: string;
    files?: { kind: RmaAttachment['kind']; file: File }[];
    branch_id?: string | null;
    customer_name?: string;
  };

export interface PartnerCombo {
  id: string;
  user_id: string;
  name: string;
  items: Array<{
    product_id: string;
    quantity: number;
  }>;
  price: number;
  active: boolean;
  created_at: string;
}

export interface PartnerModifier {
  id: string;
  user_id: string;
  name: string;
  product_id: string;
  price_adjustment: number;
  created_at: string;
}

export interface PartnerInvoice {
  id: string;
  user_id: string;
  number: string;
  sale_id?: string | null;
  customer_id?: string | null;
  customer_name: string;
  amount: number;
  paid_amount?: number;
  return_credit_amount?: number;
  status:
    | 'aberta'
    | 'paga'
    | 'parcial'
    | 'cancelada';
  due_date: string | null;
  paid_at: string | null;
  branch_id: string | null;
  salesperson_id?: string | null;
  created_at: string;
}

export interface B2BOrder {
  id: string;
  user_id: string;
  business_name: string;
  items: unknown[];
  total: number;
  status:
    | 'pendente'
    | 'aprovado'
    | 'cancelado';
  payment_method: string | null;
  branch_id: string | null;
  created_at: string;
}

export interface AdminLojista {
  status:
    | 'pendente'
    | 'aprovado'
    | 'reprovado';
}

export interface AdminCompany extends AdminLojista {
  id: string;
  user_id: string | null;
  business_name: string;
  account_name: string | null;
  email: string | null;
  whatsapp: string | null;
  document: string | null;
  segment: BusinessSegment;
  subscription_plan: string | null;
  subscription_status: string | null;
  orders_count: number;
  orders_total: number;
  client_status: AdminLojista['status'];
  credit_limit: number | null;
}

export interface AdminFinancialMonth {
  month_start: string;
  month_label: string;
  revenue: number;
  open_amount: number;
  paid_count: number;
  active_clients: number;
  average_ticket: number;
}

export interface PermissionOverride {
  id: string;
  user_id: string;
  salesperson_id: string;
  can_cancel_sales: boolean;
  discount_override_limit: number;
  can_view_cost_prices: boolean;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string;
  actor_name: string;
  actor_role: SalespersonRole | 'sistema';
  action: string;
  entity_type: string;
  entity_id: string;
  details: string;
  created_at: string;
}

export interface ServiceOrder {
  inspection_version?: number;
  entry_checklist?: Record<string, string> | null;
  entry_recorded_at?: string | null;
  entry_recorded_by?: string | null;
  customer_acknowledged_at?: string | null;
  customer_acknowledged_by?: string | null;
  exit_checklist?: Record<string, string> | null;
  exit_recorded_at?: string | null;
  exit_recorded_by?: string | null;
  warranty_snapshot?: string | null;
  warranty_snapshot_at?: string | null;
  status_history?: { status: string; approval?: string; actor: string; at: string; reason?: string }[];
  id: string;
  user_id: string;
  branch_id: string;

  customer_id: string | null;
  customer_name: string | null;
  customer_email?: string | null;
  customer_address?: string | null;
  customer_phone?: string | null;

  service_segment: string;

  os_number: string | null;
  equipment_type: string | null;
  equipment_brand: string | null;
  equipment_model: string | null;
  equipment_identification: string | null;
  serial_number: string | null;
  imei: string | null;
  reported_issue: string | null;
  observations: string | null;
  technician_name: string | null;
  entry_date: string | null;
  forecast_delivery: string | null;

  accessories_left: string | null;
  physical_condition: string | null;
  entry_damage: string | null;
  entry_notes: string | null;
  screen_condition: string | null;
  shell_condition: string | null;
  side_condition: string | null;
  rear_condition: string | null;
  connectors_condition: string | null;
  buttons_condition: string | null;
  other_damage: string | null;
  inspection_notes: string | null;

  status: ServiceOrderStatus;
  approval_status: ServiceOrderApprovalStatus;
  approval_notes: string | null;

  labor_total: number;
  parts_total: number;
  discount_total: number;
  total: number;

  created_at: string;
  updated_at: string;
}

export interface ServiceOrderItem {
  id: string;
  service_order_id: string;
  user_id: string;
  product_id: string | null;
  branch_id: string;
  product_name: string;
  quantity: number;
  unit_cost: number;
  unit_price: number;
  created_at: string;
}

export interface ServiceOrderPhoto {
  id: string;
  service_order_id: string;
  user_id: string;
  branch_id: string | null;
  photo_type: PhotoType | null;
  operation_type:
    | 'service_order'
    | 'rma'
    | null;
  label: string;
  storage_path: string;
  created_at: string;
}
