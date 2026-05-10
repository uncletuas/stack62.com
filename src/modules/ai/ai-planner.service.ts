import { Injectable } from '@nestjs/common';
import { slugify } from '../../shared/utils/slugify';
import { AiChangePlan, aiChangePlanSchema } from './schemas/change-plan.schema';

interface PlannedModuleTemplate {
  name: string;
  key: string;
  description: string;
  entities: Array<{
    name: string;
    key: string;
    description: string;
    fields: Array<{
      name: string;
      key: string;
      dataType: string;
      required?: boolean;
    }>;
  }>;
}

const MODULE_LIBRARY: Array<{
  keyword: string;
  industry: string;
  module: PlannedModuleTemplate;
}> = [
  {
    keyword: 'hr',
    industry: 'hr',
    module: {
      name: 'HR Operations',
      key: 'hr-operations',
      description: 'Core people operations and workforce management.',
      entities: [
        {
          name: 'Employees',
          key: 'employees',
          description: 'Employee profiles and employment data.',
          fields: [
            {
              name: 'Employee ID',
              key: 'employee-id',
              dataType: 'text',
              required: true,
            },
            {
              name: 'Full Name',
              key: 'full-name',
              dataType: 'text',
              required: true,
            },
            { name: 'Department', key: 'department', dataType: 'text' },
            {
              name: 'Employment Status',
              key: 'employment-status',
              dataType: 'text',
            },
          ],
        },
        {
          name: 'Leave Requests',
          key: 'leave-requests',
          description: 'Employee leave and approval workflows.',
          fields: [
            {
              name: 'Employee',
              key: 'employee',
              dataType: 'relation',
              required: true,
            },
            {
              name: 'Leave Type',
              key: 'leave-type',
              dataType: 'text',
              required: true,
            },
            {
              name: 'Start Date',
              key: 'start-date',
              dataType: 'date',
              required: true,
            },
            {
              name: 'End Date',
              key: 'end-date',
              dataType: 'date',
              required: true,
            },
            {
              name: 'Approval Status',
              key: 'approval-status',
              dataType: 'text',
            },
          ],
        },
      ],
    },
  },
  {
    keyword: 'finance',
    industry: 'finance',
    module: {
      name: 'Finance Tracker',
      key: 'finance-tracker',
      description: 'Budget, expenses, approvals, and payment tracking.',
      entities: [
        {
          name: 'Expenses',
          key: 'expenses',
          description: 'Expense requests and reimbursement tracking.',
          fields: [
            { name: 'Title', key: 'title', dataType: 'text', required: true },
            {
              name: 'Amount',
              key: 'amount',
              dataType: 'number',
              required: true,
            },
            { name: 'Category', key: 'category', dataType: 'text' },
            {
              name: 'Approval Status',
              key: 'approval-status',
              dataType: 'text',
            },
          ],
        },
        {
          name: 'Vendor Payments',
          key: 'vendor-payments',
          description: 'Vendor invoices and settlement records.',
          fields: [
            {
              name: 'Vendor Name',
              key: 'vendor-name',
              dataType: 'text',
              required: true,
            },
            { name: 'Invoice Number', key: 'invoice-number', dataType: 'text' },
            {
              name: 'Amount',
              key: 'amount',
              dataType: 'number',
              required: true,
            },
            { name: 'Payment Status', key: 'payment-status', dataType: 'text' },
          ],
        },
      ],
    },
  },
  {
    keyword: 'procurement',
    industry: 'procurement',
    module: {
      name: 'Procurement',
      key: 'procurement',
      description: 'Purchase requests, vendor management, and approvals.',
      entities: [
        {
          name: 'Purchase Requests',
          key: 'purchase-requests',
          description: 'Internal purchase requests and approvals.',
          fields: [
            {
              name: 'Requester',
              key: 'requester',
              dataType: 'text',
              required: true,
            },
            { name: 'Item', key: 'item', dataType: 'text', required: true },
            {
              name: 'Quantity',
              key: 'quantity',
              dataType: 'number',
              required: true,
            },
            {
              name: 'Approval Status',
              key: 'approval-status',
              dataType: 'text',
            },
          ],
        },
      ],
    },
  },
  {
    keyword: 'crm',
    industry: 'crm',
    module: {
      name: 'CRM',
      key: 'crm',
      description: 'Customer relationship management and pipeline tracking.',
      entities: [
        {
          name: 'Contacts',
          key: 'contacts',
          description: 'Customer and lead contacts.',
          fields: [
            {
              name: 'Full Name',
              key: 'full-name',
              dataType: 'text',
              required: true,
            },
            { name: 'Email', key: 'email', dataType: 'text' },
            { name: 'Company', key: 'company', dataType: 'text' },
            { name: 'Stage', key: 'stage', dataType: 'text' },
          ],
        },
        {
          name: 'Deals',
          key: 'deals',
          description: 'Sales opportunities and revenue forecast.',
          fields: [
            {
              name: 'Deal Name',
              key: 'deal-name',
              dataType: 'text',
              required: true,
            },
            { name: 'Value', key: 'value', dataType: 'number' },
            { name: 'Stage', key: 'stage', dataType: 'text' },
          ],
        },
      ],
    },
  },
  {
    keyword: 'inventory',
    industry: 'inventory',
    module: {
      name: 'Inventory',
      key: 'inventory',
      description: 'Inventory management and stock visibility.',
      entities: [
        {
          name: 'Items',
          key: 'items',
          description: 'Inventory catalogue and stock levels.',
          fields: [
            { name: 'SKU', key: 'sku', dataType: 'text', required: true },
            {
              name: 'Item Name',
              key: 'item-name',
              dataType: 'text',
              required: true,
            },
            {
              name: 'Quantity On Hand',
              key: 'quantity-on-hand',
              dataType: 'number',
            },
            { name: 'Reorder Level', key: 'reorder-level', dataType: 'number' },
          ],
        },
      ],
    },
  },
  {
    keyword: 'project',
    industry: 'operations',
    module: {
      name: 'Project Operations',
      key: 'project-operations',
      description: 'Project delivery, milestones, and task execution.',
      entities: [
        {
          name: 'Projects',
          key: 'projects',
          description: 'Project portfolio and milestones.',
          fields: [
            {
              name: 'Project Name',
              key: 'project-name',
              dataType: 'text',
              required: true,
            },
            { name: 'Owner', key: 'owner', dataType: 'text' },
            { name: 'Status', key: 'status', dataType: 'text' },
          ],
        },
      ],
    },
  },
];

