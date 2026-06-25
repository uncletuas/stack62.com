import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { AccessControlService } from '../../shared/access-control/access-control.service';
import { ActivityService } from '../activity/activity.service';
import { MembershipEntity } from '../memberships/entities/membership.entity';
import {
  FolderAclEntity,
  FolderAclSubjectType,
  FolderPermission,
} from './entities/folder-acl.entity';
import { FolderEntity } from './entities/folder.entity';

/**
 * The order of the FolderPermission ladder, lowest to highest. The
 * effective permission of a user on a folder is the **max** of all
 * matching ACL rows, plus inherited rules from ancestors.
 */
const PERMISSION_ORDER: Record<FolderPermission, number> = {
  read: 1,
  comment: 2,
  write: 3,
  share: 4,
  admin: 5,
};

@Injectable()
export class FoldersService {
  private readonly logger = new Logger(FoldersService.name);

  constructor(
    @InjectRepository(FolderEntity)
    private readonly foldersRepo: Repository<FolderEntity>,
    @InjectRepository(FolderAclEntity)
    private readonly aclRepo: Repository<FolderAclEntity>,
    @InjectRepository(MembershipEntity)
    private readonly membershipRepo: Repository<MembershipEntity>,
    private readonly accessControl: AccessControlService,
    private readonly activityService: ActivityService,
  ) {}

  // ── Tree management ───────────────────────────────────────────────────

  /**
   * Returns the implicit per-org root folder. Created on first access.
   * Roots have isRoot=true, parentId=null, name='/'.
   */
  async getOrCreateRoot(
    organizationId: string,
    workspaceId: string | null,
    actorUserId: string,
  ): Promise<FolderEntity> {
    const existing = await this.foldersRepo.findOne({
      where: {
        organizationId,
        workspaceId: workspaceId ?? IsNull(),
        isRoot: true,
        parentId: IsNull(),
      },
    });
    if (existing) return existing;

    const root = await this.foldersRepo.save(
      this.foldersRepo.create({
        organizationId,
        workspaceId,
        parentId: null,
        name: '/',
        path: '/',
        isRoot: true,
        ownerUserId: actorUserId,
      }),
    );
    return root;
  }

  /**
   * Create a new folder under an optional parent. Caller must have
   * `write` on the parent (or be the parent's owner).
   */
  async createFolder(
    payload: {
      organizationId: string;
      workspaceId?: string | null;
      parentId?: string | null;
      name: string;
      isPersonal?: boolean;
    },
    actorUserId: string,
  ): Promise<FolderEntity> {
    if (!payload.name?.trim()) {
      throw new BadRequestException('Folder name is required.');
    }

    let parent: FolderEntity | null = null;
    if (payload.parentId) {
      parent = await this.foldersRepo.findOne({
        where: { id: payload.parentId },
      });
      if (!parent) throw new NotFoundException('Parent folder not found.');
      if (parent.organizationId !== payload.organizationId) {
        throw new BadRequestException(
          'Parent folder belongs to a different organization.',
        );
      }
      await this.assertPermission(parent.id, actorUserId, 'write');
    } else {
      // Creating at the org root requires org-level access.
      await this.accessControl.assertResolvedAccess(actorUserId, {
        resource: 'system',
        action: 'create',
        organizationId: payload.organizationId,
        workspaceId: payload.workspaceId ?? undefined,
      });
    }

    const parentPath = parent?.path || '/';
    const fullPath =
      parentPath === '/'
        ? `/${payload.name.trim()}`
        : `${parentPath}/${payload.name.trim()}`;

    const folder = await this.foldersRepo.save(
      this.foldersRepo.create({
        organizationId: payload.organizationId,
        workspaceId: payload.workspaceId ?? null,
        parentId: parent?.id ?? null,
        name: payload.name.trim(),
        path: fullPath,
        isPersonal: payload.isPersonal ?? false,
        ownerUserId: actorUserId,
      }),
    );

    await this.activityService.log({
      organizationId: folder.organizationId,
      workspaceId: folder.workspaceId,
      actorUserId,
      action: 'folder.create',
      targetType: 'folder',
      targetId: folder.id,
      origin: 'user',
      metadata: { name: folder.name, parentId: folder.parentId },
    });

    return folder;
  }

