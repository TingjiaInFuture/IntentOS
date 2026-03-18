/**
 * Role-Based Access Control (RBAC) and Security Layer
 */

import { User, UserRole, Permission, AgentRole, AgentPermissions } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { Pool } from 'pg';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';

const securityPoolCache = new Map<string, Pool>();

function getSecurityPool(connectionString: string): Pool {
  const existing = securityPoolCache.get(connectionString);
  if (existing) {
    return existing;
  }

  const pool = new Pool({ connectionString });
  securityPoolCache.set(connectionString, pool);
  return pool;
}

export class SecurityManager {
  private users: Map<string, User>;
  private agentPermissions: Map<AgentRole, AgentPermissions>;
  private jwtSecret: string;
  private jwtExpiry: string;
  private databaseUrl?: string;
  public readonly ready: Promise<void>;

  constructor(jwtSecret: string, jwtExpiry: string = '24h', databaseUrl?: string) {
    this.users = new Map();
    this.agentPermissions = new Map();
    this.jwtSecret = jwtSecret;
    this.jwtExpiry = jwtExpiry;
    this.databaseUrl = databaseUrl;

    // Initialize default agent permissions
    this.initializeDefaultAgentPermissions();
    this.ready = this.loadUsersFromDatabase().catch((error) => {
      console.warn('Failed to load users from database:', error);
    });
  }

  /**
   * Initialize default permissions for each agent role
   */
  private initializeDefaultAgentPermissions(): void {
    // HR Agent permissions
    this.agentPermissions.set(AgentRole.HR, {
      role: AgentRole.HR,
      allowedTools: [
        'database_query',
        'database_write',
        'llm_reason',
        'ai_notify',
        'ai_schedule',
        'knowledge_search',
        'ai_document_analyze',
        'ai_report',
        'file_system',
      ],
      maxBudget: 10000, // Can approve up to $10k for hiring/training
      canApproveUp: 5000,
      restrictions: ['Cannot access financial transactions table', 'Cannot modify legal documents'],
    });

    // Finance Agent permissions
    this.agentPermissions.set(AgentRole.FINANCE, {
      role: AgentRole.FINANCE,
      allowedTools: [
        'database_query',
        'database_write',
        'llm_reason',
        'ai_notify',
        'knowledge_search',
        'ai_report',
        'ai_document_analyze',
        'http_request',
        'file_system',
      ],
      maxBudget: 100000, // Can process up to $100k
      canApproveUp: 50000,
      restrictions: ['Requires dual approval for amounts > $50k'],
    });

    // Legal Agent permissions
    this.agentPermissions.set(AgentRole.LEGAL, {
      role: AgentRole.LEGAL,
      allowedTools: [
        'database_query',
        'database_write',
        'llm_reason',
        'ai_notify',
        'knowledge_search',
        'ai_document_analyze',
        'ai_report',
        'file_system',
      ],
      maxBudget: 50000,
      canApproveUp: 25000,
      restrictions: ['Cannot execute financial transactions', 'Cannot access HR salary data'],
    });

    // Sales Agent permissions
    this.agentPermissions.set(AgentRole.SALES, {
      role: AgentRole.SALES,
      allowedTools: [
        'database_query',
        'database_write',
        'llm_reason',
        'ai_notify',
        'knowledge_search',
        'ai_report',
        'file_system',
      ],
      maxBudget: 30000,
      canApproveUp: 10000,
      restrictions: ['Cannot approve legal or finance exceptions'],
    });

    // Marketing Agent permissions
    this.agentPermissions.set(AgentRole.MARKETING, {
      role: AgentRole.MARKETING,
      allowedTools: [
        'database_query',
        'database_write',
        'llm_reason',
        'ai_notify',
        'knowledge_search',
        'ai_report',
        'file_system',
      ],
      maxBudget: 20000,
      canApproveUp: 8000,
      restrictions: ['Cannot access restricted HR/legal records'],
    });

    // IT Agent permissions
    this.agentPermissions.set(AgentRole.IT, {
      role: AgentRole.IT,
      allowedTools: [
        'database_query',
        'database_write',
        'llm_reason',
        'ai_notify',
        'ai_schedule',
        'knowledge_search',
        'ai_report',
        'http_request',
        'file_system',
      ],
      maxBudget: 25000,
      canApproveUp: 10000,
      restrictions: ['Cannot process direct financial disbursement'],
    });

    // Procurement Agent permissions
    this.agentPermissions.set(AgentRole.PROCUREMENT, {
      role: AgentRole.PROCUREMENT,
      allowedTools: [
        'database_query',
        'database_write',
        'llm_reason',
        'ai_notify',
        'knowledge_search',
        'ai_document_analyze',
        'ai_report',
        'file_system',
      ],
      maxBudget: 50000,
      canApproveUp: 15000,
      restrictions: ['Requires legal review for high-risk vendor contracts'],
    });

    // Operations Agent permissions
    this.agentPermissions.set(AgentRole.OPERATIONS, {
      role: AgentRole.OPERATIONS,
      allowedTools: [
        'database_query',
        'database_write',
        'llm_reason',
        'ai_notify',
        'ai_schedule',
        'knowledge_search',
        'ai_report',
        'http_request',
        'file_system',
      ],
      maxBudget: 25000,
      canApproveUp: 10000,
      restrictions: ['Cannot access sensitive HR or financial data'],
    });
  }