@Injectable()
export class AiPlannerService {
  classifyIntent(prompt: string, systemId?: string | null) {
    const lowerPrompt = prompt.toLowerCase();
    if (systemId) {
      if (lowerPrompt.includes('add ') || lowerPrompt.includes('include ')) {
        return 'add_module' as const;
      }

      return 'update_system' as const;
    }

    return 'create_system' as const;
  }

  inferRiskLevel(prompt: string) {
    const lowerPrompt = prompt.toLowerCase();
    if (
      lowerPrompt.includes('delete') ||
      lowerPrompt.includes('remove') ||
      lowerPrompt.includes('salary') ||
      lowerPrompt.includes('payment') ||
      lowerPrompt.includes('permission')
    ) {
      return 'high' as const;
    }

    if (
      lowerPrompt.includes('approval') ||
      lowerPrompt.includes('workflow') ||
      lowerPrompt.includes('finance')
    ) {
      return 'medium' as const;
    }

    return 'low' as const;
  }

  buildPlan(
    prompt: string,
    systemId?: string | null,
    options?: {
      generateArtifacts?: boolean;
      context?: Record<string, unknown> | null;
    },
  ): AiChangePlan {
    const intent = this.classifyIntent(prompt, systemId);
    const matchedModules = this.resolveModules(prompt);
    const fallbackName = this.deriveSystemName(prompt);
    const views = this.buildViews(matchedModules);
    const dashboards = this.buildDashboards(matchedModules);
    const workflows = this.buildWorkflows(matchedModules, prompt);
    const permissionPolicies = this.buildPermissionPolicies();
    const riskLevel = this.inferRiskLevel(prompt);
    const artifacts = this.buildArtifacts({
      intent,
      name: fallbackName,
      systemId,
      prompt,
      modules: matchedModules,
      views,
      dashboards,
      workflows,
      permissionPolicies,
      generateArtifacts: options?.generateArtifacts ?? false,
      context: options?.context ?? null,
    });

    if (intent === 'create_system') {
      return aiChangePlanSchema.parse({
        intent,
        name: fallbackName,
        description: prompt,
        industryType: matchedModules[0]?.key ?? 'operations',
        governanceMode: 'standard',
        visibility: 'private',
        summary: `Create a governed system named ${fallbackName} from prompt intent.`,
        riskLevel,
        modules: matchedModules,
        views,
        dashboards,
        workflows,
        permissionPolicies,
        artifacts,
      });
    }

    return aiChangePlanSchema.parse({
      intent,
      systemId,
      summary: `Update the target system from prompt intent using governed configuration changes.`,
      riskLevel,
      modules: matchedModules,
      views,
      dashboards,
      workflows,
      permissionPolicies,
      artifacts,
    });
  }