  async renameFolder(
    folderId: string,
    name: string,
    actorUserId: string,
  ): Promise<FolderEntity> {
    const folder = await this.requireFolder(folderId);
    if (folder.isRoot) {
      throw new BadRequestException('Cannot rename the root folder.');
    }
    await this.assertPermission(folderId, actorUserId, 'admin');

    const oldPath = folder.path;
    folder.name = name.trim();
    const parentPath = folder.parentId
      ? (await this.requireFolder(folder.parentId)).path
      : '/';
    folder.path =
      parentPath === '/' ? `/${folder.name}` : `${parentPath}/${folder.name}`;
    await this.foldersRepo.save(folder);
    await this.cascadePathUpdate(folder.id, oldPath, folder.path);

    await this.activityService.log({
      organizationId: folder.organizationId,
      actorUserId,
      action: 'folder.rename',
      targetType: 'folder',
      targetId: folder.id,
      origin: 'user',
      metadata: { from: oldPath, to: folder.path },
    });
    return folder;
  }

  async listChildren(
    parentId: string | null,
    organizationId: string,
    workspaceId: string | null,
    actorUserId: string,
  ): Promise<FolderEntity[]> {
    const where = parentId
      ? { parentId, organizationId }
      : {
          parentId: IsNull(),
          organizationId,
          ...(workspaceId === null ? {} : { workspaceId }),
          isRoot: false,
        };
    const folders = await this.foldersRepo.find({
      where,
      order: { name: 'ASC' },
    });

    // Filter to ones the user can at least read.
    const visible: FolderEntity[] = [];
    for (const folder of folders) {
      const perm = await this.effectivePermission(folder.id, actorUserId);
      if (perm) visible.push(folder);
    }
    return visible;
  }

  async getFolder(
    folderId: string,
    actorUserId: string,
  ): Promise<FolderEntity> {
    const folder = await this.requireFolder(folderId);
    await this.assertPermission(folderId, actorUserId, 'read');
    return folder;
  }

  async listAncestors(folderId: string): Promise<FolderEntity[]> {
    const ancestors: FolderEntity[] = [];
    let current = await this.foldersRepo.findOne({ where: { id: folderId } });
    while (current?.parentId) {
      const parent = await this.foldersRepo.findOne({
        where: { id: current.parentId },
      });
      if (!parent) break;
      ancestors.unshift(parent);
      current = parent;
    }
    return ancestors;
  }

  // ── ACLs ──────────────────────────────────────────────────────────────

  async grantAccess(
    payload: {
      folderId: string;
      subjectType: FolderAclSubjectType;
      userId?: string;
      role?: string;
      permission: FolderPermission;
      expiresAt?: Date | null;
    },
    actorUserId: string,
  ): Promise<FolderAclEntity> {
    await this.assertPermission(payload.folderId, actorUserId, 'share');

    if (payload.subjectType === 'user' && !payload.userId) {
      throw new BadRequestException(
        'userId is required when subjectType=user.',
      );
    }
    if (payload.subjectType === 'role' && !payload.role) {
      throw new BadRequestException('role is required when subjectType=role.');
    }

    const acl = await this.aclRepo.save(
      this.aclRepo.create({
        folderId: payload.folderId,
        subjectType: payload.subjectType,
        userId: payload.userId ?? null,
        role: payload.role ?? null,
        permission: payload.permission,
        grantedByUserId: actorUserId,
        expiresAt: payload.expiresAt ?? null,
      }),
    );

    const folder = await this.requireFolder(payload.folderId);
    await this.activityService.log({
      organizationId: folder.organizationId,
      actorUserId,
      action: 'folder.acl.grant',
      targetType: 'folder',
      targetId: folder.id,
      origin: 'user',
      metadata: {
        subjectType: payload.subjectType,
        userId: payload.userId,
        role: payload.role,
        permission: payload.permission,
      },
    });
    return acl;
  }

  async revokeAccess(aclId: string, actorUserId: string): Promise<void> {
    const acl = await this.aclRepo.findOne({ where: { id: aclId } });
    if (!acl) throw new NotFoundException('ACL not found.');
    await this.assertPermission(acl.folderId, actorUserId, 'share');
    await this.aclRepo.delete({ id: aclId });
  }