  /**
   * Register a new user
   */
  async registerUser(
    username: string,
    email: string,
    password: string,
    role: UserRole,
    department?: string
  ): Promise<User> {
    await this.ready;

    // Check if user already exists
    const existingUser = Array.from(this.users.values()).find(
      (u) => u.username === username || u.email === email
    );
    if (existingUser) {
      throw new Error('User already exists');
    }

    if (this.databaseUrl) {
      const pool = getSecurityPool(this.databaseUrl);
      const duplicate = await pool.query(
        `SELECT id FROM employees WHERE username = $1 OR email = $2 LIMIT 1`,
        [username, email]
      );

      if ((duplicate.rowCount || 0) > 0) {
        throw new Error('User already exists');
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    const permissions = this.getDefaultPermissions(role);

    // Create user
    const user: User = {
      id: this.generateUserId(),
      username,
      email,
      role,
      permissions,
      department,
      metadata: {
        passwordHash: hashedPassword,
        createdAt: new Date().toISOString(),
        permissions,
      },
    };

    this.users.set(user.id, user);
    await this.persistUser(user, hashedPassword);
    return user;
  }

  /**
   * Authenticate user and generate JWT token
   */
  async authenticate(username: string, password: string): Promise<{ user: User; token: string }> {
    await this.ready;

    const user = Array.from(this.users.values()).find((u) => u.username === username);
    const resolvedUser = user || (await this.loadUserByUsername(username));
    if (!resolvedUser) {
      throw new Error('Invalid credentials');
    }

    const passwordHash = (resolvedUser.metadata?.passwordHash as string) || '';
    const isValid = await bcrypt.compare(password, passwordHash);
    if (!isValid) {
      throw new Error('Invalid credentials');
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: resolvedUser.id,
        username: resolvedUser.username,
        role: resolvedUser.role,
      },
      this.jwtSecret as jwt.Secret,
      { expiresIn: this.jwtExpiry as jwt.SignOptions['expiresIn'] }
    );

    return { user: resolvedUser, token };
  }

  /**
   * Verify JWT token
   */
  verifyToken(token: string): { userId: string; username: string; role: UserRole } {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as any;
      return {
        userId: decoded.userId,
        username: decoded.username,
        role: decoded.role,
      };
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }

  /**
   * Check if user has permission to perform an action
   */
  hasPermission(userId: string, resource: string, action: string): boolean {
    const user = this.users.get(userId);
    if (!user) {
      return false;
    }

    // Admins have all permissions
    if (user.role === UserRole.ADMIN) {
      return true;
    }

    // Check user's permissions
    return user.permissions.some(
      (p) => p.resource === resource && p.actions.includes(action)
    );
  }

  /**
   * Get agent permissions
   */
  getAgentPermissions(agentRole: AgentRole): AgentPermissions {
    const permissions = this.agentPermissions.get(agentRole);
    if (!permissions) {
      throw new Error(`No permissions defined for agent role ${agentRole}`);
    }
    return permissions;
  }

  /**
   * Check if agent can use a specific tool
   */
  canAgentUseTool(agentRole: AgentRole, toolName: string): boolean {
    const permissions = this.agentPermissions.get(agentRole);
    if (!permissions) {
      return false;
    }
    return permissions.allowedTools.includes(toolName);
  }

  /**
   * Check if action requires approval based on amount
   */
  requiresApproval(agentRole: AgentRole, amount: number): boolean {
    const permissions = this.agentPermissions.get(agentRole);
    if (!permissions) {
      return true; // Require approval if no permissions defined
    }
    return amount > (permissions.canApproveUp || 0);
  }

  /**
   * Get default permissions for a user role
   */
  private getDefaultPermissions(role: UserRole): Permission[] {
    switch (role) {
      case UserRole.ADMIN:
        return [{ resource: '*', actions: ['*'] }];

      case UserRole.MANAGER:
        return [
          { resource: 'workflows', actions: ['create', 'read', 'update', 'approve'] },
          { resource: 'agents', actions: ['read', 'configure'] },
          { resource: 'users', actions: ['read'] },
          { resource: 'reports', actions: ['create', 'read'] },
        ];

      case UserRole.EMPLOYEE:
        return [
          { resource: 'workflows', actions: ['create', 'read'] },
          { resource: 'agents', actions: ['interact'] },
        ];

      case UserRole.GUEST:
        return [{ resource: 'workflows', actions: ['read'] }];

      default:
        return [];
    }
  }

  /**
   * Generate unique user ID
   */
  private generateUserId(): string {
    return uuidv4();
  }

  /**
   * Grant permission to user
   */
  grantPermission(userId: string, resource: string, actions: string[]): void {
    const user = this.users.get(userId);
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }

    const existingPermission = user.permissions.find((p) => p.resource === resource);
    if (existingPermission) {
      existingPermission.actions = [...new Set([...existingPermission.actions, ...actions])];
    } else {
      user.permissions.push({ resource, actions });
    }

    user.metadata = {
      ...(user.metadata || {}),
      permissions: user.permissions,
      passwordHash: user.metadata?.passwordHash,
    };

    void this.persistUser(user).catch((error) => {
      console.error('Error persisting user permissions:', error);
    });
  }