  validatePlan(plan: AiChangePlan) {
    const parsed = aiChangePlanSchema.safeParse(plan);
    if (!parsed.success) {
      return {
        isValid: false,
        issues: parsed.error.issues.map((issue) => issue.message),
        warnings: [] as string[],
      };
    }

    const warnings: string[] = [];
    const duplicateModuleKeys = this.findDuplicates(
      parsed.data.modules.map((module) => module.key),
    );
    if (duplicateModuleKeys.length > 0) {
      warnings.push(
        `Duplicate module keys detected: ${duplicateModuleKeys.join(', ')}`,
      );
    }

    const duplicateArtifactPaths = this.findDuplicates(
      parsed.data.artifacts.map((artifact) => artifact.relativePath),
    );
    if (duplicateArtifactPaths.length > 0) {
      warnings.push(
        `Duplicate artifact paths detected: ${duplicateArtifactPaths.join(', ')}`,
      );
    }

    return {
      isValid:
        duplicateModuleKeys.length === 0 && duplicateArtifactPaths.length === 0,
      issues:
        duplicateModuleKeys.length > 0 || duplicateArtifactPaths.length > 0
          ? warnings
          : [],
      warnings,
    };
  }

  private resolveModules(prompt: string) {
    const lowerPrompt = prompt.toLowerCase();
    if (this.isRetailSalesPrompt(lowerPrompt)) {
      return this.buildRetailSalesModules();
    }

    const matches = MODULE_LIBRARY.filter(({ keyword }) =>
      lowerPrompt.includes(keyword),
    );

    if (matches.length === 0) {
      return [
        {
          name: 'Operations Core',
          key: 'operations-core',
          description:
            'Generic operations module generated from prompt intent.',
          kind: 'custom',
          config: { generated: true },
          entities: [
            {
              name: 'Requests',
              key: 'requests',
              description: 'Operational requests and tracking items.',
              config: { generated: true },
              fields: [
                {
                  name: 'Title',
                  key: 'title',
                  dataType: 'text',
                  required: true,
                },
                {
                  name: 'Status',
                  key: 'status',
                  dataType: 'text',
                  required: false,
                },
                {
                  name: 'Owner',
                  key: 'owner',
                  dataType: 'text',
                  required: false,
                },
              ],
            },
          ],
        },
      ];
    }

    return matches.map(({ module }) => ({
      name: module.name,
      key: module.key,
      description: module.description,
      kind: 'custom',
      config: { generated: true },
      entities: module.entities.map((entity) => ({
        name: entity.name,
        key: entity.key,
        description: entity.description,
        config: { generated: true },
        fields: entity.fields.map((field) => ({
          name: field.name,
          key: field.key,
          dataType: field.dataType,
          required: field.required ?? false,
          config: null,
        })),
      })),
    }));
  }