  async listAcls(folderId: string, actorUserId: string) {
    await this.assertPermission(folderId, actorUserId, 'read');
    return this.aclRepo.find({
      where: { folderId },
      order: { createdAt: 'DESC' },
    });
  }

  // ── Permission resolution ─────────────────────────────────────────────

  /**
   * Public for use by FilesService: returns the highest permission the
   * user has on the folder, walking up the tree with inheritance, or
   * null if no access.
   */
  async effectivePermission(
    folderId: string,
    actorUserId: string,
  ): Promise<FolderPermission | null> {
    const folder = await this.foldersRepo.findOne({ where: { id: folderId } });
    if (!folder) return null;

    // Owners always admin.
    if (folder.ownerUserId === actorUserId) return 'admin';

    // The org-level RBAC may already grant blanket access (e.g. org admin).
    // If they have manage_permissions on the org, treat that as folder admin.
    try {
      await this.accessControl.assertResolvedAccess(actorUserId, {
        resource: 'organization',
        action: 'manage_permissions',
        organizationId: folder.organizationId,
      });
      return 'admin';
    } catch {
      /* fall through to ACL check */
    }

    // Personal folders: only the owner has access (we already checked above).
    if (folder.isPersonal) return null;

    const ancestorIds = (await this.listAncestors(folderId)).map((f) => f.id);
    const folderIds = [folderId, ...ancestorIds];

    const acls = await this.aclRepo.find({
      where: { folderId: In(folderIds) },
    });

    const userMembership = await this.membershipRepo.findOne({
      where: {
        userId: actorUserId,
        organizationId: folder.organizationId,
        status: 'active',
      },
    });
    const userRole = userMembership?.role ?? null;

    let best: FolderPermission | null = null;
    for (const acl of acls) {
      if (acl.expiresAt && acl.expiresAt < new Date()) continue;
      let matches = false;
      if (acl.subjectType === 'user' && acl.userId === actorUserId) {
        matches = true;
      } else if (
        acl.subjectType === 'role' &&
        userRole &&
        acl.role === userRole
      ) {
        matches = true;
      } else if (acl.subjectType === 'org_everyone' && userMembership) {
        matches = true;
      } else if (
        acl.subjectType === 'workspace_everyone' &&
        userMembership &&
        userMembership.workspaceId === folder.workspaceId
      ) {
        matches = true;
      }
      if (!matches) continue;
      if (!best || PERMISSION_ORDER[acl.permission] > PERMISSION_ORDER[best]) {
        best = acl.permission;
      }
    }
    return best;
  }

  /**
   * Asserts the user has at least `required`, throws ForbiddenException
   * otherwise. Public for FilesService and other consumers.
   */
  async assertPermission(
    folderId: string,
    actorUserId: string,
    required: FolderPermission,
  ): Promise<void> {
    const effective = await this.effectivePermission(folderId, actorUserId);
    if (
      !effective ||
      PERMISSION_ORDER[effective] < PERMISSION_ORDER[required]
    ) {
      throw new ForbiddenException(
        `Folder access denied: requires "${required}".`,
      );
    }
  }

  // ── helpers ───────────────────────────────────────────────────────────

  private async requireFolder(folderId: string): Promise<FolderEntity> {
    const folder = await this.foldersRepo.findOne({ where: { id: folderId } });
    if (!folder) throw new NotFoundException('Folder not found.');
    return folder;
  }

  /**
   * After a folder is renamed or moved, rewrite all descendants' paths.
   * Done in a single SQL UPDATE for efficiency.
   */
  private async cascadePathUpdate(
    rootId: string,
    oldPath: string,
    newPath: string,
  ): Promise<void> {
    if (oldPath === newPath) return;
    await this.foldersRepo
      .createQueryBuilder()
      .update(FolderEntity)
      .set({
        path: () => `replace(path, :oldPath, :newPath)`,
      })
      .where('path LIKE :prefix AND id != :rootId', {
        prefix: `${oldPath}/%`,
        rootId,
        oldPath,
        newPath,
      })
      .execute();
  }
}