  /**
   * Revoke permission from user
   */
  revokePermission(userId: string, resource: string, action?: string): void {
    const user = this.users.get(userId);
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }

    if (action) {
      const permission = user.permissions.find((p) => p.resource === resource);
      if (permission) {
        permission.actions = permission.actions.filter((a) => a !== action);
        if (permission.actions.length === 0) {
          user.permissions = user.permissions.filter((p) => p.resource !== resource);
        }
      }
    } else {
      user.permissions = user.permissions.filter((p) => p.resource !== resource);
    }

    user.metadata = {
      ...(user.metadata || {}),
      permissions: user.permissions,
      passwordHash: user.metadata?.passwordHash,
    };

    void this.persistUser(user).catch((error) => {
      console.error('Error persisting user permissions:', error);
    });
  }

  /**
   * Get user by ID
   */
  getUser(userId: string): User | undefined {
    return this.users.get(userId);
  }

  /**
   * Get all users
   */
  getAllUsers(): User[] {
    return Array.from(this.users.values());
  }

  /**
   * Update user role
   */
  updateUserRole(userId: string, newRole: UserRole): void {
    const user = this.users.get(userId);
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }

    user.role = newRole;
    user.permissions = this.getDefaultPermissions(newRole);
    user.metadata = {
      ...(user.metadata || {}),
      permissions: user.permissions,
      passwordHash: user.metadata?.passwordHash,
    };

    void this.persistUser(user).catch((error) => {
      console.error('Error persisting user role:', error);
    });
  }

  private async loadUsersFromDatabase(): Promise<void> {
    if (!this.databaseUrl) {
      return;
    }

    const pool = getSecurityPool(this.databaseUrl);
    const result = await pool.query(`SELECT * FROM employees ORDER BY created_at ASC`);

    for (const row of result.rows) {
      const metadata = this.normalizeMetadata(row.metadata);
      const permissions = Array.isArray(metadata.permissions)
        ? metadata.permissions
        : this.getDefaultPermissions(row.role as UserRole);

      const user: User = {
        id: String(row.id),
        username: String(row.username),
        email: String(row.email),
        role: row.role as UserRole,
        permissions,
        department: row.department ? String(row.department) : undefined,
        metadata: {
          ...metadata,
          passwordHash: row.password_hash,
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
        },
      };

      this.users.set(user.id, user);
    }
  }

  private async loadUserByUsername(username: string): Promise<User | undefined> {
    if (!this.databaseUrl) {
      return undefined;
    }

    const pool = getSecurityPool(this.databaseUrl);
    const result = await pool.query(`SELECT * FROM employees WHERE username = $1 LIMIT 1`, [username]);
    const row = result.rows[0];
    if (!row) {
      return undefined;
    }

    const metadata = this.normalizeMetadata(row.metadata);
    const permissions = Array.isArray(metadata.permissions)
      ? metadata.permissions
      : this.getDefaultPermissions(row.role as UserRole);

    const user: User = {
      id: String(row.id),
      username: String(row.username),
      email: String(row.email),
      role: row.role as UserRole,
      permissions,
      department: row.department ? String(row.department) : undefined,
      metadata: {
        ...metadata,
        passwordHash: row.password_hash,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      },
    };

    this.users.set(user.id, user);
    return user;
  }

  private async persistUser(user: User, passwordHash?: string): Promise<void> {
    if (!this.databaseUrl) {
      return;
    }

    const pool = getSecurityPool(this.databaseUrl);
    const metadata = {
      ...(user.metadata || {}),
      permissions: user.permissions,
      passwordHash: passwordHash || (user.metadata?.passwordHash as string | undefined),
    };

    await pool.query(
      `INSERT INTO employees (id, username, email, password_hash, role, department, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         username = EXCLUDED.username,
         email = EXCLUDED.email,
         password_hash = EXCLUDED.password_hash,
         role = EXCLUDED.role,
         department = EXCLUDED.department,
         metadata = EXCLUDED.metadata,
         updated_at = NOW()`,
      [
        user.id,
        user.username,
        user.email,
        metadata.passwordHash,
        user.role,
        user.department || null,
        metadata,
      ]
    );
  }

  private normalizeMetadata(metadata: any): Record<string, any> {
    if (!metadata) {
      return {};
    }

    if (typeof metadata === 'string') {
      try {
        return JSON.parse(metadata);
      } catch {
        return { value: metadata };
      }
    }

    return metadata;
  }
}