  private isRetailSalesPrompt(lowerPrompt: string) {
    return /coffee|cafe|shop|store|sales|pos|retail|inventory|cashier/.test(
      lowerPrompt,
    );
  }

  private buildRetailSalesModules() {
    const field = (
      name: string,
      dataType: string,
      required = false,
      config: Record<string, unknown> | null = null,
    ) => ({
      name,
      key: slugify(name),
      dataType,
      required,
      config,
    });

    return [
      {
        name: 'Sales Command Center',
        key: 'sales-command-center',
        description:
          'Point-of-sale orders, payment capture, cashier performance, and receipt-level tracking.',
        kind: 'custom',
        config: {
          generated: true,
          domain: 'retail_sales',
          primaryWorkflow: 'order_to_close',
        },
        entities: [
          {
            name: 'Orders',
            key: 'orders',
            description:
              'Every customer sale with totals, cashier, channel, and settlement state.',
            config: { generated: true, primary: true },
            fields: [
              field('Order Number', 'text', true),
              field('Sale Time', 'datetime', true),
              field('Cashier', 'relation', true, { target: 'staff' }),
              field('Customer', 'relation', false, { target: 'customers' }),
              field('Channel', 'select', true, {
                options: ['walk-in', 'takeaway', 'delivery'],
              }),
              field('Subtotal', 'currency', true),
              field('Discount', 'currency'),
              field('Tax', 'currency'),
              field('Total', 'currency', true),
              field('Payment Method', 'select', true, {
                options: ['cash', 'card', 'transfer', 'gift-card'],
              }),
              field('Status', 'select', true, {
                options: ['open', 'paid', 'refunded', 'voided'],
              }),
            ],
          },
          {
            name: 'Order Items',
            key: 'order-items',
            description:
              'Line items sold per order with quantity, unit price, cost, and margin.',
            config: { generated: true },
            fields: [
              field('Order', 'relation', true, { target: 'orders' }),
              field('Product', 'relation', true, { target: 'products' }),
              field('Quantity', 'number', true),
              field('Unit Price', 'currency', true),
              field('Unit Cost', 'currency'),
              field('Line Total', 'currency', true),
              field('Gross Margin', 'currency'),
            ],
          },
          {
            name: 'Daily Closeouts',
            key: 'daily-closeouts',
            description:
              'End-of-day reconciliation for expected cash, actual cash, variances, notes, and manager sign-off.',
            config: { generated: true },
            fields: [
              field('Business Date', 'date', true),
              field('Expected Cash', 'currency', true),
              field('Actual Cash', 'currency'),
              field('Card Total', 'currency'),
              field('Transfer Total', 'currency'),
              field('Variance', 'currency'),
              field('Closed By', 'relation', false, { target: 'staff' }),
              field('Close Status', 'select', true, {
                options: ['draft', 'needs-review', 'closed'],
              }),
              field('Manager Notes', 'long_text'),
            ],
          },
        ],
      },
      {
        name: 'Catalog And Inventory',
        key: 'catalog-and-inventory',
        description:
          'Products, categories, stock movements, reorder levels, and availability controls.',
        kind: 'custom',
        config: { generated: true, domain: 'retail_inventory' },
        entities: [
          {
            name: 'Products',
            key: 'products',
            description:
              'Sellable menu items with price, cost, category, stock level, and active state.',
            config: { generated: true },
            fields: [
              field('Product Name', 'text', true),
              field('SKU', 'text'),
              field('Category', 'select', true, {
                options: ['coffee', 'tea', 'pastry', 'meal', 'merchandise'],
              }),
              field('Selling Price', 'currency', true),
              field('Unit Cost', 'currency'),
              field('Current Stock', 'number'),
              field('Reorder Level', 'number'),
              field('Availability', 'select', true, {
                options: ['available', 'low-stock', 'out-of-stock', 'paused'],
              }),
            ],
          },
          {
            name: 'Stock Movements',
            key: 'stock-movements',
            description:
              'Inventory receipts, usage, wastage, and corrections with audit trail.',
            config: { generated: true },
            fields: [
              field('Product', 'relation', true, { target: 'products' }),
              field('Movement Type', 'select', true, {
                options: ['received', 'sold', 'wasted', 'adjusted'],
              }),
              field('Quantity', 'number', true),
              field('Reason', 'text'),
              field('Recorded By', 'relation', false, { target: 'staff' }),
              field('Recorded At', 'datetime', true),
            ],
          },
        ],
      },
      {
        name: 'People And Shifts',
        key: 'people-and-shifts',
        description:
          'Cashiers, shifts, customer profiles, repeat visits, and team accountability.',
        kind: 'custom',
        config: { generated: true, domain: 'retail_people' },
        entities: [
          {
            name: 'Staff',
            key: 'staff',
            description:
              'Team members, roles, assigned shifts, and sales responsibility.',
            config: { generated: true },
            fields: [
              field('Full Name', 'text', true),
              field('Role', 'select', true, {
                options: ['cashier', 'barista', 'shift-lead', 'manager'],
              }),
              field('Active', 'boolean'),
              field('Shift Start', 'time'),
              field('Shift End', 'time'),
              field('Sales Handled', 'currency'),
            ],
          },
          {
            name: 'Customers',
            key: 'customers',
            description:
              'Customer contact, loyalty state, visit count, and lifetime spend.',
            config: { generated: true },
            fields: [
              field('Customer Name', 'text', true),
              field('Phone', 'text'),
              field('Email', 'email'),
              field('Visit Count', 'number'),
              field('Lifetime Spend', 'currency'),
              field('Last Visit', 'date'),
            ],
          },
        ],
      },
    ];
  }

  private buildViews(modules: ReturnType<AiPlannerService['resolveModules']>) {
    const baseViews = modules.flatMap((module) =>
      module.entities.map((entity) => ({
        name: `${entity.name} Table`,
        type: 'table',
        entityKey: entity.key,
        config: {
          moduleKey: module.key,
          generated: true,
          searchable: true,
          filters: entity.fields
            .filter((field) =>
              ['status', 'category', 'payment-method', 'availability'].includes(
                field.key,
              ),
            )
            .map((field) => field.key),
        },
      })),
    );

    if (modules.some((module) => module.key === 'sales-command-center')) {
      return [
        {
          name: 'Today POS Console',
          type: 'workspace',
          entityKey: 'orders',
          config: {
            moduleKey: 'sales-command-center',
            generated: true,
            layout: 'split',
            primaryAction: 'record_sale',
            panels: ['new_order', 'recent_orders', 'cashier_totals'],
          },
        },
        {
          name: 'Low Stock Monitor',
          type: 'kanban',
          entityKey: 'products',
          config: {
            moduleKey: 'catalog-and-inventory',
            generated: true,
            groupBy: 'availability',
            highlightWhen: 'current-stock <= reorder-level',
          },
        },
        ...baseViews,
      ];
    }

    return baseViews;
  }

  private buildDashboards(
    modules: ReturnType<AiPlannerService['resolveModules']>,
  ) {
    if (modules.some((module) => module.key === 'sales-command-center')) {
      return [
        {
          name: 'Coffee Shop Sales Command',
          scope: 'system',
          widgets: [
            {
              type: 'metric_card',
              entityKey: 'orders',
              metric: 'sum_total_today',
              label: "Today's Revenue",
              format: 'currency',
            },
            {
              type: 'metric_card',
              entityKey: 'orders',
              metric: 'count_paid_today',
              label: 'Paid Orders',
            },
            {
              type: 'metric_card',
              entityKey: 'order-items',
              metric: 'top_product_today',
              label: 'Top Seller',
            },
            {
              type: 'metric_card',
              entityKey: 'products',
              metric: 'count_low_stock',
              label: 'Low Stock Items',
            },
            {
              type: 'chart',
              entityKey: 'orders',
              metric: 'revenue_by_hour',
              label: 'Hourly Sales',
              chartType: 'bar',
            },
            {
              type: 'chart',
              entityKey: 'orders',
              metric: 'sales_by_payment_method',
              label: 'Payment Split',
              chartType: 'donut',
            },
            {
              type: 'table',
              entityKey: 'daily-closeouts',
              label: 'Closeout Exceptions',
              filter: { closeStatus: ['draft', 'needs-review'] },
            },
          ],
        },
      ];
    }

    return [
      {
        name: 'Operations Overview',
        scope: 'system',
        widgets: modules.map((module) => ({
          type: 'count_card',
          moduleKey: module.key,
          metric: 'records_count',
          label: `${module.name} records`,
        })),
      },
    ];
  }

  private buildWorkflows(
    modules: ReturnType<AiPlannerService['resolveModules']>,
    prompt: string,
  ) {
    const lowerPrompt = prompt.toLowerCase();
    if (modules.some((module) => module.key === 'sales-command-center')) {
      return [
        {
          name: 'Record Sale And Update Stock',
          key: 'record-sale-and-update-stock',
          triggerType: 'record_created',
          moduleKey: 'sales-command-center',
          definition: {
            generated: true,
            entityKey: 'orders',
            steps: [
              { type: 'calculate', label: 'Calculate totals and margin' },
              { type: 'create', label: 'Create order item records' },
              { type: 'update', label: 'Deduct product inventory' },
              {
                type: 'notify',
                label: 'Flag items that dropped below reorder level',
              },
            ],
          },
        },
        {
          name: 'Daily Close And Revenue Summary',
          key: 'daily-close-and-revenue-summary',
          triggerType: 'scheduled',
          moduleKey: 'sales-command-center',
          definition: {
            generated: true,
            schedule: '0 21 * * *',
            steps: [
              { type: 'aggregate', label: 'Summarize sales by payment method' },
              { type: 'reconcile', label: 'Compare expected and actual cash' },
              { type: 'report', label: 'Generate manager closeout report' },
            ],
          },
        },
      ];
    }

    const plannedWorkflows = modules.flatMap((module) =>
      module.entities
        .filter(
          (entity) =>
            entity.fields.some(
              (field) =>
                field.key.includes('approval') || field.key.includes('status'),
            ) ||
            lowerPrompt.includes('approval') ||
            lowerPrompt.includes('workflow'),
        )
        .map((entity) => ({
          name: `${entity.name} Approval Flow`,
          key: slugify(`${entity.key}-approval-flow`),
          triggerType: 'record_created',
          moduleKey: module.key,
          definition: {
            generated: true,
            entityKey: entity.key,
            actors: ['manager', 'admin'],
            steps: [
              {
                type: 'review',
                label: 'Manager review',
              },
              {
                type: 'approve',
                label: 'Approval decision',
              },
            ],
          },
        })),
    );

    if (plannedWorkflows.length > 0) {
      return plannedWorkflows;
    }

    if (
      !lowerPrompt.includes('workflow') &&
      !lowerPrompt.includes('approval')
    ) {
      return [];
    }

    return [
      {
        name: 'Operational Review Flow',
        key: 'operational-review-flow',
        triggerType: 'manual',
        moduleKey: modules[0]?.key ?? null,
        definition: {
          generated: true,
          steps: [
            { type: 'submit', label: 'Submit request' },
            { type: 'review', label: 'Review request' },
            { type: 'complete', label: 'Mark complete' },
          ],
        },
      },
    ];
  }

  private buildPermissionPolicies() {
    return [
      {
        name: 'System Admin Policy',
        scope: 'system',
        role: 'admin',
        resourceType: 'system',
        actions: [
          'create',
          'read',
          'update',
          'delete',
          'manage_permissions',
          'manage_workflows',
          'manage_dashboards',
        ],
        fieldRestrictions: null,
        conditions: null,
      },
      {
        name: 'Manager Collaboration Policy',
        scope: 'module',
        role: 'manager',
        resourceType: 'module',
        actions: ['read', 'create', 'update', 'approve', 'assign'],
        fieldRestrictions: null,
        conditions: null,
      },
      {
        name: 'Staff Operation Policy',
        scope: 'record',
        role: 'staff',
        resourceType: 'record',
        actions: ['read', 'create', 'update_own'],
        fieldRestrictions: null,
        conditions: null,
      },
    ];
  }

  private buildArtifacts({
    intent,
    name,
    systemId,
    prompt,
    modules,
    views,
    dashboards,
    workflows,
    permissionPolicies,
    generateArtifacts,
    context,
  }: {
    intent: 'create_system' | 'update_system' | 'add_module';
    name: string;
    systemId?: string | null;
    prompt: string;
    modules: ReturnType<AiPlannerService['resolveModules']>;
    views: ReturnType<AiPlannerService['buildViews']>;
    dashboards: ReturnType<AiPlannerService['buildDashboards']>;
    workflows: ReturnType<AiPlannerService['buildWorkflows']>;
    permissionPolicies: ReturnType<AiPlannerService['buildPermissionPolicies']>;
    generateArtifacts: boolean;
    context?: Record<string, unknown> | null;
  }) {
    if (!generateArtifacts) {
      return [];
    }

    const slug = slugify(systemId ? `${systemId}-update` : name);
    const basePath = `${slug}/`;

    return [
      {
        kind: 'system_manifest',
        relativePath: `${basePath}system-definition.json`,
        content: JSON.stringify(
          {
            intent,
            name,
            systemId: systemId ?? null,
            prompt,
            modules,
            views,
            dashboards,
            workflows,
            permissionPolicies,
            context,
          },
          null,
          2,
        ),
        overwrite: true,
        metadata: { generated: true },
      },
      {
        kind: 'workflow_manifest',
        relativePath: `${basePath}workflow-definitions.json`,
        content: JSON.stringify(workflows, null, 2),
        overwrite: true,
        metadata: { generated: true },
      },
      {
        kind: 'permissions_manifest',
        relativePath: `${basePath}permission-policies.json`,
        content: JSON.stringify(permissionPolicies, null, 2),
        overwrite: true,
        metadata: { generated: true },
      },
      {
        kind: 'studio_notes',
        relativePath: `${basePath}README.md`,
        content: [
          `# ${name}`,
          '',
          `Intent: ${intent}`,
          '',
          'This artifact bundle was generated by the Stack62 Studio Engine.',
          'It contains controlled configuration output that can be reviewed before broader rollout.',
          '',
          '## Modules',
          ...modules.map((module) => `- ${module.name} (${module.key})`),
        ].join('\n'),
        overwrite: true,
        metadata: { generated: true },
      },
    ];
  }

  private deriveSystemName(prompt: string) {
    const cleanPrompt = prompt
      .replace(/^create\s+/i, '')
      .replace(/^build\s+/i, '')
      .trim();

    const candidate = cleanPrompt.split(' ').slice(0, 4).join(' ');
    return candidate
      ? candidate
          .split(' ')
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(' ')
      : 'Generated Business System';
  }

  private findDuplicates(values: string[]) {
    const seen = new Set<string>();
    const duplicates = new Set<string>();

    for (const value of values.map((entry) => slugify(entry))) {
      if (seen.has(value)) {
        duplicates.add(value);
      }

      seen.add(value);
    }

    return Array.from(duplicates);
  }
}
